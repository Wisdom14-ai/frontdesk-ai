import type { AppContact, ContactPatch } from "@/types/app.types";

// A contact is "off" when staff turned it off (Okk / opt-out) or automation is
// disabled — not merely paused for a human takeover.
export function isContactBotOff(contact: Pick<AppContact, "marketing_opt_out_at" | "automation_enabled">) {
  return Boolean(contact.marketing_opt_out_at) || contact.automation_enabled === false;
}

// Opt-outs that the CUSTOMER initiated. Resuming these means messaging someone
// who asked us to stop — so the UI must confirm first (compliance).
const CUSTOMER_INITIATED_OPT_OUT_REASONS = new Set([
  "explicit_stop",
  "wrong_number",
  "not_interested",
]);

export interface BotResumePlan {
  patch: ContactPatch;
  // Non-null => the caller must confirm with the user before applying `patch`.
  confirmMessage: string | null;
}

// Builds the patch that turns a contact's bot back ON. When the contact was
// fully turned off (Okk / opt-out) this also clears the opt-out and re-enables
// automation, so "Resume" actually reverses "Okk" instead of leaving a contact
// stuck (bot answering but manual sends 403'd and follow-ups off).
export function buildBotResumePlan(
  contact: Pick<AppContact, "marketing_opt_out_at" | "marketing_opt_out_reason" | "automation_enabled">
): BotResumePlan {
  if (!isContactBotOff(contact)) {
    // Only paused for a takeover — just flip the bot back on.
    return { patch: { bot_mode: "active" }, confirmMessage: null };
  }

  const reason = contact.marketing_opt_out_reason ?? "";
  const customerInitiated = CUSTOMER_INITIATED_OPT_OUT_REASONS.has(reason);

  return {
    patch: { bot_mode: "active", automation_enabled: true, marketing_opt_out: false },
    confirmMessage: customerInitiated
      ? "This contact previously opted out / asked to stop receiving messages. Turning the bot back on will resume messaging them. Continue?"
      : null,
  };
}
