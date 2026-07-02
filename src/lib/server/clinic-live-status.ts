import "server-only";

import { isAutomationSchemaMismatchError } from "@/lib/server/automation";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";

export interface ClinicBotLiveState {
  live: boolean;
  reasons: string[];
  lastBotSkipReason: string | null;
  lastBotSkipAt: string | null;
}

/**
 * Clinic-facing "is my bot actually replying?" check. Uses the current clinic
 * gates (payment / subscription / WhatsApp) so the message is accurate rather
 * than a stale skip stamp. Schema-tolerant: the last_bot_skip_* columns are
 * optional, so a pre-migration environment still returns a correct live state.
 */
export async function getClinicBotLiveState(
  admin: SupabaseAdminClient,
  clinicId: string
): Promise<ClinicBotLiveState> {
  const base = await admin
    .from("clinics")
    .select(
      "payment_status, subscription_status, whatsapp_status, evolution_instance_name"
    )
    .eq("id", clinicId)
    .maybeSingle();

  const row = (base.data as Record<string, unknown> | null) ?? {};
  const paymentStatus = (row.payment_status as string | null) ?? null;
  const subscriptionStatus = (row.subscription_status as string | null) ?? null;
  const whatsappStatus = (row.whatsapp_status as string | null) ?? null;
  const instanceName = (row.evolution_instance_name as string | null) ?? null;

  const reasons: string[] = [];
  if (paymentStatus !== "received") {
    reasons.push(
      "Your account payment is pending, so the assistant is paused."
    );
  }
  if (subscriptionStatus !== "active") {
    reasons.push("Your subscription is not active, so the assistant is paused.");
  }
  if (whatsappStatus !== "connected" || !instanceName) {
    reasons.push(
      "WhatsApp is not connected, so the assistant cannot send replies."
    );
  }

  // Optional observability columns — never fatal if not migrated.
  let lastBotSkipReason: string | null = null;
  let lastBotSkipAt: string | null = null;
  const optional = await admin
    .from("clinics")
    .select("last_bot_skip_reason, last_bot_skip_at")
    .eq("id", clinicId)
    .maybeSingle();

  if (!optional.error && optional.data) {
    const optRow = optional.data as Record<string, unknown>;
    lastBotSkipReason = (optRow.last_bot_skip_reason as string | null) ?? null;
    lastBotSkipAt = (optRow.last_bot_skip_at as string | null) ?? null;
  } else if (optional.error && !isAutomationSchemaMismatchError(optional.error)) {
    // A non-schema error shouldn't take down the dashboard — log and move on.
    console.warn("[clinic-live-status] Failed to read bot skip columns.", {
      clinicId,
      message: optional.error.message,
      code: optional.error.code,
    });
  }

  return {
    live: reasons.length === 0,
    reasons,
    lastBotSkipReason,
    lastBotSkipAt,
  };
}
