import {
  mergeContactLeadMemory,
  normalizeContactLeadMemory,
  normalizeContactLeadMemoryOverride,
} from "@/lib/contact-memory";
import type { Lead, Message } from "@/types";

const statusToColumn: Record<string, Lead["status"]> = {
  new_lead: "New Lead",
  no_respond: "No Respond",
  booked_appointment: "Booked Appointment",
  attended_visit: "Attended",
  no_show: "No Show",
  trash: "Trash",
  patient: "Patient",
};

export const CONTACT_LIST_SELECT = [
  "id",
  "clinic_id",
  "full_name",
  "phone_e164",
  "treatment_interest",
  "current_status",
  "assigned_user_id",
  "source",
  "campaign_name",
  "created_at",
  "updated_at",
  "last_inbound_at",
  "last_outbound_at",
  "unread_count",
  "bot_mode",
  "ai_last_intent",
  "ai_last_confidence",
  "last_handoff_reason",
  "automation_enabled",
  "next_follow_up_at",
  "appointment_date",
  "appointment_time",
    "reminder_sent_at",
    "marketing_opt_out_at",
    "marketing_opt_out_reason",
    "marketing_opt_out_source",
    "attendance_status",
  "lead_memory_auto",
  "lead_memory_override",
  "staff_note",
  "lead_memory_last_generated_at",
  "lead_memory_last_error",
].join(", ");

export const LEGACY_CONTACT_LIST_SELECT = [
  "id",
  "clinic_id",
  "full_name",
  "phone_e164",
  "treatment_interest",
  "current_status",
  "assigned_user_id",
  "source",
  "campaign_name",
  "created_at",
  "updated_at",
  "last_inbound_at",
  "last_outbound_at",
  "unread_count",
  "bot_mode",
  "ai_last_intent",
  "ai_last_confidence",
  "last_handoff_reason",
  "automation_enabled",
  "next_follow_up_at",
  "appointment_date",
  "appointment_time",
  "reminder_sent_at",
  "attendance_status",
  "lead_memory_auto",
  "lead_memory_override",
  "staff_note",
  "lead_memory_last_generated_at",
  "lead_memory_last_error",
].join(", ");

export const MESSAGE_LIST_SELECT = [
  "id",
  "contact_id",
  "conversation_id",
  "provider_message_id",
  "direction",
  "sender_type",
  "content",
  "created_at",
  "ai_generated",
  "ai_confidence",
].join(", ");

export const LEGACY_MESSAGE_LIST_SELECT = [
  "id",
  "contact_id",
  "conversation_id",
  "provider_message_id:wa_message_id",
  "direction",
  "sender_type",
  "content",
  "created_at",
  "ai_generated",
  "ai_confidence",
].join(", ");

function isPostgrestLikeError(error: unknown): error is { code?: string; message?: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("code" in error || "message" in error)
  );
}

export function isCrmSchemaMismatchError(error: unknown) {
  return (
    isPostgrestLikeError(error) &&
    (error.code === "42703" ||
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205")
  );
}

export function mapContactRecordToLead(contact: Record<string, unknown>): Lead {
  const leadMemoryAuto = normalizeContactLeadMemory(contact.lead_memory_auto);
  const leadMemoryOverride = normalizeContactLeadMemoryOverride(
    contact.lead_memory_override
  );

  return {
    id: contact.id as string,
    clinic_id: contact.clinic_id as string,
    full_name: contact.full_name as string,
    phone_e164: contact.phone_e164 as string,
    treatment_interest: (contact.treatment_interest as string) || "",
    status: statusToColumn[(contact.current_status as string) || "new_lead"] || "New Lead",
    assigned_user_id: contact.assigned_user_id as string | undefined,
    source: contact.source as string | undefined,
    campaign_name: contact.campaign_name as string | undefined,
    created_at: contact.created_at as string,
    updated_at: contact.updated_at as string,
    last_inbound_at: contact.last_inbound_at as string | undefined,
    last_outbound_at: contact.last_outbound_at as string | undefined,
    unread_count: (contact.unread_count as number) || 0,
    bot_mode: (contact.bot_mode as Lead["bot_mode"]) || "active",
    ai_last_intent: contact.ai_last_intent as string | undefined,
    ai_last_confidence: contact.ai_last_confidence as number | undefined,
    last_handoff_reason: contact.last_handoff_reason as string | undefined,
    automation_enabled: (contact.automation_enabled as boolean | undefined) ?? true,
    next_follow_up_at: contact.next_follow_up_at as string | undefined,
    appointment_date: contact.appointment_date as string | undefined,
    appointment_time: contact.appointment_time as string | undefined,
    reminder_sent_at: contact.reminder_sent_at as string | undefined,
    marketing_opt_out_at:
      (contact.marketing_opt_out_at as string | null) ?? null,
    marketing_opt_out_reason:
      (contact.marketing_opt_out_reason as string | null) ?? null,
    marketing_opt_out_source:
      (contact.marketing_opt_out_source as string | null) ?? null,
    attendance_status: contact.attendance_status as string | undefined,
    lead_memory: mergeContactLeadMemory(leadMemoryAuto, leadMemoryOverride),
    lead_memory_auto: leadMemoryAuto,
    lead_memory_override: leadMemoryOverride,
    staff_note: (contact.staff_note as string | null) ?? null,
    lead_memory_last_generated_at:
      (contact.lead_memory_last_generated_at as string | null) ?? null,
    lead_memory_last_error:
      (contact.lead_memory_last_error as string | null) ?? null,
    revenue_generated_myr: undefined,
    revenue_note: undefined,
  };
}

export function mapMessageRecord(message: Record<string, unknown>): Message {
  return {
    id: message.id as string,
    contact_id: message.contact_id as string,
    conversation_id: (message.conversation_id as string | null) ?? null,
    provider_message_id: (message.provider_message_id as string | null) ?? null,
    direction: message.direction as Message["direction"],
    sender_type: message.sender_type as Message["sender_type"],
    content: message.content as string,
    created_at: message.created_at as string,
    ai_generated: Boolean(message.ai_generated),
    ai_confidence: (message.ai_confidence as number | undefined) ?? undefined,
  };
}
