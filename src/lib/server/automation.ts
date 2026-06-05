import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getContactNameReview } from "@/lib/contact-name";
import { mergeContactLeadMemory } from "@/lib/contact-memory";
import { getClinicUsageSummary } from "@/lib/server/clinic";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { hasMarketingOptedOut } from "@/lib/server/compliance";
import { isClosingPipelineStatus } from "@/lib/server/lead-intelligence";
import { insertMessageRecord, listMessagesForContact } from "@/lib/server/messages";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { sanitizeContactName, sendWhatsappMessage } from "@/lib/server/whatsapp";
import type {
  AutomationHealthSummary,
  AutomationApprovalDraft,
  AutomationJobType,
  AutomationRuleConfig,
  AutomationRunNowSummary,
  AutomationRunnerRunSummary,
  AutomationTriggerSource,
} from "@/types";

interface AutomationRuleDefinition {
  rule_key: string;
  name: string;
  description: string;
  job_type: AutomationJobType;
  delay_hours: number;
  template_key: string;
  template_body: string;
  is_enabled?: boolean;
  required_status?: string | null;
}

interface ContactAutomationContext {
  id?: string | null;
  full_name?: string | null;
  phone_e164?: string | null;
  treatment_interest?: string | null;
  current_status?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  bot_mode?: "active" | "paused" | "handoff_required" | null;
  automation_enabled?: boolean | null;
  marketing_opt_out_at?: string | null;
  lead_memory_auto?: Record<string, unknown> | null;
  lead_memory_override?: Record<string, unknown> | null;
  staff_note?: string | null;
}

interface ClinicAutomationContext {
  id: string;
  name?: string | null;
  clinic_prompt?: string | null;
  plan_type?: "starter" | "pro" | null;
  subscription_status?: string | null;
  payment_status?: string | null;
  whatsapp_status?: string | null;
  evolution_instance_name?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  payment_received_at?: string | null;
  billing_cycle_anchor?: string | null;
  created_at?: string | null;
  contact_limit_override?: number | null;
  monthly_message_limit_override?: number | null;
}

interface AutomationRunInput {
  admin: SupabaseAdminClient;
  clinicId?: string;
  triggerSource: AutomationTriggerSource;
  requestedByUserId?: string | null;
  limit?: number;
}

interface AutomationRunClinicStats {
  jobs_scanned: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_skipped: number;
}

const DEFAULT_AUTOMATION_RULES: AutomationRuleDefinition[] = [
  {
    rule_key: "same_day_reminder",
    name: "Same-day reminder",
    description: "Send a reminder on the appointment day. For timed appointments, the delay is treated as hours before the appointment.",
    job_type: "same_day_reminder",
    delay_hours: 2,
    template_key: "same_day_reminder",
    template_body:
      "Hi {{contact_name}}, just a reminder that your appointment is {{appointment_time_phrase}} at {{clinic_name}}. Reply here if you need to reschedule.",
  },
  {
    rule_key: "no_reply_day_2",
    name: "No reply follow-up day 2",
    description: "Re-engage leads that did not reply after the first outbound message.",
    job_type: "no_reply_follow_up",
    delay_hours: 48,
    template_key: "no_reply_day_2",
    template_body:
      "Hi {{contact_name}}, just following up from {{clinic_name}} in case you still need help booking. Reply here and our team can assist you.",
  },
  {
    rule_key: "no_reply_day_5",
    name: "No reply follow-up day 5",
    description: "Second no-reply follow-up for leads that are still inactive.",
    job_type: "no_reply_follow_up",
    delay_hours: 120,
    template_key: "no_reply_day_5",
    template_body:
      "Hi {{contact_name}}, we are checking back in from {{clinic_name}}. If you still want help booking, reply here and we will sort it out.",
  },
  {
    rule_key: "no_reply_day_7",
    name: "No reply follow-up day 7",
    description: "Final short follow-up before the lead moves into longer-term nurture.",
    job_type: "no_reply_follow_up",
    delay_hours: 168,
    template_key: "no_reply_day_7",
    template_body:
      "Hi {{contact_name}}, last quick follow-up from {{clinic_name}}. If you would like to continue, just reply here and we will help you book.",
  },
  {
    rule_key: "nurture_month_1",
    name: "Monthly nurture month 1",
    description: "Restart the conversation one month later for leads that never booked.",
    job_type: "monthly_nurture",
    delay_hours: 24 * 30,
    template_key: "nurture_month_1",
    template_body:
      "Hi {{contact_name}}, checking in from {{clinic_name}}. If you still want help with your treatment plan, reply here and we can help you book.",
  },
  {
    rule_key: "nurture_month_2",
    name: "Monthly nurture month 2",
    description: "Second monthly nurture touchpoint for dormant leads.",
    job_type: "monthly_nurture",
    delay_hours: 24 * 60,
    template_key: "nurture_month_2",
    template_body:
      "Hi {{contact_name}}, we wanted to follow up from {{clinic_name}} in case now is a better time to continue your treatment plan. Reply here if you want help booking.",
  },
  {
    rule_key: "nurture_month_3",
    name: "Monthly nurture month 3",
    description: "Final nurture message for leads still inactive after three months.",
    job_type: "monthly_nurture",
    delay_hours: 24 * 90,
    template_key: "nurture_month_3",
    template_body:
      "Hi {{contact_name}}, final check-in from {{clinic_name}}. If you would still like to continue, reply here and we can help you with the next step.",
  },
  // --- Post-visit & recall rules (clinic differentiation) ---
  {
    rule_key: "post_visit_followup",
    name: "Post-visit follow-up (24h)",
    description: "Check in with the patient the day after their visit to see how they are feeling.",
    job_type: "post_visit_followup",
    delay_hours: 24,
    template_key: "post_visit_followup",
    template_body:
      "Hi {{contact_name}}, just checking in from {{clinic_name}} — how are you feeling after your visit yesterday? Please let us know if you have any questions or concerns 😊",
  },
  {
    rule_key: "no_show_recovery",
    name: "No-show recovery (48h)",
    description: "Re-engage patients who missed their appointment and offer to reschedule.",
    job_type: "no_show_recovery",
    delay_hours: 48,
    template_key: "no_show_recovery",
    template_body:
      "Hi {{contact_name}}, we noticed you missed your appointment at {{clinic_name}}. No worries — would you like to reschedule? Reply here and we will find you the next available slot.",
  },
  // Dental recalls
  {
    rule_key: "dental_scaling_recall",
    name: "Dental scaling recall (6 months)",
    description: "Remind dental patients to book their 6-month scaling & cleaning.",
    job_type: "treatment_recall",
    delay_hours: 24 * 180,
    template_key: "dental_scaling_recall",
    template_body:
      "Hi {{contact_name}}, your 6-month dental cleaning & scaling is due at {{clinic_name}}! Regular cleanings keep your teeth and gums healthy. Reply here to book your appointment 🦷",
  },
  {
    rule_key: "dental_checkup_recall",
    name: "Dental check-up recall (12 months)",
    description: "Annual dental check-up reminder for general dental patients.",
    job_type: "treatment_recall",
    delay_hours: 24 * 365,
    template_key: "dental_checkup_recall",
    template_body:
      "Hi {{contact_name}}, time for your annual dental check-up at {{clinic_name}}! Early detection keeps small issues from becoming big ones. Reply here to book 🦷",
  },
  // Aesthetic recalls
  {
    rule_key: "aesthetic_botox_recall",
    name: "Botox touch-up recall (4 months)",
    description: "Remind aesthetic patients when their botox touch-up is due.",
    job_type: "treatment_recall",
    delay_hours: 24 * 120,
    template_key: "aesthetic_botox_recall",
    template_body:
      "Hi {{contact_name}}, your botox touch-up at {{clinic_name}} is coming up — most results last around 3–4 months! Reply here to book your next session ✨",
  },
  {
    rule_key: "aesthetic_filler_recall",
    name: "Filler top-up recall (6 months)",
    description: "Remind patients when their dermal filler top-up is due.",
    job_type: "treatment_recall",
    delay_hours: 24 * 180,
    template_key: "aesthetic_filler_recall",
    template_body:
      "Hi {{contact_name}}, your dermal filler top-up at {{clinic_name}} is due soon to maintain your results! Reply here to book your appointment ✨",
  },
  // GP recalls
  {
    rule_key: "gp_annual_checkup_recall",
    name: "GP annual health screening (12 months)",
    description: "Remind GP patients to book their annual health screening.",
    job_type: "treatment_recall",
    delay_hours: 24 * 365,
    template_key: "gp_annual_checkup_recall",
    template_body:
      "Hi {{contact_name}}, your annual health screening at {{clinic_name}} is due! Regular check-ups help catch health issues early. Reply here to book 💊",
  },
];

const RECALL_RULE_KEYS = new Set([
  "post_visit_followup",
  "no_show_recovery",
  "dental_scaling_recall",
  "dental_checkup_recall",
  "aesthetic_botox_recall",
  "aesthetic_filler_recall",
  "gp_annual_checkup_recall",
]);

// Job types whose message should be AI-generated from the conversation
// transcript so naming and direction continue the existing thread.
const AI_FOLLOW_UP_JOB_TYPES = new Set(["no_reply_follow_up", "monthly_nurture"]);

const CLOSING_STATUSES = new Set([
  "booked_appointment",
  "attended_visit",
  "no_show",
  "patient",
  "trash",
]);

const DEFAULT_RULE_MAP = new Map(
  DEFAULT_AUTOMATION_RULES.map((rule) => [rule.rule_key, rule])
);

type AutomationClient = SupabaseClient;

export function getDefaultAutomationRuleDefinitions() {
  return DEFAULT_AUTOMATION_RULES;
}

function mapAutomationRuleRow(
  row: Record<string, unknown> | undefined,
  definition: AutomationRuleDefinition
): AutomationRuleConfig {
  return {
    id: row?.id as string | undefined,
    clinic_id: row?.clinic_id as string | undefined,
    rule_key: definition.rule_key,
    name:
      (typeof row?.name === "string" && row.name.trim()) || definition.name,
    description: definition.description,
    job_type:
      (row?.job_type as AutomationJobType | undefined) ?? definition.job_type,
    delay_hours:
      typeof row?.delay_hours === "number"
        ? row.delay_hours
        : definition.delay_hours,
    template_key:
      (typeof row?.template_key === "string" && row.template_key.trim()) ||
      definition.template_key,
    template_body:
      (typeof row?.template_body === "string" && row.template_body.trim()) ||
      definition.template_body,
    is_enabled:
      typeof row?.is_enabled === "boolean" ? row.is_enabled : true,
    required_status:
      (row?.required_status as string | null) ?? definition.required_status ?? null,
  };
}

function mergeAutomationRules(rows: Record<string, unknown>[]) {
  const rowMap = new Map(
    rows.map((row) => [(row.rule_key as string | undefined) ?? "", row])
  );

  return DEFAULT_AUTOMATION_RULES.map((definition) =>
    mapAutomationRuleRow(rowMap.get(definition.rule_key), definition)
  );
}

function isPostgrestLikeError(error: unknown): error is { code?: string; message?: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("code" in error || "message" in error)
  );
}

export function isAutomationSchemaMismatchError(error: unknown) {
  return (
    isPostgrestLikeError(error) &&
    (error.code === "42703" ||
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205")
  );
}

async function selectAutomationRuleRows(
  client: AutomationClient,
  clinicId: string
) {
  const { data, error } = await client
    .from("automation_rules")
    .select("*")
    .eq("clinic_id", clinicId);

  if (error) {
    throw error;
  }

  return (data ?? []) as Record<string, unknown>[];
}

function buildMissingAutomationRuleRows(clinicId: string, existingKeys: Set<string>) {
  return DEFAULT_AUTOMATION_RULES.filter(
    (rule) => !existingKeys.has(rule.rule_key)
  ).map((rule) => ({
    clinic_id: clinicId,
    rule_key: rule.rule_key,
    name: rule.name,
    job_type: rule.job_type,
    delay_hours: rule.delay_hours,
    template_key: rule.template_key,
    template_body: rule.template_body,
    is_enabled: true,
  }));
}

export async function ensureDefaultAutomationRules(
  client: AutomationClient,
  clinicId: string
) {
  const existingRows = await selectAutomationRuleRows(client, clinicId);
  const existingKeys = new Set(
    existingRows.map((row) => (row.rule_key as string | undefined) ?? "")
  );
  const missingRows = buildMissingAutomationRuleRows(clinicId, existingKeys);

  if (missingRows.length === 0) {
    return;
  }

  let { error } = await client.from("automation_rules").insert(missingRows);

  if (error && isAutomationSchemaMismatchError(error)) {
    const fallbackRows = missingRows.map((row) => {
      const { template_body: omittedTemplateBody, ...fallbackRow } = row;
      void omittedTemplateBody;
      return fallbackRow;
    });
    const fallback = await client.from("automation_rules").insert(fallbackRows);
    error = fallback.error;
  }

  if (error && error.code !== "23505") {
    throw error;
  }
}

export async function getClinicAutomationRules(
  client: AutomationClient,
  clinicId: string,
  options?: { persistMissing?: boolean }
) {
  if (options?.persistMissing) {
    await ensureDefaultAutomationRules(client, clinicId);
  }

  const rows = await selectAutomationRuleRows(client, clinicId);
  return mergeAutomationRules(rows);
}

export async function cancelPendingAutomationJobs(
  admin: SupabaseAdminClient,
  clinicId: string,
  contactId: string,
  reason: string,
  jobTypes?: AutomationJobType[]
) {
  let query = admin
    .from("automation_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .in("status", ["pending", "processing", "needs_approval"]);

  if (jobTypes?.length) {
    query = query.in("job_type", jobTypes);
  }

  await query;
}

export async function cancelPendingAutomationJobsForRule(
  client: AutomationClient,
  clinicId: string,
  ruleKey: string,
  reason: string
) {
  await client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("rule_key", ruleKey)
    .in("status", ["pending", "processing", "needs_approval"]);
}

export async function scheduleFollowUpJobs(
  admin: SupabaseAdminClient,
  clinicId: string,
  contactId: string,
  baseDate = new Date()
) {
  await cancelPendingAutomationJobs(
    admin,
    clinicId,
    contactId,
    "follow_up_rescheduled",
    ["no_reply_follow_up", "monthly_nurture"]
  );

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", contactId)
    .maybeSingle();

  if (contactError) {
    throw contactError;
  }

  if (
    !contact ||
    contact.automation_enabled === false ||
    hasMarketingOptedOut(contact) ||
    isClosingPipelineStatus(contact.current_status as string | null)
  ) {
    return;
  }

  const rules = await getClinicAutomationRules(admin, clinicId, {
    persistMissing: true,
  });

  const jobs = rules
    .filter(
      (rule) =>
        rule.is_enabled &&
        rule.job_type !== "same_day_reminder" &&
        // Recall/post-visit/no-show rules are triggered explicitly by
        // attendance_status changes — never by inbound messages.
        !RECALL_RULE_KEYS.has(rule.rule_key)
    )
    .map((rule) => ({
      clinic_id: clinicId,
      contact_id: contactId,
      rule_key: rule.rule_key,
      job_type: rule.job_type,
      template_key: rule.template_key,
      status: "pending",
      scheduled_for: new Date(
        baseDate.getTime() + rule.delay_hours * 60 * 60 * 1000
      ).toISOString(),
      payload: {},
    }));

  if (jobs.length > 0) {
    const { error: insertError } = await admin
      .from("automation_jobs")
      .insert(jobs);
    // 23505 = unique_violation from the partial unique index on pending jobs;
    // silently ignore — the existing pending job is the correct one to keep.
    if (insertError && insertError.code !== "23505") {
      throw insertError;
    }
  }
}

export async function scheduleSameDayReminder(input: {
  admin: SupabaseAdminClient;
  clinicId: string;
  contactId: string;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
}) {
  const { admin, clinicId, contactId, appointmentDate, appointmentTime } = input;
  const rules = await getClinicAutomationRules(admin, clinicId, {
    persistMissing: true,
  });
  const reminderRule = rules.find(
    (rule) => rule.rule_key === "same_day_reminder"
  );

  await admin
    .from("automation_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "same_day_reminder_rescheduled",
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .eq("job_type", "same_day_reminder")
    .in("status", ["pending", "processing", "needs_approval"]);

  if (!appointmentDate || !reminderRule?.is_enabled) {
    return;
  }

  const scheduledFor = buildReminderTimestamp(
    appointmentDate,
    appointmentTime,
    reminderRule.delay_hours
  );
  if (!scheduledFor) {
    return;
  }

  await admin.from("automation_jobs").insert({
    clinic_id: clinicId,
    contact_id: contactId,
    rule_key: reminderRule.rule_key,
    job_type: reminderRule.job_type,
    template_key: reminderRule.template_key,
    status: "pending",
    scheduled_for: scheduledFor,
    payload: {
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
    },
  });
}

function buildReminderTimestamp(
  appointmentDate: string,
  appointmentTime?: string | null,
  delayHours = 0
) {
  const normalizedDelay = Math.max(0, delayHours);
  const appointmentDateTime = appointmentTime
    ? new Date(`${appointmentDate}T${appointmentTime}:00`)
    : new Date(`${appointmentDate}T09:00:00`);

  if (Number.isNaN(appointmentDateTime.getTime())) {
    return null;
  }

  if (appointmentTime && normalizedDelay > 0) {
    appointmentDateTime.setHours(
      appointmentDateTime.getHours() - normalizedDelay
    );
  }

  return appointmentDateTime.toISOString();
}

export async function syncAutomationForContact(input: {
  admin: SupabaseAdminClient | null;
  clinicId: string;
  contactId: string;
  status: string;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
}) {
  if (!input.admin) {
    return;
  }

  if (CLOSING_STATUSES.has(input.status)) {
    await cancelPendingAutomationJobs(
      input.admin,
      input.clinicId,
      input.contactId,
      `status_changed_to_${input.status}`
    );
  }

  await scheduleSameDayReminder({
    admin: input.admin,
    clinicId: input.clinicId,
    contactId: input.contactId,
    appointmentDate: input.appointmentDate,
    appointmentTime: input.appointmentTime,
  });
}

function renderAutomationTemplate(
  template: string,
  variables: Record<string, string>
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return variables[key] ?? "";
  });
}

function getFallbackAutomationTemplate(jobType: string) {
  switch (jobType) {
    case "same_day_reminder":
      return DEFAULT_RULE_MAP.get("same_day_reminder")?.template_body ?? "";
    case "monthly_nurture":
      return DEFAULT_RULE_MAP.get("nurture_month_1")?.template_body ?? "";
    case "no_reply_follow_up":
    default:
      return DEFAULT_RULE_MAP.get("no_reply_day_2")?.template_body ?? "";
  }
}

export function buildAutomationMessage(input: {
  jobType: string;
  payload: Record<string, unknown>;
  contactName: string;
  clinicName: string;
  templateBody?: string | null;
}) {
  const appointmentTime =
    typeof input.payload.appointment_time === "string"
      ? input.payload.appointment_time
      : "";

  const template =
    input.templateBody?.trim() || getFallbackAutomationTemplate(input.jobType);

  return renderAutomationTemplate(template, {
    contact_name: input.contactName,
    clinic_name: input.clinicName,
    appointment_time: appointmentTime,
    appointment_time_phrase: appointmentTime
      ? `today at ${appointmentTime}`
      : "today",
  })
    .replace(/\s+/g, " ")
    .trim();
}

function getSafeAutomationContactName(input: {
  contactName?: string | null;
  phone?: string | null;
  clinicName?: string | null;
  instanceName?: string | null;
}) {
  return (
    sanitizeContactName({
      incomingName: input.contactName,
      phone: input.phone,
      selfNames: [input.clinicName, input.instanceName],
    }) ?? "there"
  );
}

function getFollowUpApprovalReasons(input: {
  jobType: string;
  message: string;
  contact: ContactAutomationContext;
  clinic: ClinicAutomationContext;
  recentMessageCount: number;
  aiGenerated: boolean;
}) {
  if (!AI_FOLLOW_UP_JOB_TYPES.has(input.jobType)) {
    return [];
  }

  const reasons: string[] = [];
  const nameReview = getContactNameReview({
    fullName: input.contact.full_name,
    phone: input.contact.phone_e164,
  });
  const safeContactName = sanitizeContactName({
    incomingName: input.contact.full_name,
    phone: input.contact.phone_e164,
    selfNames: [input.clinic.name, input.clinic.evolution_instance_name],
  });
  const leadMemory = mergeContactLeadMemory(
    input.contact.lead_memory_auto,
    input.contact.lead_memory_override
  );

  if (nameReview.status !== "trusted" || !safeContactName) {
    reasons.push("Contact name needs review before personalized follow-up.");
  }

  if (
    (leadMemory.name_confidence === "unknown" ||
      leadMemory.name_confidence === "low") &&
    !leadMemory.confirmed_name
  ) {
    reasons.push("Lead memory has low name confidence.");
  }

  if (input.recentMessageCount < 2) {
    reasons.push("Conversation history is too short for safe automation.");
  }

  if (!input.aiGenerated) {
    reasons.push("AI follow-up was unavailable, so the message used a fallback template.");
  }

  if (
    /\bb2b\b|decision[-\s]?maker|owner|marketing/i.test(
      `${leadMemory.lead_intent} ${leadMemory.follow_up_angle} ${leadMemory.conversation_summary}`
    ) &&
    /\b(book|booking|appointment|treatment plan)\b/i.test(input.message)
  ) {
    reasons.push("Draft may be using a clinic booking angle for a B2B conversation.");
  }

  return [...new Set(reasons)];
}

async function holdAutomationJobForApproval(input: {
  admin: SupabaseAdminClient;
  job: Record<string, unknown>;
  contact: ContactAutomationContext;
  message: string;
  reasons: string[];
}) {
  const payload =
    input.job.payload && typeof input.job.payload === "object"
      ? (input.job.payload as Record<string, unknown>)
      : {};

  await input.admin
    .from("automation_jobs")
    .update({
      status: "needs_approval",
      payload: {
        ...payload,
        approval: {
          draft_message: input.message,
          reasons: input.reasons,
          generated_at: new Date().toISOString(),
          contact_name: input.contact.full_name ?? null,
          phone_e164: input.contact.phone_e164 ?? null,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.job.id as string);
}

function getApprovalPayload(job: Record<string, unknown>) {
  const payload =
    job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : {};
  const approval =
    payload.approval && typeof payload.approval === "object"
      ? (payload.approval as Record<string, unknown>)
      : null;

  return approval;
}

function getApprovalDraftMessage(job: Record<string, unknown>) {
  const approval = getApprovalPayload(job);
  const draftMessage = approval?.draft_message;
  return typeof draftMessage === "string" && draftMessage.trim()
    ? draftMessage.trim()
    : null;
}

async function sendAutomationJobMessage(input: {
  admin: SupabaseAdminClient;
  clinic: ClinicAutomationContext;
  contact: ContactAutomationContext;
  job: Record<string, unknown>;
  message: string;
}) {
  const conversationId = await ensureConversationForContact(
    input.admin,
    input.clinic.id,
    input.job.contact_id as string
  );

  const sendResult = await sendWhatsappMessage({
    clinic: {
      id: input.clinic.id,
      name: input.clinic.name ?? "Clinic",
      evolution_instance_name: input.clinic.evolution_instance_name ?? null,
      evolution_api_url: input.clinic.evolution_api_url ?? null,
      evolution_api_key: input.clinic.evolution_api_key ?? null,
      whatsapp_status: input.clinic.whatsapp_status as
        | "not_connected"
        | "pending_qr"
        | "connected"
        | "disconnected"
        | null,
    },
    contactId: input.job.contact_id as string,
    phone: input.contact.phone_e164 ?? "",
    message: input.message,
    senderType: "bot",
  });

  if (!sendResult.success) {
    return {
      success: false as const,
      error: sendResult.error,
    };
  }

  try {
    await insertMessageRecord(input.admin, {
      clinic_id: input.clinic.id,
      contact_id: input.job.contact_id as string,
      conversation_id: conversationId,
      provider_message_id:
        "providerMessageId" in sendResult ? sendResult.providerMessageId : null,
      direction: "outbound",
      sender_type: "bot",
      content: input.message,
      ai_generated: true,
    });
  } catch (insertMessageError) {
    console.warn("[automation] Failed to store bot outbound message", {
      clinicId: input.clinic.id,
      contactId: input.job.contact_id,
      message:
        insertMessageError instanceof Error
          ? insertMessageError.message
          : String(insertMessageError),
      code:
        insertMessageError &&
        typeof insertMessageError === "object" &&
        "code" in insertMessageError
          ? (insertMessageError as { code?: unknown }).code
          : undefined,
    });
  }

  await input.admin
    .from("contacts")
    .update({
      last_outbound_at: new Date().toISOString(),
      reminder_sent_at:
        input.job.job_type === "same_day_reminder"
          ? new Date().toISOString()
          : undefined,
    })
    .eq("id", input.job.contact_id as string);

  try {
    await enqueueContactMemoryJob(input.admin, {
      clinicId: input.clinic.id,
      contactId: input.job.contact_id as string,
      triggerSource: "message_outbound_bot",
    });
  } catch (error) {
    if (!isContactMemorySchemaMismatchError(error)) {
      throw error;
    }
  }

  await input.admin
    .from("automation_jobs")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.job.id as string);

  return { success: true as const };
}

async function getAutomationRuleMap(
  admin: SupabaseAdminClient,
  clinicIds: string[]
) {
  const { data, error } = await admin
    .from("automation_rules")
    .select("*")
    .in("clinic_id", clinicIds);

  if (error) {
    throw error;
  }

  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const clinicId = row.clinic_id as string;
    const clinicRows = grouped.get(clinicId) ?? [];
    clinicRows.push(row);
    grouped.set(clinicId, clinicRows);
  }

  const ruleMap = new Map<string, AutomationRuleConfig>();
  for (const clinicId of clinicIds) {
    const rules = mergeAutomationRules(grouped.get(clinicId) ?? []);
    for (const rule of rules) {
      ruleMap.set(`${clinicId}:${rule.rule_key}`, rule);
    }
  }

  return ruleMap;
}

function getOrCreateClinicStats(
  statsMap: Map<string, AutomationRunClinicStats>,
  clinicId: string
) {
  const stats = statsMap.get(clinicId) ?? {
    jobs_scanned: 0,
    jobs_sent: 0,
    jobs_failed: 0,
    jobs_skipped: 0,
  };
  statsMap.set(clinicId, stats);
  return stats;
}

async function recordAutomationRunnerRun(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    triggerSource: AutomationTriggerSource;
    requestedByUserId?: string | null;
    startedAt: string;
    completedAt: string;
    status: "completed" | "failed";
    error?: string | null;
    stats: AutomationRunClinicStats;
  }
) {
  const { error } = await admin.from("automation_runner_runs").insert({
    clinic_id: input.clinicId,
    trigger_source: input.triggerSource,
    requested_by_user_id: input.requestedByUserId ?? null,
    status: input.status,
    jobs_scanned: input.stats.jobs_scanned,
    jobs_sent: input.stats.jobs_sent,
    jobs_failed: input.stats.jobs_failed,
    jobs_skipped: input.stats.jobs_skipped,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    error: input.error ?? null,
  });

  if (error && !isAutomationSchemaMismatchError(error)) {
    console.warn("[automation] Failed to record runner activity", {
      clinicId: input.clinicId,
      message: error.message,
      code: error.code,
    });
  }
}

export async function runDueAutomationJobs(
  input: AutomationRunInput
): Promise<AutomationRunNowSummary> {
  const nowIso = new Date().toISOString();
  const startedAt = nowIso;
  let jobsQuery = input.admin
    .from("automation_jobs")
    .select(
      "id, clinic_id, contact_id, rule_key, job_type, template_key, payload, scheduled_for"
    )
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(input.limit ?? 50);

  if (input.clinicId) {
    jobsQuery = jobsQuery.eq("clinic_id", input.clinicId);
  }

  const { data: jobs, error } = await jobsQuery;
  if (error) {
    throw error;
  }

  const clinicStats = new Map<string, AutomationRunClinicStats>();

  if (!jobs || jobs.length === 0) {
    if (input.clinicId) {
      await recordAutomationRunnerRun(input.admin, {
        clinicId: input.clinicId,
        triggerSource: input.triggerSource,
        requestedByUserId: input.requestedByUserId ?? null,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        stats: getOrCreateClinicStats(clinicStats, input.clinicId),
      });
    }

    return {
      processed: 0,
      jobs_scanned: 0,
      jobs_sent: 0,
      jobs_failed: 0,
      jobs_skipped: 0,
    };
  }

  const clinicIds = [...new Set(jobs.map((job) => job.clinic_id as string))];
  const contactIds = [...new Set(jobs.map((job) => job.contact_id as string))];
  const ruleMap = await getAutomationRuleMap(input.admin, clinicIds);

  const [{ data: clinics }, { data: contacts }] = await Promise.all([
    input.admin
      .from("clinics")
      .select(
        "id, name, clinic_prompt, plan_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, evolution_api_url, evolution_api_key, billing_cycle_anchor, payment_received_at, created_at, contact_limit_override, monthly_message_limit_override"
      )
      .in("id", clinicIds),
    input.admin
      .from("contacts")
      .select("*")
      .in("id", contactIds),
  ]);

  const clinicMap = new Map(
    (clinics ?? []).map((clinic) => [clinic.id as string, clinic])
  );
  const contactMap = new Map(
    (contacts ?? []).map((contact) => [contact.id as string, contact])
  );
  const usageMap = new Map<
    string,
    Awaited<ReturnType<typeof getClinicUsageSummary>>
  >();

  let jobsSent = 0;
  let jobsFailed = 0;
  let jobsSkipped = 0;

  for (const job of jobs) {
    const clinicId = job.clinic_id as string;
    const stats = getOrCreateClinicStats(clinicStats, clinicId);
    stats.jobs_scanned += 1;

    const clinic = clinicMap.get(clinicId) as ClinicAutomationContext | undefined;
    const contact = contactMap.get(job.contact_id as string) as
      | ContactAutomationContext
      | undefined;
    if (!clinic || !contact) {
      stats.jobs_failed += 1;
      jobsFailed += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "failed",
          last_error: "Missing clinic or contact context.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    if (
      contact.automation_enabled === false ||
      hasMarketingOptedOut(contact) ||
      contact.bot_mode === "paused" ||
      contact.bot_mode === "handoff_required" ||
      isClosingPipelineStatus(contact.current_status)
    ) {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "skipped",
          cancel_reason: "contact_not_eligible",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    const rule = ruleMap.get(
      `${clinicId}:${(job.rule_key as string | undefined) ?? ""}`
    );
    if (rule && !rule.is_enabled) {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "skipped",
          cancel_reason: "rule_disabled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    // If the rule requires the contact to be in a specific pipeline status,
    // skip the job when that condition is no longer met (e.g. the contact
    // was marked attended but then moved back, or a no-show was resolved).
    if (
      rule?.required_status &&
      rule.required_status !== contact.current_status
    ) {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "skipped",
          cancel_reason: "required_status_not_met",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    if (
      clinic.subscription_status !== "active" ||
      clinic.payment_status !== "received" ||
      clinic.whatsapp_status !== "connected"
    ) {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "skipped",
          cancel_reason: "clinic_unavailable",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    let usage = usageMap.get(clinic.id);
    if (!usage) {
      usage = await getClinicUsageSummary(input.admin, {
        id: clinic.id,
        plan_type: clinic.plan_type ?? "starter",
        payment_received_at: clinic.payment_received_at ?? null,
        billing_cycle_anchor: clinic.billing_cycle_anchor ?? null,
        created_at: clinic.created_at ?? null,
        contact_limit_override: clinic.contact_limit_override ?? null,
        monthly_message_limit_override:
          clinic.monthly_message_limit_override ?? null,
      });
      usageMap.set(clinic.id, usage);
    }

    if (usage.monthly_message_limit_reached) {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "skipped",
          cancel_reason: "message_limit_reached",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    // Deterministic template — always computed so it can act as a safe
    // fallback if the AI follow-up is unavailable.
    const templateMessage = buildAutomationMessage({
      jobType: job.job_type as string,
      payload: (job.payload as Record<string, unknown>) ?? {},
      contactName: getSafeAutomationContactName({
        contactName: contact.full_name ?? null,
        phone: contact.phone_e164 ?? null,
        clinicName: clinic.name ?? null,
        instanceName: clinic.evolution_instance_name ?? null,
      }),
      clinicName: clinic.name ?? "the clinic",
      templateBody: rule?.template_body ?? null,
    });

    let message = templateMessage;
    let aiGeneratedFollowUp = false;
    let recentMessageCount = 0;

    // Re-engagement follow-ups must continue the existing conversation
    // (right names, right direction), so generate them from the transcript
    // via AI. Reminders/recalls stay deterministic — they are transactional.
    if (AI_FOLLOW_UP_JOB_TYPES.has(job.job_type as string)) {
      try {
        const recentMessages = await listMessagesForContact(input.admin, {
          clinicId: clinic.id,
          contactId: job.contact_id as string,
          order: "desc",
          limit: 14,
        });
        recentMessageCount = recentMessages.length;
        const { generateContextualFollowUp } = await import(
          "@/lib/server/whatsapp-chatbot"
        );
        const aiMessage = await generateContextualFollowUp({
          clinicId: clinic.id,
          clinicName: clinic.name ?? null,
          clinicPrompt: clinic.clinic_prompt ?? null,
          contactId: job.contact_id as string,
          contactName: contact.full_name ?? null,
          contact: {
            full_name: contact.full_name ?? null,
            phone_e164: contact.phone_e164 ?? null,
            treatment_interest: contact.treatment_interest ?? null,
            current_status: contact.current_status ?? null,
            source: contact.source ?? null,
            campaign_name: contact.campaign_name ?? null,
            lead_memory_auto: contact.lead_memory_auto ?? null,
            lead_memory_override: contact.lead_memory_override ?? null,
            staff_note: contact.staff_note ?? null,
          },
          followUpStage: (job.rule_key as string | null) ?? (job.job_type as string),
          recentMessages: [...recentMessages].reverse(),
        });
        if (aiMessage) {
          message = aiMessage;
          aiGeneratedFollowUp = true;
        }
      } catch (followUpError) {
        console.warn("[automation] AI follow-up generation failed, using template", {
          clinicId: clinic.id,
          contactId: job.contact_id as string,
          ruleKey: job.rule_key,
          message:
            followUpError instanceof Error
              ? followUpError.message
              : String(followUpError),
        });
      }
    }

    const approvalReasons = getFollowUpApprovalReasons({
      jobType: job.job_type as string,
      message,
      contact,
      clinic,
      recentMessageCount,
      aiGenerated: aiGeneratedFollowUp,
    });

    if (approvalReasons.length > 0) {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await holdAutomationJobForApproval({
        admin: input.admin,
        job,
        contact,
        message,
        reasons: approvalReasons,
      });
      continue;
    }

    const delivery = await sendAutomationJobMessage({
      admin: input.admin,
      clinic,
      contact,
      job,
      message,
    });

    if (!delivery.success) {
      stats.jobs_failed += 1;
      jobsFailed += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "failed",
          last_error: delivery.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    usageMap.set(clinic.id, {
      ...usage,
      monthly_outbound_messages: usage.monthly_outbound_messages + 1,
      monthly_message_limit_reached:
        usage.monthly_outbound_messages + 1 >= usage.monthly_message_limit,
    });

    stats.jobs_sent += 1;
    jobsSent += 1;
  }

  const completedAt = new Date().toISOString();
  for (const [clinicId, stats] of clinicStats.entries()) {
    await recordAutomationRunnerRun(input.admin, {
      clinicId,
      triggerSource: input.triggerSource,
      requestedByUserId: input.requestedByUserId ?? null,
      startedAt,
      completedAt,
      status: "completed",
      stats,
    });
  }

  return {
    processed: jobsSent,
    jobs_scanned: jobs.length,
    jobs_sent: jobsSent,
    jobs_failed: jobsFailed,
    jobs_skipped: jobsSkipped,
  };
}

export async function listAutomationApprovalDrafts(
  client: AutomationClient,
  clinicId: string
): Promise<AutomationApprovalDraft[]> {
  const { data: jobs, error } = await client
    .from("automation_jobs")
    .select("id, contact_id, rule_key, job_type, scheduled_for, payload, created_at")
    .eq("clinic_id", clinicId)
    .eq("status", "needs_approval")
    .order("scheduled_for", { ascending: true })
    .limit(25);

  if (error) {
    throw error;
  }

  const contactIds = [
    ...new Set((jobs ?? []).map((job) => job.contact_id as string)),
  ];
  const contactsById = new Map<string, ContactAutomationContext>();

  if (contactIds.length > 0) {
    const { data: contacts, error: contactsError } = await client
      .from("contacts")
      .select("id, full_name, phone_e164")
      .eq("clinic_id", clinicId)
      .in("id", contactIds);

    if (contactsError) {
      throw contactsError;
    }

    for (const contact of contacts ?? []) {
      contactsById.set(contact.id as string, contact as ContactAutomationContext);
    }
  }

  return (jobs ?? [])
    .map((job) => {
      const draftMessage = getApprovalDraftMessage(job as Record<string, unknown>);
      if (!draftMessage) {
        return null;
      }

      const approval = getApprovalPayload(job as Record<string, unknown>);
      const reasons = Array.isArray(approval?.reasons)
        ? approval.reasons.filter(
            (reason): reason is string => typeof reason === "string"
          )
        : [];
      const contact = contactsById.get(job.contact_id as string);

      return {
        id: job.id as string,
        contact_id: job.contact_id as string,
        contact_name: contact?.full_name ?? null,
        phone_e164: contact?.phone_e164 ?? null,
        rule_key: (job.rule_key as string | null) ?? null,
        job_type: job.job_type as AutomationJobType,
        scheduled_for: job.scheduled_for as string,
        draft_message: draftMessage,
        reasons,
        created_at: job.created_at as string,
      };
    })
    .filter((draft): draft is AutomationApprovalDraft => Boolean(draft));
}

export async function approveAutomationDraft(input: {
  admin: SupabaseAdminClient;
  clinicId: string;
  jobId: string;
}) {
  const { data: job, error: jobError } = await input.admin
    .from("automation_jobs")
    .select("*")
    .eq("clinic_id", input.clinicId)
    .eq("id", input.jobId)
    .eq("status", "needs_approval")
    .maybeSingle();

  if (jobError) {
    throw jobError;
  }

  if (!job) {
    return { success: false as const, error: "Approval draft not found." };
  }

  const draftMessage = getApprovalDraftMessage(job as Record<string, unknown>);
  if (!draftMessage) {
    return { success: false as const, error: "Approval draft has no message." };
  }

  const [{ data: clinic, error: clinicError }, { data: contact, error: contactError }] =
    await Promise.all([
      input.admin
        .from("clinics")
        .select(
          "id, name, plan_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, evolution_api_url, evolution_api_key, payment_received_at, billing_cycle_anchor, created_at, contact_limit_override, monthly_message_limit_override"
        )
        .eq("id", input.clinicId)
        .maybeSingle(),
      input.admin
        .from("contacts")
        .select("*")
        .eq("clinic_id", input.clinicId)
        .eq("id", job.contact_id as string)
        .maybeSingle(),
    ]);

  if (clinicError) {
    throw clinicError;
  }
  if (contactError) {
    throw contactError;
  }
  if (!clinic || !contact) {
    return { success: false as const, error: "Missing clinic or contact context." };
  }

  const contactContext = contact as ContactAutomationContext;
  if (
    contactContext.automation_enabled === false ||
    hasMarketingOptedOut(contactContext) ||
    contactContext.bot_mode === "paused" ||
    contactContext.bot_mode === "handoff_required" ||
    isClosingPipelineStatus(contactContext.current_status)
  ) {
    return { success: false as const, error: "Contact is no longer eligible." };
  }

  const usage = await getClinicUsageSummary(input.admin, {
    id: clinic.id as string,
    plan_type: ((clinic.plan_type as "starter" | "pro") ?? "starter"),
    payment_received_at: (clinic.payment_received_at as string | null) ?? null,
    billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
    created_at: (clinic.created_at as string | null) ?? null,
    contact_limit_override:
      (clinic.contact_limit_override as number | null) ?? null,
    monthly_message_limit_override:
      (clinic.monthly_message_limit_override as number | null) ?? null,
  });

  if (usage.monthly_message_limit_reached) {
    return { success: false as const, error: "Monthly message limit reached." };
  }

  const delivery = await sendAutomationJobMessage({
    admin: input.admin,
    clinic: clinic as ClinicAutomationContext,
    contact: contactContext,
    job: job as Record<string, unknown>,
    message: draftMessage,
  });

  if (!delivery.success) {
    await input.admin
      .from("automation_jobs")
      .update({
        last_error: delivery.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.jobId)
      .eq("clinic_id", input.clinicId);
  }

  return delivery;
}

export async function rejectAutomationDraft(input: {
  client: AutomationClient;
  clinicId: string;
  jobId: string;
}) {
  const { error } = await input.client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "approval_rejected",
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", input.clinicId)
    .eq("id", input.jobId)
    .eq("status", "needs_approval");

  if (error) {
    throw error;
  }

  return { success: true as const };
}

export async function getAutomationHealthSummary(
  client: AutomationClient,
  clinicId: string,
  input: {
    serviceRoleConfigured: boolean;
    runnerSecretConfigured: boolean;
    canManageAutomation: boolean;
  }
): Promise<AutomationHealthSummary> {
  const nowIso = new Date().toISOString();

  const [pendingResult, approvalResult, overdueResult, failedResult, lastRunResult] =
    await Promise.all([
      client
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "pending"),
      client
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "needs_approval"),
      client
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "pending")
        .lte("scheduled_for", nowIso),
      client
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "failed"),
      client
        .from("automation_runner_runs")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  let schemaWarning: string | null = null;
  let lastRun: AutomationRunnerRunSummary | null = null;

  if (lastRunResult.error) {
    if (isAutomationSchemaMismatchError(lastRunResult.error)) {
      schemaWarning =
        "Apply the latest supabase schema to enable automation runner history.";
    } else {
      throw lastRunResult.error;
    }
  } else if (lastRunResult.data) {
    const row = lastRunResult.data as Record<string, unknown>;
    lastRun = {
      id: row.id as string | undefined,
      clinic_id: row.clinic_id as string | undefined,
      trigger_source: row.trigger_source as AutomationTriggerSource,
      status: row.status as "completed" | "failed",
      jobs_scanned: (row.jobs_scanned as number | null) ?? 0,
      jobs_sent: (row.jobs_sent as number | null) ?? 0,
      jobs_failed: (row.jobs_failed as number | null) ?? 0,
      jobs_skipped: (row.jobs_skipped as number | null) ?? 0,
      started_at: row.started_at as string,
      completed_at: (row.completed_at as string | null) ?? null,
      error: (row.error as string | null) ?? null,
    };
  }

  return {
    service_role_configured: input.serviceRoleConfigured,
    runner_secret_configured: input.runnerSecretConfigured,
    can_manage_automation: input.canManageAutomation,
    pending_jobs: pendingResult.count ?? 0,
    approval_jobs: approvalResult.count ?? 0,
    overdue_jobs: overdueResult.count ?? 0,
    failed_jobs: failedResult.count ?? 0,
    last_run: lastRun,
    schema_warning: schemaWarning,
  };
}

// ---------------------------------------------------------------------------
// Clinic-specific recall & post-visit automation
// ---------------------------------------------------------------------------

/**
 * Treatment recall rule keys grouped by clinic specialty.
 * Only rules matching the contact's treatment_category are scheduled.
 */
const RECALL_RULES_BY_CATEGORY: Record<string, string[]> = {
  dental: ["dental_scaling_recall", "dental_checkup_recall"],
  aesthetic: ["aesthetic_botox_recall", "aesthetic_filler_recall"],
  gp: ["gp_annual_checkup_recall"],
  other: ["dental_checkup_recall"],
};

/**
 * Schedule a post-visit follow-up and a treatment recall job after a contact
 * attends their appointment.
 *
 * Called from the contacts PATCH handler when attendance_status → "attended".
 */
export async function schedulePostVisitAndRecallJobs(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    contactId: string;
    treatmentCategory?: string | null;
    lastTreatmentDate?: string | null;
    attendedAt?: string;
  }
) {
  const attendedAt = input.attendedAt ?? new Date().toISOString();
  const baseDate = new Date(attendedAt);
  const nowIso = attendedAt;

  // Load clinic automation rules (respects per-clinic overrides)
  const { data: ruleRows } = await admin
    .from("automation_rules")
    .select("*")
    .eq("clinic_id", input.clinicId);

  const mergedRules = mergeAutomationRules(
    (ruleRows ?? []) as Record<string, unknown>[]
  );
  const ruleByKey = new Map(mergedRules.map((r) => [r.rule_key, r]));

  const jobsToInsert: Record<string, unknown>[] = [];

  // 1. Post-visit follow-up (24 hours after visit) — always schedule
  const postVisitRule =
    ruleByKey.get("post_visit_followup") ??
    DEFAULT_RULE_MAP.get("post_visit_followup");

  if (postVisitRule?.is_enabled !== false) {
    const delay = postVisitRule?.delay_hours ?? 24;
    jobsToInsert.push({
      clinic_id: input.clinicId,
      contact_id: input.contactId,
      rule_key: "post_visit_followup",
      job_type: "post_visit_followup",
      template_key: postVisitRule?.template_key ?? "post_visit_followup",
      status: "pending",
      scheduled_for: new Date(
        baseDate.getTime() + delay * 60 * 60 * 1000
      ).toISOString(),
      payload: {},
    });
  }

  // 2. Treatment recall job(s) — only for the matching category
  const category = (input.treatmentCategory ?? "dental").toLowerCase();
  const recallRuleKeys =
    RECALL_RULES_BY_CATEGORY[category] ?? RECALL_RULES_BY_CATEGORY["dental"];

  for (const ruleKey of recallRuleKeys) {
    const rule = ruleByKey.get(ruleKey) ?? DEFAULT_RULE_MAP.get(ruleKey);
    if (!rule) continue;
    if (rule.is_enabled === false) continue;

    jobsToInsert.push({
      clinic_id: input.clinicId,
      contact_id: input.contactId,
      rule_key: ruleKey,
      job_type: "treatment_recall",
      template_key: rule.template_key ?? ruleKey,
      status: "pending",
      scheduled_for: new Date(
        baseDate.getTime() + rule.delay_hours * 60 * 60 * 1000
      ).toISOString(),
      payload: {
        treatment_category: category,
        last_treatment_date: input.lastTreatmentDate ?? baseDate.toISOString().split("T")[0],
      },
    });
  }

  if (jobsToInsert.length === 0) return;

  // Cancel any existing post_visit_followup / treatment_recall jobs first
  await admin
    .from("automation_jobs")
    .update({
      status: "cancelled",
      cancel_reason: "rescheduled_after_new_visit",
      cancelled_at: nowIso,
    })
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("status", "pending")
    .in("job_type", ["post_visit_followup", "treatment_recall"]);

  const { error } = await admin
    .from("automation_jobs")
    .insert(jobsToInsert);

  if (error && error.code !== "23505" && !isAutomationSchemaMismatchError(error)) {
    throw error;
  }
}

/**
 * Schedule a no-show recovery message 48 hours after a missed appointment.
 *
 * Called from the contacts PATCH handler when attendance_status → "no_show".
 */
export async function scheduleNoShowRecoveryJob(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    contactId: string;
    noShowAt?: string;
  }
) {
  const noShowAt = input.noShowAt ?? new Date().toISOString();
  const baseDate = new Date(noShowAt);

  // Load per-clinic override if any
  const { data: ruleRows } = await admin
    .from("automation_rules")
    .select("*")
    .eq("clinic_id", input.clinicId)
    .eq("rule_key", "no_show_recovery");

  const ruleRow = ((ruleRows ?? []) as Record<string, unknown>[])[0];
  const rule = ruleRow
    ? mapAutomationRuleRow(ruleRow, DEFAULT_RULE_MAP.get("no_show_recovery")!)
    : DEFAULT_RULE_MAP.get("no_show_recovery");

  if (!rule || rule.is_enabled === false) return;

  // Cancel any existing no_show_recovery job for this contact
  await admin
    .from("automation_jobs")
    .update({
      status: "cancelled",
      cancel_reason: "rescheduled_no_show",
      cancelled_at: noShowAt,
    })
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("status", "pending")
    .eq("job_type", "no_show_recovery");

  const { error } = await admin.from("automation_jobs").insert({
    clinic_id: input.clinicId,
    contact_id: input.contactId,
    rule_key: "no_show_recovery",
    job_type: "no_show_recovery",
    template_key: rule.template_key ?? "no_show_recovery",
    status: "pending",
    scheduled_for: new Date(
      baseDate.getTime() + rule.delay_hours * 60 * 60 * 1000
    ).toISOString(),
    payload: {},
  });

  if (error && error.code !== "23505" && !isAutomationSchemaMismatchError(error)) {
    throw error;
  }
}

/** Expose the recall rule keys set for use in the runner. */
export function isRecallRuleKey(ruleKey: string) {
  return RECALL_RULE_KEYS.has(ruleKey);
}
