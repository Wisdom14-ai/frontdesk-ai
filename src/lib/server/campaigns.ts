import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BROADCAST_SEGMENT_FIELD_DEFINITIONS,
  buildBroadcastTemplateMessage,
  doesRecordMatchBroadcastFilters,
} from "@/lib/campaigns";
import { getClinicUsageSummary } from "@/lib/server/clinic";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { insertMessageRecord } from "@/lib/server/messages";
import {
  isAutomationSchemaMismatchError,
  scheduleFollowUpJobs,
} from "@/lib/server/automation";
import { hasMarketingOptedOut } from "@/lib/server/compliance";
import {
  appendCampaignLinkParams,
  rewriteCampaignLinks,
} from "@/lib/server/campaign-links";
import {
  buildPhoneLookupVariants,
  normalizePhoneNumber,
  sendWhatsappMessage,
} from "@/lib/server/whatsapp";
import type {
  BroadcastCampaign,
  BroadcastCampaignAnalytics,
  BroadcastCampaignCreatePayload,
  BroadcastCampaignHealthSummary,
  BroadcastCampaignJobStatus,
  BroadcastCampaignListPayload,
  BroadcastManualRecipientInput,
  BroadcastCampaignRunNowSummary,
  BroadcastCampaignRunnerRunSummary,
  BroadcastCampaignStatus,
  BroadcastCampaignTriggerSource,
  BroadcastSegmentFilter,
} from "@/types";

type CampaignClient = SupabaseClient;

interface CampaignContactContext {
  id: string;
  clinic_id: string;
  full_name?: string | null;
  phone_e164?: string | null;
  treatment_interest?: string | null;
  current_status?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  assigned_user_id?: string | null;
  bot_mode?: string | null;
  automation_enabled?: boolean | null;
  marketing_opt_out_at?: string | null;
  marketing_opt_out_reason?: string | null;
  unread_count?: number | null;
  appointment_date?: string | null;
  created_at?: string | null;
}

interface CampaignClinicContext {
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

interface NormalizedManualRecipient {
  phone_e164: string;
  full_name: string | null;
  treatment_interest: string | null;
}

interface CampaignRunInput {
  client: CampaignClient;
  clinicId?: string;
  campaignId?: string;
  triggerSource: BroadcastCampaignTriggerSource;
  requestedByUserId?: string | null;
  limit?: number;
}

interface CampaignRunClinicStats {
  jobs_scanned: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_skipped: number;
  jobs_cancelled: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAMPAIGN_LIST_LIMIT = 50;
const CAMPAIGN_CONTACT_SELECT = "*";
const INVALID_NUMBER_ERROR_PATTERNS = [
  /valid account/i,
  /phone number is invalid/i,
  /number format/i,
];

function isPostgrestLikeError(error: unknown): error is { code?: string; message?: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("code" in error || "message" in error)
  );
}

export function isBroadcastSchemaMismatchError(error: unknown) {
  return (
    isPostgrestLikeError(error) &&
    (error.code === "42703" ||
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205")
  );
}

function toIsoString(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeBroadcastCampaignStatus(value: unknown): BroadcastCampaignStatus {
  switch (value) {
    case "scheduled":
    case "running":
    case "completed":
    case "completed_with_errors":
    case "cancelled":
    case "halted":
      return value;
    default:
      return "scheduled";
  }
}

function normalizeBroadcastJobStatus(value: unknown): BroadcastCampaignJobStatus {
  switch (value) {
    case "pending":
    case "processing":
    case "sent":
    case "failed":
    case "skipped":
    case "cancelled":
      return value;
    default:
      return "pending";
  }
}

function normalizeBroadcastSegmentFilters(input: unknown): BroadcastSegmentFilter[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const allowedFields = new Set(
    BROADCAST_SEGMENT_FIELD_DEFINITIONS.map((definition) => definition.field)
  );

  return input
    .map((filter, index) => {
      if (!filter || typeof filter !== "object") {
        return null;
      }

      const row = filter as Record<string, unknown>;
      const field =
        typeof row.field === "string" &&
        allowedFields.has(row.field as BroadcastSegmentFilter["field"])
          ? (row.field as BroadcastSegmentFilter["field"])
          : null;
      const values = Array.isArray(row.values)
        ? [
            ...new Set(
              row.values
                .filter(
                  (value): value is string =>
                    typeof value === "string" && value.trim().length > 0
                )
                .map((value) => value.trim())
            ),
          ]
        : [];

      if (!field || values.length === 0) {
        return null;
      }

      return {
        id:
          typeof row.id === "string" && row.id.trim().length > 0
            ? row.id.trim()
            : `segment-${index + 1}`,
        field,
        values,
      } satisfies BroadcastSegmentFilter;
    })
    .filter((filter): filter is BroadcastSegmentFilter => Boolean(filter));
}

function mapCampaignRow(row: Record<string, unknown>): BroadcastCampaign {
  return {
    id: row.id as string,
    clinic_id: row.clinic_id as string,
    name: (row.name as string) ?? "Broadcast campaign",
    status: normalizeBroadcastCampaignStatus(row.status),
    delivery_type: row.delivery_type === "scheduled" ? "scheduled" : "send_now",
    message_template: (row.message_template as string) ?? "",
    segment_filters: normalizeBroadcastSegmentFilters(row.segment_filters),
    scheduled_for:
      toIsoString(row.scheduled_for as string | null) ?? new Date().toISOString(),
    daily_send_cap: Number(row.daily_send_cap ?? 1) || 1,
    stop_on_invalid_number: Boolean(row.stop_on_invalid_number),
    total_recipients: Number(row.total_recipients ?? 0) || 0,
    pending_count: Number(row.pending_count ?? 0) || 0,
    sent_count: Number(row.sent_count ?? 0) || 0,
    failed_count: Number(row.failed_count ?? 0) || 0,
    skipped_count: Number(row.skipped_count ?? 0) || 0,
    cancelled_count: Number(row.cancelled_count ?? 0) || 0,
    invalid_count: Number(row.invalid_count ?? 0) || 0,
    replied_count: Number(row.replied_count ?? 0) || 0,
    delivered_count: Number(row.delivered_count ?? 0) || 0,
    read_count: Number(row.read_count ?? 0) || 0,
    clicked_count: Number(row.clicked_count ?? 0) || 0,
    opted_out_count: Number(row.opted_out_count ?? 0) || 0,
    created_by_user_id: (row.created_by_user_id as string | null) ?? null,
    created_by_name: (row.created_by_name as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    started_at: toIsoString(row.started_at as string | null),
    completed_at: toIsoString(row.completed_at as string | null),
    created_at:
      toIsoString(row.created_at as string | null) ?? new Date().toISOString(),
    updated_at:
      toIsoString(row.updated_at as string | null) ?? new Date().toISOString(),
  };
}

function buildBroadcastCampaignAnalytics(
  campaigns: BroadcastCampaign[]
): BroadcastCampaignAnalytics {
  return campaigns.reduce<BroadcastCampaignAnalytics>(
    (summary, campaign) => {
      summary.total_campaigns += 1;
      summary.total_recipients += campaign.total_recipients;
      summary.total_sent += campaign.sent_count;
      summary.total_failed += campaign.failed_count;
      summary.total_skipped += campaign.skipped_count;
      summary.total_cancelled += campaign.cancelled_count;
      summary.total_invalid += campaign.invalid_count;
      summary.total_replies += campaign.replied_count;
      summary.total_delivered += campaign.delivered_count;
      summary.total_read += campaign.read_count;
      summary.total_clicked += campaign.clicked_count;
      summary.total_opted_out += campaign.opted_out_count;

      if (campaign.status === "scheduled") {
        summary.scheduled_campaigns += 1;
      } else if (campaign.status === "running") {
        summary.running_campaigns += 1;
      } else if (
        campaign.status === "completed" ||
        campaign.status === "completed_with_errors"
      ) {
        summary.completed_campaigns += 1;
      } else if (campaign.status === "halted") {
        summary.halted_campaigns += 1;
      }

      return summary;
    },
    {
      total_campaigns: 0,
      scheduled_campaigns: 0,
      running_campaigns: 0,
      completed_campaigns: 0,
      halted_campaigns: 0,
      total_recipients: 0,
      total_sent: 0,
      total_failed: 0,
      total_skipped: 0,
      total_cancelled: 0,
      total_invalid: 0,
      total_replies: 0,
      total_delivered: 0,
      total_read: 0,
      total_clicked: 0,
      total_opted_out: 0,
    }
  );
}

async function listCampaignRows(
  client: CampaignClient,
  clinicId: string,
  limit = DEFAULT_CAMPAIGN_LIST_LIMIT
) {
  const { data, error } = await client
    .from("broadcast_campaigns")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as Record<string, unknown>[];
}

async function fetchCampaignContacts(client: CampaignClient, clinicId: string) {
  const { data, error } = await client
    .from("contacts")
    .select(CAMPAIGN_CONTACT_SELECT)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as CampaignContactContext[];
}

function cleanManualRecipientText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeManualRecipients(
  input: BroadcastManualRecipientInput[] | undefined
) {
  if (!Array.isArray(input)) {
    return [];
  }

  const recipientsByPhone = new Map<string, NormalizedManualRecipient>();
  const invalidNumbers: string[] = [];

  for (const recipient of input) {
    if (!recipient || typeof recipient !== "object") {
      continue;
    }

    const rawPhone = cleanManualRecipientText(recipient.phone_e164);
    if (!rawPhone) {
      continue;
    }

    const phone = normalizePhoneNumber(rawPhone);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      invalidNumbers.push(rawPhone);
      continue;
    }

    const existing = recipientsByPhone.get(phone);
    const fullName = cleanManualRecipientText(recipient.full_name);
    const treatmentInterest = cleanManualRecipientText(recipient.treatment_interest);

    recipientsByPhone.set(phone, {
      phone_e164: phone,
      full_name: existing?.full_name ?? fullName,
      treatment_interest: existing?.treatment_interest ?? treatmentInterest,
    });
  }

  if (invalidNumbers.length > 0) {
    throw new Error(
      `Invalid manual WhatsApp number${invalidNumbers.length === 1 ? "" : "s"}: ${invalidNumbers
        .slice(0, 5)
        .join(", ")}`
    );
  }

  return [...recipientsByPhone.values()];
}

function shouldFillTreatment(current: string | null | undefined) {
  const normalized = current?.trim().toLowerCase();
  return !normalized || normalized === "unknown" || normalized === "general inquiry";
}

function shouldFillName(contact: CampaignContactContext) {
  const name = contact.full_name?.trim();
  if (!name) {
    return true;
  }

  const normalizedName = normalizePhoneNumber(name);
  const normalizedPhone = normalizePhoneNumber(contact.phone_e164 ?? "");
  return name === contact.phone_e164 || (normalizedPhone && normalizedName === normalizedPhone);
}

async function getCampaignClinicContext(
  client: CampaignClient,
  clinicId: string
): Promise<CampaignClinicContext> {
  const { data, error } = await client
    .from("clinics")
    .select(
      "id, plan_type, payment_received_at, billing_cycle_anchor, created_at, contact_limit_override, monthly_message_limit_override"
    )
    .eq("id", clinicId)
    .single();

  if (error || !data) {
    throw error ?? new Error("Clinic not found.");
  }

  return data as CampaignClinicContext;
}

async function ensureManualRecipientContacts(
  client: CampaignClient,
  input: {
    clinicId: string;
    campaignName: string;
    manualRecipients: NormalizedManualRecipient[];
  }
) {
  if (input.manualRecipients.length === 0) {
    return [];
  }

  const phones = [
    ...new Set(
      input.manualRecipients.flatMap((recipient) =>
        buildPhoneLookupVariants(recipient.phone_e164)
      )
    ),
  ];
  const { data: existingRows, error: existingError } = await client
    .from("contacts")
    .select(CAMPAIGN_CONTACT_SELECT)
    .eq("clinic_id", input.clinicId)
    .in("phone_e164", phones);

  if (existingError) {
    throw existingError;
  }

  const contactsByPhone = new Map<string, CampaignContactContext>();
  for (const contact of (existingRows ?? []) as CampaignContactContext[]) {
    const normalizedPhone = normalizePhoneNumber(contact.phone_e164 ?? "");
    if (normalizedPhone && !contactsByPhone.has(normalizedPhone)) {
      contactsByPhone.set(normalizedPhone, contact);
    }
  }

  const newRecipients = input.manualRecipients.filter(
    (recipient) => !contactsByPhone.has(recipient.phone_e164)
  );

  if (newRecipients.length > 0) {
    const clinic = await getCampaignClinicContext(client, input.clinicId);
    const usage = await getClinicUsageSummary(client, {
      id: clinic.id,
      plan_type: clinic.plan_type ?? "starter",
      payment_received_at: clinic.payment_received_at ?? null,
      billing_cycle_anchor: clinic.billing_cycle_anchor ?? null,
      created_at: clinic.created_at ?? null,
      contact_limit_override: clinic.contact_limit_override ?? null,
      monthly_message_limit_override: clinic.monthly_message_limit_override ?? null,
    });
    const remainingContacts = Math.max(0, usage.contact_limit - usage.active_contacts);

    if (newRecipients.length > remainingContacts) {
      throw new Error(
        `Manual recipients would exceed this clinic's contact limit. ${remainingContacts} contact slot${remainingContacts === 1 ? "" : "s"} remaining.`
      );
    }

    const nowIso = new Date().toISOString();
    const { data: insertedRows, error: insertError } = await client
      .from("contacts")
      .insert(
        newRecipients.map((recipient) => ({
          clinic_id: input.clinicId,
          full_name: recipient.full_name ?? recipient.phone_e164,
          phone_e164: recipient.phone_e164,
          treatment_interest: recipient.treatment_interest,
          current_status: "new_lead",
          source: "manual_campaign",
          lead_source_detail: "manual_campaign_recipient",
          campaign_name: input.campaignName,
          bot_mode: "active",
          automation_enabled: true,
          unread_count: 0,
          created_at: nowIso,
          updated_at: nowIso,
        }))
      )
      .select(CAMPAIGN_CONTACT_SELECT);

    if (insertError) {
      throw insertError;
    }

    for (const contact of (insertedRows ?? []) as CampaignContactContext[]) {
      const normalizedPhone = normalizePhoneNumber(contact.phone_e164 ?? "");
      if (normalizedPhone) {
        contactsByPhone.set(normalizedPhone, contact);
      }
    }
  }

  for (const recipient of input.manualRecipients) {
    const contact = contactsByPhone.get(recipient.phone_e164);
    if (!contact) {
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (recipient.full_name && shouldFillName(contact)) {
      updates.full_name = recipient.full_name;
      contact.full_name = recipient.full_name;
    }
    if (recipient.treatment_interest && shouldFillTreatment(contact.treatment_interest)) {
      updates.treatment_interest = recipient.treatment_interest;
      contact.treatment_interest = recipient.treatment_interest;
    }
    if (!contact.source) {
      updates.source = "manual_campaign";
      contact.source = "manual_campaign";
    }
    if (!contact.campaign_name) {
      updates.campaign_name = input.campaignName;
      contact.campaign_name = input.campaignName;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await client
        .from("contacts")
        .update(updates)
        .eq("id", contact.id)
        .eq("clinic_id", input.clinicId);

      if (error) {
        throw error;
      }
    }
  }

  return input.manualRecipients
    .map((recipient) => contactsByPhone.get(recipient.phone_e164))
    .filter((contact): contact is CampaignContactContext => Boolean(contact));
}

function buildScheduledTimestamp(baseDate: Date, index: number, dailySendCap: number) {
  const safeDailyCap = Math.max(1, Math.round(dailySendCap));
  const dayOffset = Math.floor(index / safeDailyCap);
  return new Date(baseDate.getTime() + dayOffset * DAY_IN_MS).toISOString();
}

function isInvalidWhatsappRecipientError(message?: string | null) {
  if (!message) {
    return false;
  }

  return INVALID_NUMBER_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function getOrCreateClinicStats(
  statsMap: Map<string, CampaignRunClinicStats>,
  clinicId: string
) {
  const stats = statsMap.get(clinicId) ?? {
    jobs_scanned: 0,
    jobs_sent: 0,
    jobs_failed: 0,
    jobs_skipped: 0,
    jobs_cancelled: 0,
  };
  statsMap.set(clinicId, stats);
  return stats;
}

async function recordBroadcastCampaignRunnerRun(
  client: CampaignClient,
  input: {
    clinicId: string;
    triggerSource: BroadcastCampaignTriggerSource;
    requestedByUserId?: string | null;
    startedAt: string;
    completedAt: string;
    status: "completed" | "failed";
    error?: string | null;
    stats: CampaignRunClinicStats;
  }
) {
  const { error } = await client.from("broadcast_campaign_runner_runs").insert({
    clinic_id: input.clinicId,
    trigger_source: input.triggerSource,
    requested_by_user_id: input.requestedByUserId ?? null,
    status: input.status,
    jobs_scanned: input.stats.jobs_scanned,
    jobs_sent: input.stats.jobs_sent,
    jobs_failed: input.stats.jobs_failed,
    jobs_skipped: input.stats.jobs_skipped,
    jobs_cancelled: input.stats.jobs_cancelled,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    error: input.error ?? null,
  });

  if (error && !isBroadcastSchemaMismatchError(error)) {
    console.warn("[campaigns] Failed to record runner activity", {
      clinicId: input.clinicId,
      message: error.message,
      code: error.code,
    });
  }
}

async function syncBroadcastCampaignStats(
  client: CampaignClient,
  campaignIds: string[]
) {
  if (campaignIds.length === 0) {
    return;
  }

  const campaignRowsResult = await client
    .from("broadcast_campaigns")
    .select("id, status, started_at, completed_at")
    .in("id", campaignIds);

  // Try the full select with all analytics columns first
  const jobsWithAnalyticsResult = await client
    .from("broadcast_campaign_jobs")
    .select(
      "campaign_id, status, scheduled_for, failure_code, reply_count, delivered_at, read_at, click_count, opted_out_at"
    )
    .in("campaign_id", campaignIds);

  const hasAnalyticsColumns = !(
    jobsWithAnalyticsResult.error &&
    isBroadcastSchemaMismatchError(jobsWithAnalyticsResult.error)
  );

  let hasReplyCountColumn = hasAnalyticsColumns;

  if (campaignRowsResult.error) {
    throw campaignRowsResult.error;
  }

  let jobRows: Array<Record<string, unknown>>;
  if (hasAnalyticsColumns) {
    if (jobsWithAnalyticsResult.error) {
      throw jobsWithAnalyticsResult.error;
    }
    jobRows = (jobsWithAnalyticsResult.data ?? []) as Array<Record<string, unknown>>;
  } else {
    // Fall back to reply_count only (analytics columns not yet migrated)
    const replyOnlyResult = await client
      .from("broadcast_campaign_jobs")
      .select("campaign_id, status, scheduled_for, failure_code, reply_count")
      .in("campaign_id", campaignIds);

    if (
      replyOnlyResult.error &&
      isBroadcastSchemaMismatchError(replyOnlyResult.error)
    ) {
      hasReplyCountColumn = false;
      const fallbackJobsResult = await client
        .from("broadcast_campaign_jobs")
        .select("campaign_id, status, scheduled_for, failure_code")
        .in("campaign_id", campaignIds);

      if (fallbackJobsResult.error) {
        throw fallbackJobsResult.error;
      }

      jobRows = (fallbackJobsResult.data ?? []) as Array<Record<string, unknown>>;
    } else if (replyOnlyResult.error) {
      throw replyOnlyResult.error;
    } else {
      jobRows = (replyOnlyResult.data ?? []) as Array<Record<string, unknown>>;
    }
  }

  const jobsByCampaign = new Map<string, Array<Record<string, unknown>>>();
  for (const job of jobRows) {
    const campaignId = job.campaign_id as string;
    const currentJobs = jobsByCampaign.get(campaignId) ?? [];
    currentJobs.push(job);
    jobsByCampaign.set(campaignId, currentJobs);
  }

  const nowIso = new Date().toISOString();
  for (const campaignRow of (campaignRowsResult.data ?? []) as Array<Record<string, unknown>>) {
    const campaignId = campaignRow.id as string;
    const jobs = jobsByCampaign.get(campaignId) ?? [];
    const pendingJobs = jobs.filter(
      (job) => normalizeBroadcastJobStatus(job.status) === "pending"
    );
    const sentCount = jobs.filter(
      (job) => normalizeBroadcastJobStatus(job.status) === "sent"
    ).length;
    const failedCount = jobs.filter(
      (job) => normalizeBroadcastJobStatus(job.status) === "failed"
    ).length;
    const skippedCount = jobs.filter(
      (job) => normalizeBroadcastJobStatus(job.status) === "skipped"
    ).length;
    const cancelledCount = jobs.filter(
      (job) => normalizeBroadcastJobStatus(job.status) === "cancelled"
    ).length;
    const invalidCount = jobs.filter(
      (job) => (job.failure_code as string | null) === "invalid_number"
    ).length;
    const repliedCount = jobs.filter(
      (job) => Number(job.reply_count ?? 0) > 0
    ).length;
    const deliveredCount = jobs.filter((job) => Boolean(job.delivered_at)).length;
    const readCount = jobs.filter((job) => Boolean(job.read_at)).length;
    const clickedCount = jobs.filter(
      (job) => Number(job.click_count ?? 0) > 0
    ).length;
    const optedOutCount = jobs.filter((job) => Boolean(job.opted_out_at)).length;
    const nextPendingAt = pendingJobs
      .map((job) => toIsoString(job.scheduled_for as string | null))
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const currentStatus = normalizeBroadcastCampaignStatus(campaignRow.status);

    let nextStatus: BroadcastCampaignStatus;
    if (currentStatus === "cancelled") {
      nextStatus = "cancelled";
    } else if (currentStatus === "halted") {
      nextStatus = "halted";
    } else if (pendingJobs.length > 0) {
      nextStatus = nextPendingAt && nextPendingAt > nowIso ? "scheduled" : "running";
    } else if (
      failedCount > 0 ||
      skippedCount > 0 ||
      cancelledCount > 0 ||
      invalidCount > 0
    ) {
      nextStatus = "completed_with_errors";
    } else {
      nextStatus = "completed";
    }

    const updates: Record<string, unknown> = {
      status: nextStatus,
      total_recipients: jobs.length,
      pending_count: pendingJobs.length,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      cancelled_count: cancelledCount,
      invalid_count: invalidCount,
      updated_at: nowIso,
      started_at:
        (campaignRow.started_at as string | null) ??
        (jobs.length > 0 && nextStatus !== "scheduled" ? nowIso : null),
      completed_at:
        nextStatus === "scheduled" || nextStatus === "running" ? null : nowIso,
    };

    if (hasReplyCountColumn) {
      updates.replied_count = repliedCount;
    }

    if (hasAnalyticsColumns) {
      updates.delivered_count = deliveredCount;
      updates.read_count = readCount;
      updates.clicked_count = clickedCount;
      updates.opted_out_count = optedOutCount;
    }

    let { error } = await client
      .from("broadcast_campaigns")
      .update(updates)
      .eq("id", campaignId);

    if (error && isBroadcastSchemaMismatchError(error)) {
      // Strip optional columns and retry
      const fallbackUpdates = { ...updates };
      delete fallbackUpdates.delivered_count;
      delete fallbackUpdates.read_count;
      delete fallbackUpdates.clicked_count;
      delete fallbackUpdates.opted_out_count;
      delete fallbackUpdates.replied_count;

      const fallback = await client
        .from("broadcast_campaigns")
        .update(fallbackUpdates)
        .eq("id", campaignId);
      error = fallback.error;
    }

    if (error) {
      throw error;
    }
  }
}

export async function markBroadcastCampaignReplyForContact(
  client: CampaignClient,
  input: {
    clinicId: string;
    contactId: string;
    repliedAt?: string;
  }
) {
  const repliedAt = input.repliedAt ?? new Date().toISOString();
  const { data, error } = await client
    .from("broadcast_campaign_jobs")
    .select("id, campaign_id, first_reply_at, reply_count, sent_at")
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && isBroadcastSchemaMismatchError(error)) {
    return;
  }

  if (error) {
    throw error;
  }

  if (!data) {
    return;
  }

  const job = data as Record<string, unknown>;
  const updateResult = await client
    .from("broadcast_campaign_jobs")
    .update({
      first_reply_at: (job.first_reply_at as string | null) ?? repliedAt,
      last_reply_at: repliedAt,
      reply_count: Number(job.reply_count ?? 0) + 1,
      updated_at: repliedAt,
    })
    .eq("id", job.id as string)
    .eq("clinic_id", input.clinicId);

  if (updateResult.error) {
    if (isBroadcastSchemaMismatchError(updateResult.error)) {
      return;
    }

    throw updateResult.error;
  }

  await syncBroadcastCampaignStats(client, [job.campaign_id as string]);
}

async function haltBroadcastCampaign(
  client: CampaignClient,
  input: { campaignId: string; clinicId: string; errorMessage: string }
) {
  const nowIso = new Date().toISOString();

  const { data, error } = await client
    .from("broadcast_campaign_jobs")
    .update({
      status: "cancelled",
      cancel_reason: "campaign_halted_invalid_number",
      updated_at: nowIso,
    })
    .eq("campaign_id", input.campaignId)
    .eq("clinic_id", input.clinicId)
    .in("status", ["pending", "processing"])
    .select("id");

  if (error) {
    throw error;
  }

  const { error: campaignError } = await client
    .from("broadcast_campaigns")
    .update({
      status: "halted",
      last_error: input.errorMessage,
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", input.campaignId)
    .eq("clinic_id", input.clinicId);

  if (campaignError) {
    throw campaignError;
  }

  return (data ?? []).length;
}

export async function createBroadcastCampaign(
  client: CampaignClient,
  input: BroadcastCampaignCreatePayload & {
    clinicId: string;
    createdByUserId: string;
    createdByName: string;
  }
) {
  const messageTemplate = input.message_template.trim();
  const name = input.name.trim();
  const segmentFilters = normalizeBroadcastSegmentFilters(input.segment_filters);
  const manualRecipients = normalizeManualRecipients(input.manual_recipients);
  const dailySendCap = Math.max(1, Math.round(input.daily_send_cap || 1));

  if (!name) {
    throw new Error("Campaign name is required.");
  }

  if (!messageTemplate) {
    throw new Error("Broadcast message is required.");
  }

  if (segmentFilters.length === 0 && manualRecipients.length === 0) {
    throw new Error("Add at least one CRM segment or manual WhatsApp number.");
  }

  const baseScheduledAt =
    input.delivery_type === "scheduled"
      ? toIsoString(input.scheduled_for ?? null)
      : new Date().toISOString();

  if (!baseScheduledAt) {
    throw new Error("A valid scheduled date and time is required.");
  }

  const contacts =
    segmentFilters.length > 0 ? await fetchCampaignContacts(client, input.clinicId) : [];
  const segmentRecipients =
    segmentFilters.length > 0
      ? contacts
          .filter((contact) => doesRecordMatchBroadcastFilters(contact, segmentFilters))
          .sort((left, right) => {
            const leftDate = toIsoString(left.created_at ?? null) ?? "";
            const rightDate = toIsoString(right.created_at ?? null) ?? "";
            return leftDate.localeCompare(rightDate);
          })
      : [];
  const manualRecipientContacts = await ensureManualRecipientContacts(client, {
    clinicId: input.clinicId,
    campaignName: name,
    manualRecipients,
  });

  const recipientsById = new Map<string, CampaignContactContext>();
  for (const contact of segmentRecipients) {
    recipientsById.set(contact.id, contact);
  }
  for (const contact of manualRecipientContacts) {
    recipientsById.set(contact.id, contact);
  }
  const recipients = [...recipientsById.values()].filter(
    (contact) =>
      !hasMarketingOptedOut(contact) && contact.current_status !== "trash"
  );

  if (recipients.length === 0) {
    throw new Error("No eligible contacts matched the selected CRM segments or manual numbers.");
  }

  const initialStatus: BroadcastCampaignStatus =
    baseScheduledAt > new Date().toISOString() ? "scheduled" : "running";

  const { data: createdRow, error } = await client
    .from("broadcast_campaigns")
    .insert({
      clinic_id: input.clinicId,
      name,
      status: initialStatus,
      delivery_type: input.delivery_type,
      message_template: messageTemplate,
      segment_filters: segmentFilters,
      scheduled_for: baseScheduledAt,
      daily_send_cap: dailySendCap,
      stop_on_invalid_number: input.stop_on_invalid_number,
      total_recipients: recipients.length,
      pending_count: recipients.length,
      created_by_user_id: input.createdByUserId,
      created_by_name: input.createdByName,
      started_at: initialStatus === "running" ? new Date().toISOString() : null,
    })
    .select("*")
    .single();

  if (error || !createdRow) {
    throw error ?? new Error("Failed to create the campaign.");
  }

  const campaign = mapCampaignRow(createdRow as Record<string, unknown>);
  const baseDate = new Date(baseScheduledAt);

  const jobRows = recipients.map((contact, index) => ({
    clinic_id: input.clinicId,
    campaign_id: campaign.id,
    contact_id: contact.id,
    status: "pending",
    scheduled_for: buildScheduledTimestamp(baseDate, index, dailySendCap),
  }));

  const { error: jobsError } = await client
    .from("broadcast_campaign_jobs")
    .insert(jobRows);

  if (jobsError) {
    throw jobsError;
  }

  await syncBroadcastCampaignStats(client, [campaign.id]);
  return campaign.id;
}

export async function cancelBroadcastCampaign(
  client: CampaignClient,
  input: { clinicId: string; campaignId: string }
) {
  const nowIso = new Date().toISOString();

  const { data: campaignRow, error: campaignError } = await client
    .from("broadcast_campaigns")
    .select("*")
    .eq("id", input.campaignId)
    .eq("clinic_id", input.clinicId)
    .maybeSingle();

  if (campaignError) {
    throw campaignError;
  }

  if (!campaignRow) {
    throw new Error("Campaign not found.");
  }

  const campaign = mapCampaignRow(campaignRow as Record<string, unknown>);
  if (
    campaign.status === "completed" ||
    campaign.status === "completed_with_errors" ||
    campaign.status === "cancelled"
  ) {
    return campaign;
  }

  const { error: jobsError } = await client
    .from("broadcast_campaign_jobs")
    .update({
      status: "cancelled",
      cancel_reason: "manual_cancelled",
      updated_at: nowIso,
    })
    .eq("campaign_id", input.campaignId)
    .eq("clinic_id", input.clinicId)
    .in("status", ["pending", "processing"]);

  if (jobsError) {
    throw jobsError;
  }

  const { error: updateError } = await client
    .from("broadcast_campaigns")
    .update({
      status: "cancelled",
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", input.campaignId)
    .eq("clinic_id", input.clinicId);

  if (updateError) {
    throw updateError;
  }

  await syncBroadcastCampaignStats(client, [input.campaignId]);
  const rows = await listCampaignRows(client, input.clinicId, DEFAULT_CAMPAIGN_LIST_LIMIT);
  const updated = rows.find((row) => row.id === input.campaignId);
  if (!updated) {
    throw new Error("Campaign could not be reloaded after cancelling.");
  }

  return mapCampaignRow(updated);
}

export async function listBroadcastCampaigns(
  client: CampaignClient,
  clinicId: string
) {
  const rows = await listCampaignRows(client, clinicId);
  const campaigns = rows.map((row) => mapCampaignRow(row));

  return {
    campaigns,
    analytics: buildBroadcastCampaignAnalytics(campaigns),
  };
}

export async function runDueBroadcastCampaignJobs(
  input: CampaignRunInput
): Promise<BroadcastCampaignRunNowSummary> {
  const nowIso = new Date().toISOString();
  const startedAt = nowIso;

  let jobsQuery = input.client
    .from("broadcast_campaign_jobs")
    .select("id, campaign_id, clinic_id, contact_id, scheduled_for")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(input.limit ?? 100);

  if (input.clinicId) {
    jobsQuery = jobsQuery.eq("clinic_id", input.clinicId);
  }

  if (input.campaignId) {
    jobsQuery = jobsQuery.eq("campaign_id", input.campaignId);
  }

  const { data: jobs, error } = await jobsQuery;
  if (error) {
    throw error;
  }

  const clinicStats = new Map<string, CampaignRunClinicStats>();

  if (!jobs || jobs.length === 0) {
    if (input.clinicId) {
      await recordBroadcastCampaignRunnerRun(input.client, {
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
      jobs_cancelled: 0,
    };
  }

  const clinicIds = [...new Set(jobs.map((job) => job.clinic_id as string))];
  const contactIds = [...new Set(jobs.map((job) => job.contact_id as string))];
  const campaignIds = [...new Set(jobs.map((job) => job.campaign_id as string))];

  const [{ data: campaigns }, { data: clinics }, { data: contacts }] =
    await Promise.all([
      input.client
        .from("broadcast_campaigns")
        .select("*")
        .in("id", campaignIds),
      input.client
        .from("clinics")
        .select(
          "id, name, plan_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, evolution_api_url, evolution_api_key, billing_cycle_anchor, payment_received_at, created_at, contact_limit_override, monthly_message_limit_override"
        )
        .in("id", clinicIds),
      input.client
        .from("contacts")
        .select("*")
        .in("id", contactIds),
    ]);

  const campaignMap = new Map(
    (campaigns ?? []).map((campaign) => [
      campaign.id as string,
      mapCampaignRow(campaign as Record<string, unknown>),
    ])
  );
  const clinicMap = new Map(
    (clinics ?? []).map((clinic) => [clinic.id as string, clinic as CampaignClinicContext])
  );
  const contactMap = new Map(
    (contacts ?? []).map((contact) => [
      contact.id as string,
      contact as CampaignContactContext,
    ])
  );

  const usageMap = new Map<
    string,
    Awaited<ReturnType<typeof getClinicUsageSummary>>
  >();

  // Per-campaign URL rewrite cache: campaignId → Map<originalUrl, shortUrl>
  // Populated lazily on first send for each campaign.
  const campaignLinkMapCache = new Map<string, Map<string, string>>();

  const appBaseUrl =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://app.frontdesk-ai.cloud";

  let jobsSent = 0;
  let jobsFailed = 0;
  let jobsSkipped = 0;
  let jobsCancelled = 0;
  const touchedCampaignIds = new Set<string>();

  for (const job of jobs) {
    const clinicId = job.clinic_id as string;
    const campaignId = job.campaign_id as string;
    const stats = getOrCreateClinicStats(clinicStats, clinicId);
    stats.jobs_scanned += 1;
    touchedCampaignIds.add(campaignId);

    const claimResult = await input.client
      .from("broadcast_campaign_jobs")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id as string)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimResult.error) {
      throw claimResult.error;
    }

    if (!claimResult.data) {
      continue;
    }

    const campaign = campaignMap.get(campaignId);
    const clinic = clinicMap.get(clinicId);
    const contact = contactMap.get(job.contact_id as string);

    if (!campaign || !clinic || !contact) {
      stats.jobs_failed += 1;
      jobsFailed += 1;
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "failed",
          last_error: "Missing campaign, clinic, or contact context.",
          failure_code: "missing_context",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    if (
      campaign.status === "cancelled" ||
      campaign.status === "completed" ||
      campaign.status === "completed_with_errors"
    ) {
      stats.jobs_cancelled += 1;
      jobsCancelled += 1;
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "cancelled",
          cancel_reason: "campaign_closed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    if (campaign.status === "halted") {
      stats.jobs_cancelled += 1;
      jobsCancelled += 1;
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "cancelled",
          cancel_reason: "campaign_halted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    if (hasMarketingOptedOut(contact) || contact.current_status === "trash") {
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "skipped",
          cancel_reason: hasMarketingOptedOut(contact)
            ? "marketing_opted_out"
            : "contact_in_trash",
          failure_code: hasMarketingOptedOut(contact)
            ? "marketing_opted_out"
            : "contact_in_trash",
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
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "skipped",
          cancel_reason: "clinic_unavailable",
          failure_code: "clinic_unavailable",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    let usage = usageMap.get(clinic.id);
    if (!usage) {
      usage = await getClinicUsageSummary(input.client, {
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
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "skipped",
          cancel_reason: "message_limit_reached",
          failure_code: "message_limit_reached",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);
      continue;
    }

    const conversationId = await ensureConversationForContact(
      input.client,
      clinic.id,
      contact.id
    );

    // Build the message text with contact-specific substitutions
    let baseMessage = buildBroadcastTemplateMessage({
      template: campaign.message_template,
      contactName: contact.full_name,
      treatmentInterest: contact.treatment_interest,
    });

    // Rewrite external URLs to tracked short links (lazy, once per campaign)
    if (!campaignLinkMapCache.has(campaignId)) {
      const { linkMap } = await rewriteCampaignLinks(input.client, {
        message: baseMessage,
        campaignId,
        clinicId,
        appBaseUrl,
      }).catch(() => ({ linkMap: new Map<string, string>() }));
      campaignLinkMapCache.set(campaignId, linkMap);
    }

    const linkMap = campaignLinkMapCache.get(campaignId)!;
    if (linkMap.size > 0) {
      // Apply the short URL substitutions
      for (const [originalUrl, shortUrlBase] of linkMap) {
        const personalizedUrl = appendCampaignLinkParams(shortUrlBase, {
          contactId: contact.id,
          jobId: job.id as string,
        });
        baseMessage = baseMessage.split(originalUrl).join(personalizedUrl);
      }
    }

    const message = baseMessage;

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
      contactId: contact.id,
      phone: contact.phone_e164 ?? "",
      message,
      senderType: "human",
    });

    if (!sendResult.success) {
      const failureCode = isInvalidWhatsappRecipientError(sendResult.error)
        ? "invalid_number"
        : "send_failed";
      stats.jobs_failed += 1;
      jobsFailed += 1;
      await input.client
        .from("broadcast_campaign_jobs")
        .update({
          status: "failed",
          last_error: sendResult.error,
          failure_code: failureCode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id as string);

      if (failureCode === "invalid_number" && campaign.stop_on_invalid_number) {
        const cancelledJobs = await haltBroadcastCampaign(input.client, {
          campaignId,
          clinicId,
          errorMessage: sendResult.error ?? "Campaign halted because of an invalid number.",
        });
        stats.jobs_cancelled += cancelledJobs;
        jobsCancelled += cancelledJobs;
      }
      continue;
    }

    await insertMessageRecord(input.client, {
      clinic_id: clinic.id,
      contact_id: contact.id,
      conversation_id: conversationId,
      provider_message_id:
        "providerMessageId" in sendResult ? sendResult.providerMessageId : null,
      direction: "outbound",
      sender_type: "human",
      content: message,
    });

    await input.client
      .from("contacts")
      .update({
        last_outbound_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id)
      .eq("clinic_id", clinic.id);

    try {
      await enqueueContactMemoryJob(input.client, {
        clinicId: clinic.id,
        contactId: contact.id,
        triggerSource: "message_outbound_human",
      });
    } catch (contactMemoryError) {
      if (!isContactMemorySchemaMismatchError(contactMemoryError)) {
        throw contactMemoryError;
      }
    }

    try {
      await scheduleFollowUpJobs(input.client, clinic.id, contact.id, new Date());
    } catch (automationError) {
      if (!isAutomationSchemaMismatchError(automationError)) {
        throw automationError;
      }
    }

    const providerMessageId =
      "providerMessageId" in sendResult ? sendResult.providerMessageId : null;
    const sentAtIso = new Date().toISOString();
    const sentJobUpdates: Record<string, unknown> = {
      status: "sent",
      sent_at: sentAtIso,
      updated_at: sentAtIso,
    };
    if (providerMessageId) {
      sentJobUpdates.provider_message_id = providerMessageId;
    }

    let sentJobError = (
      await input.client
        .from("broadcast_campaign_jobs")
        .update(sentJobUpdates)
        .eq("id", job.id as string)
    ).error;

    if (
      sentJobError &&
      isBroadcastSchemaMismatchError(sentJobError) &&
      "provider_message_id" in sentJobUpdates
    ) {
      // Schema not yet migrated for provider_message_id — retry without it
      const { provider_message_id: omittedProviderId, ...fallbackUpdates } = sentJobUpdates;
      void omittedProviderId;
      sentJobError = (
        await input.client
          .from("broadcast_campaign_jobs")
          .update(fallbackUpdates)
          .eq("id", job.id as string)
      ).error;
    }

    if (sentJobError) {
      throw sentJobError;
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

  await syncBroadcastCampaignStats(input.client, [...touchedCampaignIds]);

  const completedAt = new Date().toISOString();
  for (const [clinicId, stats] of clinicStats.entries()) {
    await recordBroadcastCampaignRunnerRun(input.client, {
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
    jobs_cancelled: jobsCancelled,
  };
}

export async function getBroadcastCampaignHealthSummary(
  client: CampaignClient,
  clinicId: string,
  input: {
    serviceRoleConfigured: boolean;
    runnerSecretConfigured: boolean;
    canManageCampaigns: boolean;
  }
): Promise<BroadcastCampaignHealthSummary> {
  const nowIso = new Date().toISOString();

  const [pendingResult, overdueResult, failedResult, lastRunResult] =
    await Promise.all([
      client
        .from("broadcast_campaign_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "pending"),
      client
        .from("broadcast_campaign_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "pending")
        .lte("scheduled_for", nowIso),
      client
        .from("broadcast_campaign_jobs")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "failed"),
      client
        .from("broadcast_campaign_runner_runs")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  let schemaWarning: string | null = null;
  let lastRun: BroadcastCampaignRunnerRunSummary | null = null;

  if (lastRunResult.error) {
    if (isBroadcastSchemaMismatchError(lastRunResult.error)) {
      schemaWarning =
        "Apply the latest supabase schema to enable broadcast campaign runner history.";
    } else {
      throw lastRunResult.error;
    }
  } else if (lastRunResult.data) {
    const row = lastRunResult.data as Record<string, unknown>;
    lastRun = {
      id: row.id as string | undefined,
      clinic_id: row.clinic_id as string | undefined,
      trigger_source: row.trigger_source as BroadcastCampaignTriggerSource,
      status: row.status as "completed" | "failed",
      jobs_scanned: Number(row.jobs_scanned ?? 0) || 0,
      jobs_sent: Number(row.jobs_sent ?? 0) || 0,
      jobs_failed: Number(row.jobs_failed ?? 0) || 0,
      jobs_skipped: Number(row.jobs_skipped ?? 0) || 0,
      jobs_cancelled: Number(row.jobs_cancelled ?? 0) || 0,
      started_at: (row.started_at as string) ?? new Date().toISOString(),
      completed_at: (row.completed_at as string | null) ?? null,
      error: (row.error as string | null) ?? null,
    };
  }

  return {
    service_role_configured: input.serviceRoleConfigured,
    runner_secret_configured: input.runnerSecretConfigured,
    can_manage_campaigns: input.canManageCampaigns,
    pending_jobs: pendingResult.count ?? 0,
    overdue_jobs: overdueResult.count ?? 0,
    failed_jobs: failedResult.count ?? 0,
    last_run: lastRun,
    schema_warning: schemaWarning,
  };
}

export async function getBroadcastCampaignListPayload(
  client: CampaignClient,
  clinicId: string,
  input: {
    serviceRoleConfigured: boolean;
    runnerSecretConfigured: boolean;
    canManageCampaigns: boolean;
  }
): Promise<BroadcastCampaignListPayload> {
  const [{ campaigns, analytics }, health] = await Promise.all([
    listBroadcastCampaigns(client, clinicId),
    getBroadcastCampaignHealthSummary(client, clinicId, input),
  ]);

  return {
    campaigns,
    analytics,
    health,
  };
}

// -- Campaign analytics helpers --------------------------------------------

/**
 * Mark a campaign job as delivered. Called when a status webhook reports the
 * outbound message as delivered to the recipient's device.
 *
 * Lookup is by provider_message_id which is recorded when the campaign send
 * happens. Silently no-ops if the message is not from a campaign.
 */
export async function markCampaignJobDelivered(
  client: CampaignClient,
  input: { clinicId: string; providerMessageId: string; deliveredAt?: string }
) {
  const deliveredAt = input.deliveredAt ?? new Date().toISOString();
  const { data, error } = await client
    .from("broadcast_campaign_jobs")
    .select("id, campaign_id, delivered_at")
    .eq("clinic_id", input.clinicId)
    .eq("provider_message_id", input.providerMessageId)
    .maybeSingle();

  if (error) {
    if (isBroadcastSchemaMismatchError(error)) {
      return;
    }
    throw error;
  }

  if (!data) {
    return;
  }

  const row = data as Record<string, unknown>;
  // Idempotency: only update if not already marked delivered
  if (row.delivered_at) {
    return;
  }

  const { error: updateError } = await client
    .from("broadcast_campaign_jobs")
    .update({ delivered_at: deliveredAt, updated_at: deliveredAt })
    .eq("id", row.id as string);

  if (updateError) {
    if (isBroadcastSchemaMismatchError(updateError)) {
      return;
    }
    throw updateError;
  }

  await syncBroadcastCampaignStats(client, [row.campaign_id as string]);
}

/**
 * Mark a campaign job as read. Called when a status webhook reports the
 * outbound message has been read by the recipient.
 */
export async function markCampaignJobRead(
  client: CampaignClient,
  input: { clinicId: string; providerMessageId: string; readAt?: string }
) {
  const readAt = input.readAt ?? new Date().toISOString();
  const { data, error } = await client
    .from("broadcast_campaign_jobs")
    .select("id, campaign_id, read_at, delivered_at")
    .eq("clinic_id", input.clinicId)
    .eq("provider_message_id", input.providerMessageId)
    .maybeSingle();

  if (error) {
    if (isBroadcastSchemaMismatchError(error)) {
      return;
    }
    throw error;
  }

  if (!data) {
    return;
  }

  const row = data as Record<string, unknown>;
  if (row.read_at) {
    return;
  }

  // Backfill delivered_at if read arrives before delivered (some providers
  // skip the delivered ack when the recipient is online).
  const updates: Record<string, unknown> = {
    read_at: readAt,
    updated_at: readAt,
  };
  if (!row.delivered_at) {
    updates.delivered_at = readAt;
  }

  const { error: updateError } = await client
    .from("broadcast_campaign_jobs")
    .update(updates)
    .eq("id", row.id as string);

  if (updateError) {
    if (isBroadcastSchemaMismatchError(updateError)) {
      return;
    }
    throw updateError;
  }

  await syncBroadcastCampaignStats(client, [row.campaign_id as string]);
}

/**
 * When a contact opts out of marketing (e.g. replies STOP), attribute the
 * opt-out to the most recent campaign that messaged them. This lets clinics
 * see which campaigns are causing complaints.
 *
 * Looks up the most recent sent campaign job for this contact within the last
 * 30 days. No-ops if no recent campaign found.
 */
export async function markCampaignJobOptedOut(
  client: CampaignClient,
  input: { clinicId: string; contactId: string; optedOutAt?: string }
) {
  const optedOutAt = input.optedOutAt ?? new Date().toISOString();
  const lookbackIso = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await client
    .from("broadcast_campaign_jobs")
    .select("id, campaign_id, opted_out_at, sent_at")
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .gte("sent_at", lookbackIso)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isBroadcastSchemaMismatchError(error)) {
      return;
    }
    throw error;
  }

  if (!data) {
    return;
  }

  const row = data as Record<string, unknown>;
  if (row.opted_out_at) {
    return;
  }

  const { error: updateError } = await client
    .from("broadcast_campaign_jobs")
    .update({ opted_out_at: optedOutAt, updated_at: optedOutAt })
    .eq("id", row.id as string);

  if (updateError) {
    if (isBroadcastSchemaMismatchError(updateError)) {
      return;
    }
    throw updateError;
  }

  await syncBroadcastCampaignStats(client, [row.campaign_id as string]);
}

/**
 * Record a campaign link click and update the campaign job's click counters.
 * Called from the /c/[code] redirect handler.
 */
export async function recordCampaignLinkClick(
  client: CampaignClient,
  input: {
    linkId: string;
    campaignId: string;
    clinicId: string;
    contactId: string | null;
    jobId: string | null;
    userAgent: string | null;
    referrer: string | null;
  }
) {
  const clickedAt = new Date().toISOString();

  const insertResult = await client.from("campaign_link_clicks").insert({
    link_id: input.linkId,
    campaign_id: input.campaignId,
    clinic_id: input.clinicId,
    contact_id: input.contactId,
    job_id: input.jobId,
    user_agent: input.userAgent,
    referrer: input.referrer,
    clicked_at: clickedAt,
  });

  if (insertResult.error && !isBroadcastSchemaMismatchError(insertResult.error)) {
    throw insertResult.error;
  }

  // Increment link total_clicks
  const { data: linkRow } = await client
    .from("campaign_links")
    .select("total_clicks, unique_clicks")
    .eq("id", input.linkId)
    .maybeSingle();

  if (linkRow) {
    const updates: Record<string, unknown> = {
      total_clicks: Number((linkRow as Record<string, unknown>).total_clicks ?? 0) + 1,
    };

    // Increment unique_clicks only if this is the contact's first click on this link
    if (input.contactId) {
      const { count } = await client
        .from("campaign_link_clicks")
        .select("id", { count: "exact", head: true })
        .eq("link_id", input.linkId)
        .eq("contact_id", input.contactId);

      if ((count ?? 0) <= 1) {
        updates.unique_clicks =
          Number((linkRow as Record<string, unknown>).unique_clicks ?? 0) + 1;
      }
    }

    await client.from("campaign_links").update(updates).eq("id", input.linkId);
  }

  // Update the campaign job's click_count + last_clicked_at + clicked_at (first click)
  if (input.jobId) {
    const { data: jobRow } = await client
      .from("broadcast_campaign_jobs")
      .select("click_count, clicked_at")
      .eq("id", input.jobId)
      .maybeSingle();

    if (jobRow) {
      const job = jobRow as Record<string, unknown>;
      const updates: Record<string, unknown> = {
        click_count: Number(job.click_count ?? 0) + 1,
        last_clicked_at: clickedAt,
        updated_at: clickedAt,
      };
      if (!job.clicked_at) {
        updates.clicked_at = clickedAt;
      }

      const { error } = await client
        .from("broadcast_campaign_jobs")
        .update(updates)
        .eq("id", input.jobId);

      if (error && !isBroadcastSchemaMismatchError(error)) {
        throw error;
      }
    }

    await syncBroadcastCampaignStats(client, [input.campaignId]);
  }
}

function buildCampaignFunnel(
  campaign: BroadcastCampaign,
  jobs: Array<Record<string, unknown>>
) {
  const sent = jobs.filter(
    (job) => normalizeBroadcastJobStatus(job.status) === "sent"
  ).length;
  const delivered = jobs.filter((job) => Boolean(job.delivered_at)).length;
  const read = jobs.filter((job) => Boolean(job.read_at)).length;
  const replied = jobs.filter((job) => Number(job.reply_count ?? 0) > 0).length;
  const clicked = jobs.filter((job) => Number(job.click_count ?? 0) > 0).length;
  const optedOut = jobs.filter((job) => Boolean(job.opted_out_at)).length;
  const failed = jobs.filter(
    (job) => normalizeBroadcastJobStatus(job.status) === "failed"
  ).length;
  const skipped = jobs.filter(
    (job) => normalizeBroadcastJobStatus(job.status) === "skipped"
  ).length;
  const cancelled = jobs.filter(
    (job) => normalizeBroadcastJobStatus(job.status) === "cancelled"
  ).length;
  const invalid = jobs.filter(
    (job) => (job.failure_code as string | null) === "invalid_number"
  ).length;

  const safePercent = (numerator: number, denominator: number) => {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
  };

  return {
    total_recipients: campaign.total_recipients,
    sent,
    delivered,
    read,
    replied,
    clicked,
    opted_out: optedOut,
    failed,
    skipped,
    cancelled,
    invalid,
    delivery_rate: safePercent(delivered, sent),
    read_rate: safePercent(read, sent),
    reply_rate: safePercent(replied, sent),
    click_through_rate: safePercent(clicked, sent),
    opt_out_rate: safePercent(optedOut, sent),
  };
}

/**
 * Get full per-campaign analytics including funnel data and per-recipient
 * status breakdown. Used by the campaign detail page.
 */
export async function getBroadcastCampaignDetail(
  client: CampaignClient,
  input: { clinicId: string; campaignId: string }
) {
  const { data: campaignRow, error: campaignError } = await client
    .from("broadcast_campaigns")
    .select("*")
    .eq("id", input.campaignId)
    .eq("clinic_id", input.clinicId)
    .maybeSingle();

  if (campaignError) {
    throw campaignError;
  }

  if (!campaignRow) {
    return null;
  }

  const campaign = mapCampaignRow(campaignRow as Record<string, unknown>);

  // Try to load jobs with full analytics columns; fall back if migration not applied
  let jobs: Array<Record<string, unknown>> = [];
  const fullSelect = await client
    .from("broadcast_campaign_jobs")
    .select(
      "id, contact_id, status, scheduled_for, sent_at, delivered_at, read_at, first_reply_at, reply_count, click_count, last_clicked_at, opted_out_at, failure_code, last_error"
    )
    .eq("clinic_id", input.clinicId)
    .eq("campaign_id", input.campaignId)
    .order("scheduled_for", { ascending: true });

  if (fullSelect.error) {
    if (isBroadcastSchemaMismatchError(fullSelect.error)) {
      const fallback = await client
        .from("broadcast_campaign_jobs")
        .select(
          "id, contact_id, status, scheduled_for, sent_at, first_reply_at, reply_count, failure_code, last_error"
        )
        .eq("clinic_id", input.clinicId)
        .eq("campaign_id", input.campaignId)
        .order("scheduled_for", { ascending: true });

      if (fallback.error) {
        throw fallback.error;
      }
      jobs = (fallback.data ?? []) as Array<Record<string, unknown>>;
    } else {
      throw fullSelect.error;
    }
  } else {
    jobs = (fullSelect.data ?? []) as Array<Record<string, unknown>>;
  }

  const contactIds = [...new Set(jobs.map((job) => job.contact_id as string))];
  const contactMap = new Map<string, Record<string, unknown>>();

  if (contactIds.length > 0) {
    const { data: contactRows, error: contactsError } = await client
      .from("contacts")
      .select("id, full_name, phone_e164")
      .in("id", contactIds);

    if (contactsError) {
      throw contactsError;
    }

    for (const contact of (contactRows ?? []) as Array<Record<string, unknown>>) {
      contactMap.set(contact.id as string, contact);
    }
  }

  const recipients = jobs.map((job) => {
    const contact = contactMap.get(job.contact_id as string);
    return {
      job_id: job.id as string,
      contact_id: job.contact_id as string,
      contact_name: (contact?.full_name as string | null) ?? null,
      contact_phone: (contact?.phone_e164 as string | null) ?? null,
      status: normalizeBroadcastJobStatus(job.status),
      scheduled_for: toIsoString(job.scheduled_for as string | null),
      sent_at: toIsoString(job.sent_at as string | null),
      delivered_at: toIsoString(job.delivered_at as string | null),
      read_at: toIsoString(job.read_at as string | null),
      first_reply_at: toIsoString(job.first_reply_at as string | null),
      reply_count: Number(job.reply_count ?? 0) || 0,
      click_count: Number(job.click_count ?? 0) || 0,
      last_clicked_at: toIsoString(job.last_clicked_at as string | null),
      opted_out_at: toIsoString(job.opted_out_at as string | null),
      failure_code: (job.failure_code as string | null) ?? null,
      last_error: (job.last_error as string | null) ?? null,
    };
  });

  // Load campaign links
  let links: Array<{
    id: string;
    short_code: string;
    target_url: string;
    total_clicks: number;
    unique_clicks: number;
  }> = [];

  const linksResult = await client
    .from("campaign_links")
    .select("id, short_code, target_url, total_clicks, unique_clicks")
    .eq("campaign_id", input.campaignId)
    .eq("clinic_id", input.clinicId)
    .order("created_at", { ascending: true });

  if (linksResult.error) {
    if (!isBroadcastSchemaMismatchError(linksResult.error)) {
      throw linksResult.error;
    }
  } else {
    links = (linksResult.data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        short_code: r.short_code as string,
        target_url: r.target_url as string,
        total_clicks: Number(r.total_clicks ?? 0) || 0,
        unique_clicks: Number(r.unique_clicks ?? 0) || 0,
      };
    });
  }

  return {
    campaign,
    funnel: buildCampaignFunnel(campaign, jobs),
    recipients,
    links,
  };
}
