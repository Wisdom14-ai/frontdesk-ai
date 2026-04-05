import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type ConversationClient = SupabaseClient;

function getErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "";
}

function isConversationTableUnavailable(error: unknown) {
  const code = getErrorCode(error);

  return Boolean(
    code &&
      ["42P01", "PGRST205", "PGRST204"].includes(code)
  );
}

function isConversationLinkUnavailable(error: unknown) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);

  return Boolean(
    isConversationTableUnavailable(error) ||
      ((code === "42703" || code === "PGRST204") &&
        message.includes("conversation_id"))
  );
}

function isConversationConflict(error: unknown) {
  return getErrorCode(error) === "23505";
}

async function selectConversationId(
  client: ConversationClient,
  clinicId: string,
  contactId: string
) {
  const existing = await client
    .from("conversations")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (existing.error) {
    if (isConversationTableUnavailable(existing.error)) {
      return null;
    }

    throw existing.error;
  }

  const existingConversationId = existing.data?.[0]?.id;
  if (typeof existingConversationId === "string" && existingConversationId.length > 0) {
    return existingConversationId;
  }

  return null;
}

async function backfillConversationMessages(
  client: ConversationClient,
  clinicId: string,
  contactId: string,
  conversationId: string
) {
  const update = await client
    .from("messages")
    .update({
      conversation_id: conversationId,
    })
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .is("conversation_id", null);

  if (update.error && !isConversationLinkUnavailable(update.error)) {
    throw update.error;
  }
}

export async function ensureConversationForContact(
  client: ConversationClient,
  clinicId: string,
  contactId: string
) {
  let conversationId = await selectConversationId(client, clinicId, contactId);

  if (!conversationId) {
    const created = await client
      .from("conversations")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
      })
      .select("id")
      .single();

    if (created.error) {
      if (isConversationTableUnavailable(created.error)) {
        return null;
      }

      if (!isConversationConflict(created.error)) {
        throw created.error;
      }

      conversationId = await selectConversationId(client, clinicId, contactId);
    } else {
      conversationId = (created.data?.id as string | undefined) ?? null;
    }
  }

  if (!conversationId) {
    return null;
  }

  // Link older rows that were written before conversation persistence existed.
  await backfillConversationMessages(client, clinicId, contactId, conversationId);

  return conversationId;
}
