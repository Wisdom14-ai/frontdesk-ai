import "server-only";

import { isAutomationSchemaMismatchError } from "@/lib/server/automation";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Reasons the WhatsApp chatbot can decline to reply to an inbound message at
 * the clinic level (as opposed to per-contact bot_mode states). These are the
 * silent-failure classes we surface to the admin checklist and the clinic's own
 * dashboard.
 */
export type BotSkipReason =
  | "payment_pending"
  | "subscription_not_active"
  | "whatsapp_instance_missing"
  | "message_limit_reached";

const SKIP_REASON_LABELS: Record<BotSkipReason, string> = {
  payment_pending:
    "Payment is marked pending, so the assistant is not replying to new messages.",
  subscription_not_active:
    "The subscription is not active, so the assistant is not replying to new messages.",
  whatsapp_instance_missing:
    "WhatsApp is not connected, so the assistant cannot send replies.",
  message_limit_reached:
    "This clinic hit its monthly message limit, so the assistant paused new replies.",
};

const NOTIFICATION_CATEGORY = "bot_skipped";
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * True when the error means the `last_bot_skip_*` columns have not been
 * migrated yet — callers should treat the write as a no-op rather than fail.
 */
export function isBotSkipColumnMissingError(error: unknown) {
  return isAutomationSchemaMismatchError(error);
}

/**
 * Record that the chatbot skipped an inbound message for a clinic.
 *
 * Two effects, both best-effort:
 *  1. Stamp `clinics.last_bot_skip_reason` / `last_bot_skip_at` so the admin
 *     checklist and the clinic dashboard can explain why the bot is quiet.
 *  2. Insert a deduped `critical` clinic_notifications row (once per reason per
 *     24h) so the clinic sees a persistent alert.
 *
 * This function NEVER throws. It runs inside the webhook message-handling path,
 * and observability must never block the bot from replying (or, here, from
 * completing its skip cleanly). It is also schema-tolerant: if the migration
 * has not run yet, the column write is silently ignored (deploy-order safety).
 */
export async function recordBotSkip(input: {
  admin: SupabaseAdminClient;
  clinicId: string;
  reason: BotSkipReason;
}): Promise<void> {
  const { admin, clinicId, reason } = input;
  const nowIso = new Date().toISOString();

  // 1. Stamp the clinic row (schema-tolerant, never fatal).
  try {
    const { error } = await admin
      .from("clinics")
      .update({
        last_bot_skip_reason: reason,
        last_bot_skip_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", clinicId);

    if (error && !isBotSkipColumnMissingError(error)) {
      console.warn("[bot-skip] Failed to stamp clinic skip reason.", {
        clinicId,
        reason,
        message: error.message,
        code: error.code,
      });
    }
  } catch (error) {
    console.warn("[bot-skip] Unexpected error stamping clinic skip reason.", {
      clinicId,
      reason,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Deduped critical notification (once per reason per 24h).
  try {
    await insertDedupedSkipNotification(admin, clinicId, reason);
  } catch (error) {
    console.warn("[bot-skip] Failed to create skip notification.", {
      clinicId,
      reason,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function insertDedupedSkipNotification(
  admin: SupabaseAdminClient,
  clinicId: string,
  reason: BotSkipReason
) {
  const sinceIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();

  const { data: existing, error: lookupError } = await admin
    .from("clinic_notifications")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("category", NOTIFICATION_CATEGORY)
    .eq("metadata->>reason", reason)
    .gte("created_at", sinceIso)
    .limit(1);

  if (lookupError) {
    // If the lookup itself fails (e.g. table missing), do not insert blindly —
    // that would defeat the dedupe. Bail out quietly.
    if (!isBotSkipColumnMissingError(lookupError)) {
      console.warn("[bot-skip] Skip-notification dedupe lookup failed.", {
        clinicId,
        reason,
        message: lookupError.message,
        code: lookupError.code,
      });
    }
    return;
  }

  if (existing && existing.length > 0) {
    return;
  }

  const { error: insertError } = await admin
    .from("clinic_notifications")
    .insert({
      clinic_id: clinicId,
      severity: "critical",
      category: NOTIFICATION_CATEGORY,
      title: "The assistant is not replying",
      body: SKIP_REASON_LABELS[reason],
      metadata: { reason },
    });

  if (insertError && !isBotSkipColumnMissingError(insertError)) {
    console.warn("[bot-skip] Failed to insert skip notification.", {
      clinicId,
      reason,
      message: insertError.message,
      code: insertError.code,
    });
  }
}

/** Human-readable label for a stored skip reason (for dashboards/checklists). */
export function describeBotSkipReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (
    SKIP_REASON_LABELS[reason as BotSkipReason] ??
    `The assistant recently skipped a message (${reason}).`
  );
}
