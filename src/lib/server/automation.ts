import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getClinicUsageSummary } from "@/lib/server/clinic";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { hasMarketingOptedOut } from "@/lib/server/compliance";
import { isClosingPipelineStatus } from "@/lib/server/lead-intelligence";
import { insertMessageRecord } from "@/lib/server/messages";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { sendWhatsappMessage } from "@/lib/server/whatsapp";
import type {
  AutomationHealthSummary,
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
}

interface ContactAutomationContext {
  full_name?: string | null;
  phone_e164?: string | null;
  current_status?: string | null;
  bot_mode?: "active" | "paused" | "handoff_required" | null;
  automation_enabled?: boolean | null;
  marketing_opt_out_at?: string | null;
}

interface ClinicAutomationContext {
  id: string;
  name?: string | null;
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
];

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
    .in("status", ["pending", "processing"]);

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
    .in("status", ["pending", "processing"]);
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
      (rule) => rule.is_enabled && rule.job_type !== "same_day_reminder"
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
    await admin.from("automation_jobs").insert(jobs);
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
    .in("status", ["pending", "processing"]);

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
        "id, name, plan_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, evolution_api_url, evolution_api_key, billing_cycle_anchor, payment_received_at, created_at, contact_limit_override, monthly_message_limit_override"
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

    const conversationId = await ensureConversationForContact(
      input.admin,
      clinic.id,
      job.contact_id as string
    );

    const message = buildAutomationMessage({
      jobType: job.job_type as string,
      payload: (job.payload as Record<string, unknown>) ?? {},
      contactName: contact.full_name ?? "there",
      clinicName: clinic.name ?? "the clinic",
      templateBody: rule?.template_body ?? null,
    });

    const sendResult = await sendWhatsappMessage({
      clinic: {
        id: clinic.id,
        name: clinic.name ?? "Clinic",
        evolution_instance_name: clinic.evolution_instance_name ?? null,
        evolution_api_url: clinic.evolution_api_url ?? null,
        evolution_api_key: clinic.evolution_api_key ?? null,
        whatsapp_status: clinic.whatsapp_status as
          | "not_connected"
          | "pending_qr"
          | "connected"
          | "disconnected"
          | null,
      },
      contactId: job.contact_id as string,
      phone: contact.phone_e164 ?? "",
      message,
      senderType: "bot",
    });

    if (!sendResult.success) {
      stats.jobs_failed += 1;
      jobsFailed += 1;
      await input.admin
        .from("automation_jobs")
        .update({
          status: "failed",
          last_error: sendResult.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    try {
      await insertMessageRecord(input.admin, {
        clinic_id: clinic.id,
        contact_id: job.contact_id as string,
        conversation_id: conversationId,
        provider_message_id:
          "providerMessageId" in sendResult ? sendResult.providerMessageId : null,
        direction: "outbound",
        sender_type: "bot",
        content: message,
        ai_generated: true,
      });
    } catch (insertMessageError) {
      console.warn("[automation] Failed to store bot outbound message", {
        clinicId: clinic.id,
        contactId: job.contact_id as string,
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
          job.job_type === "same_day_reminder"
            ? new Date().toISOString()
            : undefined,
      })
      .eq("id", job.contact_id as string);

    try {
      await enqueueContactMemoryJob(input.admin, {
        clinicId: clinic.id,
        contactId: job.contact_id as string,
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id as string);

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

  const [pendingResult, overdueResult, failedResult, lastRunResult] =
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
    overdue_jobs: overdueResult.count ?? 0,
    failed_jobs: failedResult.count ?? 0,
    last_run: lastRun,
    schema_warning: schemaWarning,
  };
}
