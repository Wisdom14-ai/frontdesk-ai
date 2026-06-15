import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type ComplianceClient = SupabaseClient;

export interface MarketingOptOutDetection {
  reason: "explicit_stop" | "wrong_number" | "not_interested";
  source: "whatsapp_inbound" | "staff";
}

const EXPLICIT_STOP_PATTERNS = [
  /\b(stop|unsubscribe|opt\s*out|remove me|do not (?:contact|message|text)|don't (?:contact|message|text))\b/i,
  // Malay/Malaysian English: "jangan hubungi", "taknak contact", "xnak msg" etc.
  /\b(jangan|tak nak|tidak mahu|taknak|xnak)\b.{0,30}\b(contact|hubungi|mesej|message|whatsapp|call|telefon|text|msg|wasap|wa)\b/i,
  // "delete my number", "delete nombor saya"
  /\bdelete\b.{0,20}\b(my number|nombor saya|number saya)\b/i,
  // "jangan msg lagi", "jangan wasap lagi"
  /\bjangan\b.{0,20}\b(msg|message|whatsapp|wa|wasap|call|hubungi|mesej)\b.{0,20}\b(lagi|again|dah)\b/i,
];

const WRONG_NUMBER_PATTERNS = [
  /\b(wrong number|salah nombor|not my number|bukan nombor saya)\b/i,
];

const NOT_INTERESTED_PATTERNS = [
  /\b(not interested|tak berminat|tidak berminat|tak minat|no thanks|no thank you)\b/i,
  // Casual Malay shorthands: "taknak la", "xnak", "tak nak dah"
  /\b(taknak|tak nak|xnak|x nak)\b(?:\s+(?:dah|la|lah|jer|je|sangat|langsung))?\s*[.!?]?\s*$/i,
  // "tak perlu la", "tak payah", "no need"
  /\b(tak perlu|tak payah|takpayah|no need)\b.{0,20}\b(la|lah|dah|already|lagi|anymore)?\b/i,
  // "buang nombor", "delete number" without "my"
  /\b(buang|delete)\b.{0,15}\b(nombor|number)\b/i,
];

function isPostgrestLikeError(error: unknown): error is { code?: string; message?: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("code" in error || "message" in error)
  );
}

export function isComplianceSchemaMismatchError(error: unknown) {
  return (
    isPostgrestLikeError(error) &&
    (error.code === "42703" ||
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205")
  );
}

// Staff "kill switch" commands typed by the clinic from their own WhatsApp
// phone to permanently turn the AI off for a contact (e.g. a lead who became a
// client and asked not to be followed up). To avoid firing on normal sentences,
// the message must START with a marker char (#, . or /) and, once stripped of
// non-alphanumerics, exactly match one of the known keywords.
const STAFF_BOT_OFF_KEYWORDS = new Set([
  "stopbot",
  "botoff",
  "offbot",
  "stopai",
  "aistop",
  "aioff",
]);

// Plain exact-word turn-off (no marker), chosen by the clinic. WARNING: these
// are normal words, so the bot turns OFF whenever the WHOLE message is exactly
// one of them. Must be a deliberate standalone reply — "okk la", "okay", "ok"
// do NOT match.
const STAFF_BOT_OFF_PLAIN_WORDS = new Set(["okk"]);

export function isStaffBotOffCommand(message: string): boolean {
  const trimmed = message.trim();
  const key = trimmed.replace(/[^a-z0-9]/gi, "").toLowerCase();

  // Exact-word turn-off — only when the entire message is just the word.
  if (STAFF_BOT_OFF_PLAIN_WORDS.has(key)) {
    return true;
  }

  // Marker-prefixed commands (#stopbot, .botoff, /stopai, ...) can never
  // collide with normal conversation.
  if (/^[#./]/.test(trimmed) && STAFF_BOT_OFF_KEYWORDS.has(key)) {
    return true;
  }

  return false;
}

export function detectMarketingOptOut(
  message: string
): MarketingOptOutDetection | null {
  if (EXPLICIT_STOP_PATTERNS.some((pattern) => pattern.test(message))) {
    return { reason: "explicit_stop", source: "whatsapp_inbound" };
  }

  if (WRONG_NUMBER_PATTERNS.some((pattern) => pattern.test(message))) {
    return { reason: "wrong_number", source: "whatsapp_inbound" };
  }

  if (NOT_INTERESTED_PATTERNS.some((pattern) => pattern.test(message))) {
    return { reason: "not_interested", source: "whatsapp_inbound" };
  }

  return null;
}

export function hasMarketingOptedOut(contact: {
  marketing_opt_out_at?: string | null;
}) {
  return Boolean(contact.marketing_opt_out_at);
}

export async function markContactMarketingOptOut(
  client: ComplianceClient,
  input: {
    clinicId: string;
    contactId: string;
    reason: MarketingOptOutDetection["reason"] | "manual_staff";
    source: MarketingOptOutDetection["source"];
    currentStatus?: string | null;
  }
) {
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {
    marketing_opt_out_at: nowIso,
    marketing_opt_out_reason: input.reason,
    marketing_opt_out_source: input.source,
    automation_enabled: false,
    bot_mode: "paused",
    last_handoff_reason: `marketing_opt_out_${input.reason}`,
    updated_at: nowIso,
  };

  if (input.reason === "wrong_number" && input.currentStatus !== "patient") {
    updates.current_status = "trash";
  }

  const result = await client
    .from("contacts")
    .update(updates)
    .eq("clinic_id", input.clinicId)
    .eq("id", input.contactId);

  if (!result.error) {
    return;
  }

  if (!isComplianceSchemaMismatchError(result.error)) {
    throw result.error;
  }

  const {
    marketing_opt_out_at: omittedOptOutAt,
    marketing_opt_out_reason: omittedReason,
    marketing_opt_out_source: omittedSource,
    ...fallbackUpdates
  } = updates;
  void omittedOptOutAt;
  void omittedReason;
  void omittedSource;

  const fallback = await client
    .from("contacts")
    .update(fallbackUpdates)
    .eq("clinic_id", input.clinicId)
    .eq("id", input.contactId);

  if (fallback.error) {
    throw fallback.error;
  }
}
