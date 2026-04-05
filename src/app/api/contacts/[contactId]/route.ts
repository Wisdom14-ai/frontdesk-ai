import { NextResponse } from "next/server";

import {
  CONTACT_LEAD_MEMORY_KEYS,
  clearContactLeadMemoryOverride,
  normalizeContactLeadMemoryOverride,
} from "@/lib/contact-memory";
import {
  cancelPendingAutomationJobs,
  isAutomationSchemaMismatchError,
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
    source?: string;
    campaign_name?: string;
    status?: string;
    appointment_date?: string | null;
    appointment_time?: string | null;
    bot_mode?: "active" | "paused" | "handoff_required";
    automation_enabled?: boolean;
    unread_count?: number;
    staff_note?: string | null;
    lead_memory_override?: Record<string, unknown>;
    clear_lead_memory_override?: string[];
  };

  const { data: currentContact, error: contactError } = await supabase
    .from("contacts")
    .select(
      "id, clinic_id, current_status, appointment_date, appointment_time, automation_enabled, lead_memory_override, staff_note"
    )
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
  if (typeof body.source === "string") {
    updates.source = body.source.trim() || null;
    shouldQueueMemoryRefresh = true;
  }
  if (typeof body.campaign_name === "string") {
    updates.campaign_name = body.campaign_name.trim() || null;
    shouldQueueMemoryRefresh = true;
  }
  if (typeof body.status === "string") {
    updates.current_status = body.status;
    shouldQueueMemoryRefresh = true;
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
  const { data: updatedContact, error } = await writer
    .from("contacts")
    .update(updates)
    .eq("id", contactId)
    .eq("clinic_id", membership.clinic_id)
    .select("*")
    .single();

  if (error || !updatedContact) {
    return NextResponse.json({ error: "Failed to update the lead." }, { status: 500 });
  }

  const admin = createAdminClient();
  if (admin) {
    try {
      if (body.automation_enabled === false) {
        await cancelPendingAutomationJobs(admin, membership.clinic_id, contactId, "automation_disabled");
      } else {
        await syncAutomationForContact({
          admin,
          clinicId: membership.clinic_id,
          contactId,
          status: (updatedContact.current_status as string) ?? currentContact.current_status,
          appointmentDate: (updatedContact.appointment_date as string | null) ?? null,
          appointmentTime: (updatedContact.appointment_time as string | null) ?? null,
        });
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
