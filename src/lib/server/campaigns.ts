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
import { sendWhatsappMessage } from "@/lib/server/whatsapp";
import type {
  BroadcastCampaign,
  BroadcastCampaignAnalytics,
  BroadcastCampaignCreatePayload,
  BroadcastCampaignHealthSummary,
  BroadcastCampaignJobStatus,
  BroadcastCampaignListPayload,
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
  payment_received_at?: string | null;
  billing_cycle_anchor?: string | null;
  created_at?: string | null;
  contact_limit_override?: number | null;
  monthly_message_limit_override?: number | null;
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
    .select(
      "id, clinic_id, full_name, phone_e164, treatment_interest, current_status, source, campaign_name, assigned_user_id, bot_mode, automation_enabled, unread_count, appointment_date, created_at"
    )
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as CampaignContactContext[];
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

  const [campaignRowsResult, jobsResult] = await Promise.all([
    client
      .from("broadcast_campaigns")
      .select("id, status, started_at, completed_at")
      .in("id", campaignIds),
    client
      .from("broadcast_campaign_jobs")
      .select("campaign_id, status, scheduled_for, failure_code")
      .in("campaign_id", campaignIds),
  ]);

  if (campaignRowsResult.error) {
    throw campaignRowsResult.error;
  }

  if (jobsResult.error) {
    throw jobsResult.error;
  }

  const jobRows = (jobsResult.data ?? []) as Array<Record<string, unknown>>;
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

    const { error } = await client
      .from("broadcast_campaigns")
      .update(updates)
      .eq("id", campaignId);

    if (error) {
      throw error;
    }
  }
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
  const dailySendCap = Math.max(1, Math.round(input.daily_send_cap || 1));

  if (!name) {
    throw new Error("Campaign name is required.");
  }

  if (!messageTemplate) {
    throw new Error("Broadcast message is required.");
  }

  if (segmentFilters.length === 0) {
    throw new Error("Select at least one CRM segment before creating a broadcast.");
  }

  const baseScheduledAt =
    input.delivery_type === "scheduled"
      ? toIsoString(input.scheduled_for ?? null)
      : new Date().toISOString();

  if (!baseScheduledAt) {
    throw new Error("A valid scheduled date and time is required.");
  }

  const contacts = await fetchCampaignContacts(client, input.clinicId);
  const recipients = contacts
    .filter((contact) => doesRecordMatchBroadcastFilters(contact, segmentFilters))
    .sort((left, right) => {
      const leftDate = toIsoString(left.created_at ?? null) ?? "";
      const rightDate = toIsoString(right.created_at ?? null) ?? "";
      return leftDate.localeCompare(rightDate);
    });

  if (recipients.length === 0) {
    throw new Error("No contacts matched the selected CRM segments.");
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
          "id, name, plan_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, billing_cycle_anchor, payment_received_at, created_at, contact_limit_override, monthly_message_limit_override"
        )
        .in("id", clinicIds),
      input.client
        .from("contacts")
        .select("id, clinic_id, full_name, phone_e164, treatment_interest")
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

    const message = buildBroadcastTemplateMessage({
      template: campaign.message_template,
      contactName: contact.full_name,
      treatmentInterest: contact.treatment_interest,
    });

    const sendResult = await sendWhatsappMessage({
      clinic: {
        id: clinic.id,
        name: clinic.name ?? "Clinic",
        evolution_instance_name: clinic.evolution_instance_name ?? null,
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

    await input.client
      .from("broadcast_campaign_jobs")
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
