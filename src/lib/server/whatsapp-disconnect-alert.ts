import "server-only";

import { isAutomationSchemaMismatchError } from "@/lib/server/automation";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * WhatsApp disconnect alerting.
 *
 * When Evolution reports that a clinic's WhatsApp instance dropped from
 * `connected` to a non-connected state (pending_qr / disconnected), the AI
 * assistant can no longer send replies. This surfaces that as a persistent
 * critical alert so the clinic knows to re-scan the QR code — instead of the
 * bot silently going quiet.
 *
 * The dashboard red banner and the admin go-live checklist already read
 * `clinics.whatsapp_status` directly, so this module only adds the notification
 * row; it does NOT duplicate that status surfacing.
 */

const NOTIFICATION_CATEGORY = "whatsapp_disconnected";

// Dedupe window: a flapping connection (repeated connection.update /
// qrcode.updated events) must not spam the clinic. At most one alert per 6h.
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

const NOTIFICATION_TITLE = "WhatsApp disconnected";
const NOTIFICATION_BODY =
  "WhatsApp disconnected — the AI assistant cannot reply until you re-scan the QR code.";

/**
 * True when the error means the notifications table/columns are not available
 * in this environment — callers should treat the write as a no-op rather than
 * fail. Reuses the same schema-mismatch detection the other webhook-side
 * observability writers use (bot-skip, automation).
 */
export function isDisconnectAlertSchemaMissingError(error: unknown) {
  return isAutomationSchemaMismatchError(error);
}

/**
 * True when a connection-lifecycle event that moves a clinic to a non-connected
 * state represents a real DROP OUT of `connected` (i.e. the previously stored
 * status was `connected`). This is the guard the webhook uses to fire the alert
 * only on the transition, not on every pending_qr / qrcode.updated event (which
 * also fire during the normal initial-setup QR refresh loop).
 */
export function isWhatsappDisconnectTransition(
  previousStatus: string | null | undefined
): boolean {
  return previousStatus === "connected";
}

/**
 * Record that a clinic's WhatsApp instance transitioned OUT of `connected`.
 *
 * Inserts a deduped `critical` clinic_notifications row (once per 6h per
 * clinic) so the clinic sees a persistent "re-scan the QR" alert.
 *
 * This function NEVER throws and NEVER rejects. It runs inside the webhook
 * connection-lifecycle path, and observability must never block message
 * processing. It is also schema-tolerant: if the notifications table is not
 * present, the write is silently ignored.
 */
export async function recordWhatsappDisconnect(input: {
  admin: SupabaseAdminClient;
  clinicId: string;
  event?: string | null;
  state?: string | null;
}): Promise<void> {
  const { admin, clinicId, event, state } = input;

  try {
    const sinceIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();

    const { data: existing, error: lookupError } = await admin
      .from("clinic_notifications")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("category", NOTIFICATION_CATEGORY)
      .gte("created_at", sinceIso)
      .limit(1);

    if (lookupError) {
      // If the lookup itself fails (e.g. table missing), do NOT insert blindly —
      // that would defeat the dedupe and could spam a flapping connection.
      if (!isDisconnectAlertSchemaMissingError(lookupError)) {
        console.warn("[whatsapp-disconnect] Dedupe lookup failed.", {
          clinicId,
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
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
        metadata: {
          event: event ?? null,
          state: state ?? null,
        },
      });

    if (insertError && !isDisconnectAlertSchemaMissingError(insertError)) {
      console.warn("[whatsapp-disconnect] Failed to insert disconnect alert.", {
        clinicId,
        message: insertError.message,
        code: insertError.code,
      });
    }
  } catch (error) {
    console.warn("[whatsapp-disconnect] Unexpected error recording disconnect alert.", {
      clinicId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
