import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LEGACY_MESSAGE_LIST_SELECT,
  MESSAGE_LIST_SELECT,
  mapMessageRecord,
} from "@/lib/crm-data";
import type { Message } from "@/types";

type MessageInsertClient = SupabaseClient;
type MessageQueryClient = SupabaseClient;

export interface MessageInsertPayload {
  clinic_id: string;
  contact_id: string;
  conversation_id?: string | null;
  provider_message_id?: string | null;
  direction: "inbound" | "outbound";
  sender_type: "lead" | "bot" | "human" | "system";
  content: string;
  ai_generated?: boolean;
  ai_confidence?: number | null;
}

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

function isMissingMessageColumn(error: unknown, columnName: string) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);

  return Boolean(
    (code === "42703" || code === "PGRST204") && message.includes(columnName)
  );
}

async function selectMessagesForContact(
  client: MessageQueryClient,
  input: {
    clinicId: string;
    contactId: string;
    order?: "asc" | "desc";
    limit?: number;
    selectClause: string;
  }
) {
  let query = client
    .from("messages")
    .select(input.selectClause)
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .order("created_at", { ascending: input.order !== "desc" });

  if (typeof input.limit === "number") {
    query = query.limit(input.limit);
  }

  return query;
}

export async function listMessagesForContact(
  client: MessageQueryClient,
  input: {
    clinicId: string;
    contactId: string;
    order?: "asc" | "desc";
    limit?: number;
  }
): Promise<Message[]> {
  const primary = await selectMessagesForContact(client, {
    ...input,
    selectClause: MESSAGE_LIST_SELECT,
  });

  if (!primary.error) {
    return (primary.data ?? []).map((message) =>
      mapMessageRecord(message as unknown as Record<string, unknown>)
    );
  }

  if (!isMissingMessageColumn(primary.error, "provider_message_id")) {
    throw primary.error;
  }

  const legacy = await selectMessagesForContact(client, {
    ...input,
    selectClause: LEGACY_MESSAGE_LIST_SELECT,
  });

  if (legacy.error) {
    throw legacy.error;
  }

  return (legacy.data ?? []).map((message) =>
    mapMessageRecord(message as unknown as Record<string, unknown>)
  );
}

async function findMessageByExternalId(
  client: MessageQueryClient,
  input: {
    clinicId: string;
    externalId: string;
    columnName: "provider_message_id" | "wa_message_id";
  }
) {
  return client
    .from("messages")
    .select("contact_id")
    .eq("clinic_id", input.clinicId)
    .eq(input.columnName, input.externalId)
    .maybeSingle();
}

export async function findMessageContactByProviderMessageId(
  client: MessageQueryClient,
  clinicId: string,
  providerMessageId: string
) {
  const primary = await findMessageByExternalId(client, {
    clinicId,
    externalId: providerMessageId,
    columnName: "provider_message_id",
  });

  if (!primary.error) {
    return (primary.data?.contact_id as string | null) ?? null;
  }

  if (!isMissingMessageColumn(primary.error, "provider_message_id")) {
    throw primary.error;
  }

  const legacy = await findMessageByExternalId(client, {
    clinicId,
    externalId: providerMessageId,
    columnName: "wa_message_id",
  });

  if (legacy.error) {
    throw legacy.error;
  }

  return (legacy.data?.contact_id as string | null) ?? null;
}

export async function insertMessageRecord(
  client: MessageInsertClient,
  payload: MessageInsertPayload
) {
  let insertPayload: Record<string, unknown> = {
    clinic_id: payload.clinic_id,
    contact_id: payload.contact_id,
    direction: payload.direction,
    sender_type: payload.sender_type,
    content: payload.content,
    ai_generated: payload.ai_generated ?? false,
  };

  if (typeof payload.ai_confidence === "number") {
    insertPayload.ai_confidence = payload.ai_confidence;
  }

  if (payload.conversation_id) {
    insertPayload.conversation_id = payload.conversation_id;
  }

  if (payload.provider_message_id) {
    insertPayload.provider_message_id = payload.provider_message_id;
  }

  while (true) {
    const { error } = await client.from("messages").insert(insertPayload);

    if (!error) {
      return;
    }

    if (
      "provider_message_id" in insertPayload &&
      isMissingMessageColumn(error, "provider_message_id")
    ) {
      const { provider_message_id: omittedProviderMessageId, ...fallbackPayload } =
        insertPayload;
      insertPayload =
        typeof omittedProviderMessageId === "string" &&
        omittedProviderMessageId.length > 0
          ? { ...fallbackPayload, wa_message_id: omittedProviderMessageId }
          : fallbackPayload;
      continue;
    }

    if (
      "wa_message_id" in insertPayload &&
      isMissingMessageColumn(error, "wa_message_id")
    ) {
      const { wa_message_id: omittedLegacyProviderMessageId, ...fallbackPayload } =
        insertPayload;
      void omittedLegacyProviderMessageId;
      insertPayload = fallbackPayload;
      continue;
    }

    if (
      "conversation_id" in insertPayload &&
      isMissingMessageColumn(error, "conversation_id")
    ) {
      const { conversation_id: omittedConversationId, ...fallbackPayload } =
        insertPayload;
      void omittedConversationId;
      insertPayload = fallbackPayload;
      continue;
    }

    throw error;
  }
}
