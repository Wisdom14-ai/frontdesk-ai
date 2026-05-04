import { NextResponse } from "next/server";

import {
  CONTACT_LEAD_MEMORY_KEYS,
  clearContactLeadMemoryOverride,
  normalizeContactLeadMemoryOverride,
} from "@/lib/contact-memory";
import { isCrmSchemaMismatchError } from "@/lib/crm-data";
import {
  cancelPendingAutomationJobs,
  isAutomationSchemaMismatchError,
  scheduleNoShowRecoveryJob,
  schedulePostVisitAndRecallJobs,
  syncAutomationForContact,
} from "@/lib/server/automation";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { contactId } = await context.params;
  const body = (await req.json()) as {
    full_name?: string;
    treatment_interest?: string;
    treatment_category?: "dental" | "aesthetic" | "gp" | "other" | null;
    last_treatment_date?: string | null;
    source?: string;
    campaign_name?: string;
    status?: string;
    current_status?: string;
    attendance_status?: "pending" | "attended" | "no_show" | "cancelled" | null;
    assigned_user_id?: string | null;
    appointment_date?: string | null;
    appointment_time?: string | null;
    bot_mode?: "active" | "paused" | "handoff_required";
    automation_enabled?: boolean;
    marketing_opt_out?: boolean;
    marketing_opt_out_reason?: string | null;
    unread_count?: number;
    staff_note?: string | null;
    lead_memory_override?: Record<string, unknown>;
    clear_lead_memory_override?: string[];
  };

  const { data: currentContact, error: contactError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .single();

  if (contactError || !currentContact || currentContact.clinic_id !== membership.clinic_id) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  let shouldQueueMemoryRefresh = false;

  if (typeof body.full_name === "string") updates.full_name = body.full_name.trim();
  if (typeof body.treatment_interest === "string") {
    updates.treatment_interest = body.treatment_interest.trim();
    shouldQueueMemoryRefresh = true;
  }
  if ("treatment_category" in body) {
    updates.treatment_category = body.treatment_category ?? null;
    shouldQueueMemoryRefresh = true;
  }
  if ("last_treatment_date" in body) {
    updates.last_treatment_date = body.last_treatment_date ?? null;
  }
  if (typeof body.source === "string") {
    updates.source = body.source.trim() || null;
    shouldQueueMemoryRefresh = true;
  }
  if (typeof body.campaign_name === "string") {
    updates.campaign_name = body.campaign_name.trim() || null;
    shouldQueueMemoryRefresh = true;
  }
  const requestedStatus =
    typeof body.current_status === "string"
      ? body.current_status
      : typeof body.status === "string"
        ? body.status
        : null;

  if (requestedStatus) {
    updates.current_status = requestedStatus;
    if (requestedStatus === "appointment_set" || requestedStatus === "booked_appointment") {
      updates.attendance_status = "pending";
    } else if (requestedStatus === "attended" || requestedStatus === "attended_visit") {
      updates.attendance_status = "attended";
    } else if (requestedStatus === "no_show") {
      updates.attendance_status = "no_show";
    } else if (requestedStatus === "trash") {
      updates.attendance_status = "cancelled";
    }
    shouldQueueMemoryRefresh = true;
  }
  if ("attendance_status" in body) {
    updates.attendance_status = body.attendance_status ?? "pending";
    shouldQueueMemoryRefresh = true;
  }
  if ("assigned_user_id" in body) {
    updates.assigned_user_id = body.assigned_user_id || null;
  }
  if ("appointment_date" in body) {
    updates.appointment_date = body.appointment_date || null;
    shouldQueueMemoryRefresh = true;
  }
  if ("appointment_time" in body) {
    updates.appointment_time = body.appointment_time || null;
    shouldQueueMemoryRefresh = true;
  }
  if (typeof body.bot_mode === "string") {
    updates.bot_mode = body.bot_mode;
    shouldQueueMemoryRefresh = true;
  }
  if (typeof body.automation_enabled === "boolean") updates.automation_enabled = body.automation_enabled;
  if (typeof body.marketing_opt_out === "boolean") {
    shouldQueueMemoryRefresh = true;
    if (body.marketing_opt_out) {
      updates.marketing_opt_out_at =
        (currentContact.marketing_opt_out_at as string | null) ?? new Date().toISOString();
      updates.marketing_opt_out_reason =
        body.marketing_opt_out_reason?.trim() || "manual_staff";
      updates.marketing_opt_out_source = "staff";
      updates.automation_enabled = false;
      updates.bot_mode = "paused";
      updates.last_handoff_reason = "manual_marketing_opt_out";
    } else {
      updates.marketing_opt_out_at = null;
      updates.marketing_opt_out_reason = null;
      updates.marketing_opt_out_source = null;
      if (!("automation_enabled" in body)) {
        updates.automation_enabled = true;
      }
      if (!("bot_mode" in body)) {
        updates.bot_mode = "active";
        updates.last_handoff_reason = null;
      }
    }
  }
  if (typeof body.unread_count === "number") updates.unread_count = body.unread_count;
  if ("staff_note" in body) {
    updates.staff_note = body.staff_note?.trim() || null;
    shouldQueueMemoryRefresh = true;
  }

  const existingOverride = normalizeContactLeadMemoryOverride(
    currentContact.lead_memory_override
  );
  let nextOverride = existingOverride;

  if (body.lead_memory_override) {
    nextOverride = {
      ...nextOverride,
      ...normalizeContactLeadMemoryOverride(body.lead_memory_override),
    };
  }

  if (Array.isArray(body.clear_lead_memory_override) && body.clear_lead_memory_override.length > 0) {
    const clearKeys = body.clear_lead_memory_override.filter(
      (key): key is (typeof CONTACT_LEAD_MEMORY_KEYS)[number] =>
        typeof key === "string" &&
        (CONTACT_LEAD_MEMORY_KEYS as readonly string[]).includes(key)
    );

    nextOverride = clearContactLeadMemoryOverride(
      nextOverride,
      clearKeys
    );
  }

  if (
    body.lead_memory_override ||
    (Array.isArray(body.clear_lead_memory_override) &&
      body.clear_lead_memory_override.length > 0)
  ) {
    updates.lead_memory_override = nextOverride;
  }

  const writer = createAdminClient() ?? supabase;
  let { data: updatedContact, error } = await writer
    .from("contacts")
    .update(updates)
    .eq("id", contactId)
    .eq("clinic_id", membership.clinic_id)
    .select("*")
    .single();

  if (
    error &&
    isCrmSchemaMismatchError(error) &&
    ("marketing_opt_out_at" in updates ||
      "marketing_opt_out_reason" in updates ||
      "marketing_opt_out_source" in updates)
  ) {
    const {
      marketing_opt_out_at: omittedOptOutAt,
      marketing_opt_out_reason: omittedOptOutReason,
      marketing_opt_out_source: omittedOptOutSource,
      ...fallbackUpdates
    } = updates;
    void omittedOptOutAt;
    void omittedOptOutReason;
    void omittedOptOutSource;

    const fallback = await writer
      .from("contacts")
      .update(fallbackUpdates)
      .eq("id", contactId)
      .eq("clinic_id", membership.clinic_id)
      .select("*")
      .single();

    updatedContact = fallback.data;
    error = fallback.error;
  }

  if (error || !updatedContact) {
    return NextResponse.json({ error: "Failed to update the lead." }, { status: 500 });
  }

  const admin = createAdminClient();
  if (admin) {
    try {
      if (body.automation_enabled === false || body.marketing_opt_out === true) {
        await cancelPendingAutomationJobs(
          admin,
          membership.clinic_id,
          contactId,
          body.marketing_opt_out === true
            ? "marketing_opt_out_manual"
            : "automation_disabled"
        );
      } else {
        await syncAutomationForContact({
          admin,
          clinicId: membership.clinic_id,
          contactId,
          status: (updatedContact.current_status as string) ?? currentContact.current_status,
          appointmentDate: (updatedContact.appointment_date as string | null) ?? null,
          appointmentTime: (updatedContact.appointment_time as string | null) ?? null,
        });

        // Clinic-specific recall automation
        const newAttendance = updatedContact.attendance_status as string | null;
        const prevAttendance = currentContact.attendance_status as string | null;

        if (newAttendance !== prevAttendance) {
          if (newAttendance === "attended") {
            // Schedule post-visit follow-up + treatment recall
            await schedulePostVisitAndRecallJobs(admin, {
              clinicId: membership.clinic_id,
              contactId,
              treatmentCategory:
                (updatedContact.treatment_category as string | null) ??
                (currentContact.treatment_category as string | null) ?? null,
              lastTreatmentDate:
                (updatedContact.last_treatment_date as string | null) ??
                (updatedContact.appointment_date as string | null) ?? null,
            });
          } else if (newAttendance === "no_show") {
            // Schedule no-show recovery message
            await scheduleNoShowRecoveryJob(admin, {
              clinicId: membership.clinic_id,
              contactId,
            });
          }
        }
      }
    } catch (error) {
      if (!isAutomationSchemaMismatchError(error)) {
        throw error;
      }
    }
  }

  if (shouldQueueMemoryRefresh) {
    try {
      await enqueueContactMemoryJob(writer, {
        clinicId: membership.clinic_id,
        contactId,
        triggerSource: "contact_updated",
      });
    } catch (error) {
      if (!isContactMemorySchemaMismatchError(error)) {
        throw error;
      }
    }
  }

  return NextResponse.json({ contact: updatedContact });
}
