"use server";

import { revalidatePath } from "next/cache";

import {
  buildOnboardingFields,
  isMissingClinicKnowledgeColumnError,
} from "@/lib/server/clinic";
import { requireAgencyAdmin } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function getAuthorizedAdminClient() {
  const auth = await requireAgencyAdmin();
  if (!auth.isAgencyAdmin) {
    throw new Error("Super admin access required.");
  }

  const admin = createAdminClient();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for super admin actions.");
  }

  return admin;
}

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalDate(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  // new Date(...).toISOString() throws a RangeError on invalid date strings.
  // Guard against that so a bad admin form input returns null rather than 500.
  try {
    const date = new Date(`${value.trim()}T00:00:00.000Z`);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  } catch {
    return null;
  }
}

function revalidateClinicAdminPaths(clinicId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/clinics/${clinicId}`);
}

export async function updateClinicProfile(clinicId: string, formData: FormData) {
  const admin = await getAuthorizedAdminClient();

  await admin
    .from("clinics")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      clinic_type: String(formData.get("clinic_type") ?? "").trim(),
      owner_name: String(formData.get("owner_name") ?? "").trim() || null,
      owner_phone: String(formData.get("owner_phone") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId);

  revalidateClinicAdminPaths(clinicId);
}

export async function updateClinicCommercial(
  clinicId: string,
  formData: FormData
) {
  const admin = await getAuthorizedAdminClient();
  const { data: clinic } = await admin
    .from("clinics")
    .select("payment_status, whatsapp_status, onboarding_completed_at")
    .eq("id", clinicId)
    .single();

  if (!clinic) {
    throw new Error("Clinic not found.");
  }

  const paymentStatus = String(formData.get("payment_status") ?? "pending") as
    | "pending"
    | "received";
  const paymentReceivedAt =
    paymentStatus === "received"
      ? parseOptionalDate(formData.get("payment_received_at")) ??
        new Date().toISOString()
      : null;
  const billingCycleAnchor =
    typeof formData.get("billing_cycle_anchor") === "string" &&
    String(formData.get("billing_cycle_anchor")).trim()
      ? String(formData.get("billing_cycle_anchor"))
      : paymentReceivedAt?.slice(0, 10) ?? null;

  await admin
    .from("clinics")
    .update({
      plan_type: String(formData.get("plan_type") ?? "starter").trim(),
      subscription_status: String(
        formData.get("subscription_status") ?? "active"
      ).trim(),
      payment_status: paymentStatus,
      payment_received_at: paymentReceivedAt,
      billing_cycle_anchor: billingCycleAnchor,
      manual_monthly_cost_myr: parseOptionalNumber(
        formData.get("manual_monthly_cost_myr")
      ),
      contact_limit_override: parseOptionalNumber(
        formData.get("contact_limit_override")
      ),
      monthly_message_limit_override: parseOptionalNumber(
        formData.get("monthly_message_limit_override")
      ),
      internal_notes: String(formData.get("internal_notes") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
      ...buildOnboardingFields({
        paymentStatus,
        whatsappStatus:
          (clinic.whatsapp_status as
            | "not_connected"
            | "pending_qr"
            | "connected"
            | "disconnected") ?? "not_connected",
        currentOnboardingCompletedAt:
          (clinic.onboarding_completed_at as string | null) ?? null,
      }),
    })
    .eq("id", clinicId);

  revalidateClinicAdminPaths(clinicId);
}

export async function updateClinicPrompt(clinicId: string, formData: FormData) {
  const admin = await getAuthorizedAdminClient();

  await admin
    .from("clinics")
    .update({
      clinic_prompt: String(formData.get("clinic_prompt") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId);

  revalidateClinicAdminPaths(clinicId);
}

/**
 * Save clinic_knowledge from admin. Schema-tolerant: if the column has not been
 * migrated yet, this is a no-op rather than a 500 (see the same guard used by
 * the clinic settings API).
 */
export async function updateClinicKnowledge(
  clinicId: string,
  formData: FormData
) {
  const admin = await getAuthorizedAdminClient();

  const { error } = await admin
    .from("clinics")
    .update({
      clinic_knowledge:
        String(formData.get("clinic_knowledge") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId);

  if (error && !isMissingClinicKnowledgeColumnError(error)) {
    throw error;
  }

  revalidateClinicAdminPaths(clinicId);
}

// ---------------------------------------------------------------------------
// useActionState wrappers — these adapt the (clinicId, FormData) actions above
// to the (prevState, FormData) signature React forms expect, reading clinicId
// from a hidden field and returning a small status object for inline feedback.
// ---------------------------------------------------------------------------

export type ClinicActionState = {
  ok: boolean;
  message: string;
  savedAt?: number;
} | null;

function clinicIdFrom(formData: FormData): string {
  const id = String(formData.get("clinic_id") ?? "").trim();
  if (!id) {
    throw new Error("Missing clinic id.");
  }
  return id;
}

async function runClinicAction(
  formData: FormData,
  run: (clinicId: string) => Promise<void>
): Promise<ClinicActionState> {
  try {
    const clinicId = clinicIdFrom(formData);
    await run(clinicId);
    return { ok: true, message: "Saved.", savedAt: Date.now() };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Something went wrong saving.",
    };
  }
}

export async function saveClinicCommercialAction(
  _prev: ClinicActionState,
  formData: FormData
): Promise<ClinicActionState> {
  return runClinicAction(formData, (clinicId) =>
    updateClinicCommercial(clinicId, formData)
  );
}

export async function saveClinicProfileAction(
  _prev: ClinicActionState,
  formData: FormData
): Promise<ClinicActionState> {
  return runClinicAction(formData, (clinicId) =>
    updateClinicProfile(clinicId, formData)
  );
}

export async function saveClinicPromptKnowledgeAction(
  _prev: ClinicActionState,
  formData: FormData
): Promise<ClinicActionState> {
  return runClinicAction(formData, async (clinicId) => {
    await updateClinicPrompt(clinicId, formData);
    await updateClinicKnowledge(clinicId, formData);
  });
}

const CAP_HANDOFF_REASONS = ["cap_exceeded", "ai_paused", "cap_check_failed", "ai_cap_blocked"];

export async function resetAiCapPause(clinicId: string) {
  const admin = await getAuthorizedAdminClient();
  const nowIso = new Date().toISOString();

  await admin
    .from("clinics")
    .update({
      ai_paused_at: null,
      ai_paused_reason: null,
      ai_warning_sent_at: null,
      updated_at: nowIso,
    })
    .eq("id", clinicId);

  revalidateClinicAdminPaths(clinicId);
}

export async function resetCapBlockedContacts(clinicId: string) {
  const admin = await getAuthorizedAdminClient();

  const { data, error } = await admin
    .from("contacts")
    .update({
      bot_mode: "active",
      last_handoff_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("bot_mode", "handoff_required")
    .in("last_handoff_reason", CAP_HANDOFF_REASONS)
    .select("id");

  if (error) {
    throw new Error("Failed to reset cap-blocked contacts.");
  }

  revalidateClinicAdminPaths(clinicId);
  return { count: (data ?? []).length };
}
