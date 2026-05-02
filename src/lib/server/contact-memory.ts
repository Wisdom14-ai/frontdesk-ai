import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mergeContactLeadMemory } from "@/lib/contact-memory";
import {
  CONTACT_MEMORY_MAX_ATTEMPTS,
  CONTACT_MEMORY_RETRY_DELAY_MS,
  generateContactLeadMemory,
  getContactMemoryAiConfigError,
  hasContactMemoryAiConfig,
  isContactMemoryCapReachedError,
  isContactMemoryTransientError,
} from "@/lib/server/contact-memory-ai";
import { listMessagesForContact } from "@/lib/server/messages";
import type {
  AutomationTriggerSource,
  ContactMemoryBackfillSummary,
  ContactMemoryHealthSummary,
  ContactMemoryRunnerRunSummary,
  ContactMemoryRunSummary,
  ContactMemoryTriggerSource,
  Message,
} from "@/types";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";

type ContactMemoryClient = SupabaseClient;

interface ContactMemoryJobRow {
  id: string;
  clinic_id: string;
  contact_id: string;
  trigger_source: ContactMemoryTriggerSource;
  attempt_count: number | null;
}

interface PendingContactMemoryJobRow {
  id: string;
  scheduled_for: string | null;
}

interface ContactMemoryRunClinicStats {
  jobs_scanned: number;
  jobs_completed: number;
  jobs_failed: number;
  jobs_skipped: number;
}

function isPostgrestLikeError(error: unknown): error is { code?: string; message?: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("code" in error || "message" in error)
  );
}

export function isContactMemorySchemaMismatchError(error: unknown) {
  return (
    isPostgrestLikeError(error) &&
    (error.code === "42703" ||
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205")
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "Unknown contact memory error.";
}

function buildContactMemoryRetryTime() {
  return new Date(Date.now() + CONTACT_MEMORY_RETRY_DELAY_MS).toISOString();
}

function isDuplicateContactMemoryJobError(error: unknown) {
  return isPostgrestLikeError(error) && error.code === "23505";
}

async function refreshPendingContactMemoryJob(
  client: ContactMemoryClient,
  input: {
    clinicId: string;
    contactId: string;
    triggerSource: ContactMemoryTriggerSource;
    scheduledForIso: string;
    nowIso: string;
  }
) {
  const { data: existingPending, error: existingPendingError } = await client
    .from("contact_memory_jobs")
    .select("id, scheduled_for")
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingPendingError) {
    throw existingPendingError;
  }

  if (!existingPending) {
    return false;
  }

  const currentPending = existingPending as PendingContactMemoryJobRow;
  const shouldPullForward =
    !currentPending.scheduled_for ||
    currentPending.scheduled_for > input.scheduledForIso;

  const update = {
    trigger_source: input.triggerSource,
    updated_at: input.nowIso,
    last_error: null,
    completed_at: null,
    attempt_count: 0,
    ...(shouldPullForward ? { scheduled_for: input.scheduledForIso } : {}),
  };

  const { data: updatedPending, error: updateError } = await client
    .from("contact_memory_jobs")
    .update(update)
    .eq("id", currentPending.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  return Boolean(updatedPending);
}

export async function enqueueContactMemoryJob(
  client: ContactMemoryClient,
  input: {
    clinicId: string;
    contactId: string;
    triggerSource: ContactMemoryTriggerSource;
    scheduledFor?: Date;
  }
) {
  const nowIso = new Date().toISOString();
  const scheduledForIso = (input.scheduledFor ?? new Date()).toISOString();

  if (
    await refreshPendingContactMemoryJob(client, {
      clinicId: input.clinicId,
      contactId: input.contactId,
      triggerSource: input.triggerSource,
      scheduledForIso,
      nowIso,
    })
  ) {
    return;
  }

  const { error } = await client.from("contact_memory_jobs").insert({
    clinic_id: input.clinicId,
    contact_id: input.contactId,
    trigger_source: input.triggerSource,
    status: "pending",
    scheduled_for: scheduledForIso,
    attempt_count: 0,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (error) {
    if (
      isDuplicateContactMemoryJobError(error) &&
      await refreshPendingContactMemoryJob(client, {
        clinicId: input.clinicId,
        contactId: input.contactId,
        triggerSource: input.triggerSource,
        scheduledForIso,
        nowIso,
      })
    ) {
      return;
    }

    throw error;
  }
}

export async function enqueueContactMemoryBackfillJobs(
  client: ContactMemoryClient,
  clinicId: string
): Promise<ContactMemoryBackfillSummary> {
  const { data: messageRows, error: messageError } = await client
    .from("messages")
    .select("contact_id")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (messageError) {
    throw messageError;
  }

  const messageContactIds = [...new Set(
    (messageRows ?? [])
      .map((row) => row.contact_id as string | null)
      .filter((contactId): contactId is string => Boolean(contactId))
  )];

  if (messageContactIds.length === 0) {
    return { queued: 0, skipped: 0 };
  }

  const { data: contacts, error: contactError } = await client
    .from("contacts")
    .select("id, lead_memory_last_generated_at")
    .eq("clinic_id", clinicId)
    .in("id", messageContactIds);

  if (contactError) {
    throw contactError;
  }

  const eligibleContacts = (contacts ?? []).filter(
    (contact) => !contact.lead_memory_last_generated_at
  );

  for (const contact of eligibleContacts) {
    await enqueueContactMemoryJob(client, {
      clinicId,
      contactId: contact.id as string,
      triggerSource: "backfill",
    });
  }

  return {
    queued: eligibleContacts.length,
    skipped: messageContactIds.length - eligibleContacts.length,
  };
}

async function fetchContactMessages(
  admin: SupabaseAdminClient,
  clinicId: string,
  contactId: string
) {
  return listMessagesForContact(admin, {
    clinicId,
    contactId,
    order: "desc",
    limit: 50,
  }).then((messages) => [...messages].reverse() as Message[]);
}

async function markContactMemoryJobStatus(
  admin: SupabaseAdminClient,
  jobId: string,
  input: {
    status: "completed" | "failed" | "skipped";
    lastError?: string | null;
  }
) {
  const nowIso = new Date().toISOString();

  await admin
    .from("contact_memory_jobs")
    .update({
      status: input.status,
      last_error: input.lastError ?? null,
      updated_at: nowIso,
      completed_at: nowIso,
    })
    .eq("id", jobId);
}

async function setContactMemoryError(
  admin: SupabaseAdminClient,
  contactId: string,
  lastError: string | null
) {
  await admin
    .from("contacts")
    .update({
      lead_memory_last_error: lastError,
      lead_memory_last_generated_at: lastError ? undefined : new Date().toISOString(),
    })
    .eq("id", contactId);
}

async function rescheduleContactMemoryJob(
  admin: SupabaseAdminClient,
  jobId: string,
  lastError: string,
  input?: {
    attemptCount?: number;
  }
) {
  await admin
    .from("contact_memory_jobs")
    .update({
      status: "pending",
      last_error: lastError,
      scheduled_for: buildContactMemoryRetryTime(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      ...(typeof input?.attemptCount === "number"
        ? { attempt_count: input.attemptCount }
        : {}),
    })
    .eq("id", jobId);
}

function getOrCreateContactMemoryStats(
  statsMap: Map<string, ContactMemoryRunClinicStats>,
  clinicId: string
) {
  const stats = statsMap.get(clinicId) ?? {
    jobs_scanned: 0,
    jobs_completed: 0,
    jobs_failed: 0,
    jobs_skipped: 0,
  };

  statsMap.set(clinicId, stats);
  return stats;
}

async function recordContactMemoryRunnerRun(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    triggerSource: AutomationTriggerSource;
    requestedByUserId?: string | null;
    startedAt: string;
    completedAt: string;
    status: "completed" | "failed";
    error?: string | null;
    stats: ContactMemoryRunClinicStats;
  }
) {
  const { error } = await admin.from("contact_memory_runner_runs").insert({
    clinic_id: input.clinicId,
    trigger_source: input.triggerSource,
    requested_by_user_id: input.requestedByUserId ?? null,
    status: input.status,
    jobs_scanned: input.stats.jobs_scanned,
    jobs_completed: input.stats.jobs_completed,
    jobs_failed: input.stats.jobs_failed,
    jobs_skipped: input.stats.jobs_skipped,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    error: input.error ?? null,
  });

  if (error && !isContactMemorySchemaMismatchError(error)) {
    console.warn("[contact-memory] Failed to record runner activity", {
      clinicId: input.clinicId,
      message: error.message,
      code: error.code,
    });
  }
}

export async function runDueContactMemoryJobs(input: {
  admin: SupabaseAdminClient;
  clinicId?: string;
  limit?: number;
  triggerSource?: AutomationTriggerSource;
  requestedByUserId?: string | null;
}): Promise<ContactMemoryRunSummary> {
  const nowIso = new Date().toISOString();
  const startedAt = nowIso;
  const triggerSource = input.triggerSource ?? "scheduler";
  let jobsQuery = input.admin
    .from("contact_memory_jobs")
    .select("id, clinic_id, contact_id, trigger_source, attempt_count")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(input.limit ?? 25);

  if (input.clinicId) {
    jobsQuery = jobsQuery.eq("clinic_id", input.clinicId);
  }

  const { data: jobs, error } = await jobsQuery;
  if (error) {
    throw error;
  }

  const clinicStats = new Map<string, ContactMemoryRunClinicStats>();

  if (!jobs || jobs.length === 0) {
    if (input.clinicId) {
      await recordContactMemoryRunnerRun(input.admin, {
        clinicId: input.clinicId,
        triggerSource,
        requestedByUserId: input.requestedByUserId ?? null,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        stats: getOrCreateContactMemoryStats(clinicStats, input.clinicId),
      });
    }

    return {
      processed: 0,
      jobs_scanned: 0,
      jobs_completed: 0,
      jobs_failed: 0,
      jobs_skipped: 0,
    };
  }

  const clinicIds = [...new Set(jobs.map((job) => job.clinic_id as string))];
  const contactIds = [...new Set(jobs.map((job) => job.contact_id as string))];

  const [{ data: clinics }, { data: contacts }] = await Promise.all([
    input.admin
      .from("clinics")
      .select("id, name, clinic_prompt")
      .in("id", clinicIds),
    input.admin
      .from("contacts")
      .select(
        "id, clinic_id, full_name, phone_e164, treatment_interest, current_status, source, campaign_name, bot_mode, automation_enabled, next_follow_up_at, last_inbound_at, last_outbound_at, appointment_date, appointment_time, attendance_status, lead_memory_auto, lead_memory_override, staff_note"
      )
      .in("id", contactIds),
  ]);

  const clinicMap = new Map(
    (clinics ?? []).map((clinic) => [clinic.id as string, clinic as Record<string, unknown>])
  );
  const contactMap = new Map(
    (contacts ?? []).map((contact) => [contact.id as string, contact as Record<string, unknown>])
  );

  let jobsCompleted = 0;
  let jobsFailed = 0;
  let jobsSkipped = 0;
  const aiConfigurationError = getContactMemoryAiConfigError();

  for (const rawJob of jobs as ContactMemoryJobRow[]) {
    const stats = getOrCreateContactMemoryStats(clinicStats, rawJob.clinic_id);
    stats.jobs_scanned += 1;
    const currentAttempt = (rawJob.attempt_count ?? 0) + 1;
    const processing = await input.admin
      .from("contact_memory_jobs")
      .update({
        status: "processing",
        attempt_count: currentAttempt,
        updated_at: new Date().toISOString(),
        last_error: null,
        completed_at: null,
      })
      .eq("id", rawJob.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (processing.error) {
      throw processing.error;
    }

    if (!processing.data) {
      continue;
    }

    const clinic = clinicMap.get(rawJob.clinic_id);
    const contact = contactMap.get(rawJob.contact_id);

    if (!clinic || !contact) {
      const lastError = "Missing clinic or contact context for memory generation.";
      await markContactMemoryJobStatus(input.admin, rawJob.id, {
        status: "failed",
        lastError,
      });
      await setContactMemoryError(input.admin, rawJob.contact_id, lastError);
      stats.jobs_failed += 1;
      jobsFailed += 1;
      continue;
    }

    if (aiConfigurationError) {
      const lastError = aiConfigurationError;
      await rescheduleContactMemoryJob(input.admin, rawJob.id, lastError, {
        attemptCount: rawJob.attempt_count ?? 0,
      });
      await setContactMemoryError(input.admin, rawJob.contact_id, lastError);
      stats.jobs_skipped += 1;
      jobsSkipped += 1;
      continue;
    }

    try {
      const effectiveMemory = mergeContactLeadMemory(
        contact.lead_memory_auto,
        contact.lead_memory_override
      );
      const messages = await fetchContactMessages(
        input.admin,
        rawJob.clinic_id,
        rawJob.contact_id
      );
      const normalizedMemory = await generateContactLeadMemory({
        clinic: {
          id: clinic.id as string,
          name: (clinic.name as string) ?? "",
          clinic_prompt: (clinic.clinic_prompt as string | null) ?? null,
        },
        contact: {
          id: contact.id as string,
          full_name: (contact.full_name as string) ?? "",
          phone_e164: (contact.phone_e164 as string) ?? "",
          treatment_interest: (contact.treatment_interest as string | null) ?? null,
          current_status: (contact.current_status as string) ?? "",
          source: (contact.source as string | null) ?? null,
          campaign_name: (contact.campaign_name as string | null) ?? null,
          bot_mode: (contact.bot_mode as string | null) ?? null,
          automation_enabled:
            (contact.automation_enabled as boolean | null) ?? true,
          next_follow_up_at:
            (contact.next_follow_up_at as string | null) ?? null,
          last_inbound_at: (contact.last_inbound_at as string | null) ?? null,
          last_outbound_at: (contact.last_outbound_at as string | null) ?? null,
          appointment_date:
            (contact.appointment_date as string | null) ?? null,
          appointment_time:
            (contact.appointment_time as string | null) ?? null,
          attendance_status:
            (contact.attendance_status as string | null) ?? null,
          lead_memory: effectiveMemory,
          staff_note: (contact.staff_note as string | null) ?? null,
        },
        messages: messages.map((message) => ({
          direction: message.direction,
          sender_type: message.sender_type,
          content: message.content,
          created_at: message.created_at,
        })),
        triggerSource: rawJob.trigger_source,
      });
      const generatedAt = new Date().toISOString();

      const { error: contactUpdateError } = await input.admin
        .from("contacts")
        .update({
          lead_memory_auto: normalizedMemory,
          lead_memory_last_generated_at: generatedAt,
          lead_memory_last_error: null,
        })
        .eq("id", rawJob.contact_id)
        .eq("clinic_id", rawJob.clinic_id);

      if (contactUpdateError) {
        throw contactUpdateError;
      }

      await markContactMemoryJobStatus(input.admin, rawJob.id, {
        status: "completed",
        lastError: null,
      });
      stats.jobs_completed += 1;
      jobsCompleted += 1;
    } catch (jobError) {
      const lastError = getErrorMessage(jobError);

      if (isContactMemoryCapReachedError(jobError)) {
        await markContactMemoryJobStatus(input.admin, rawJob.id, {
          status: "skipped",
          lastError,
        });
        await setContactMemoryError(input.admin, rawJob.contact_id, lastError);
        stats.jobs_skipped += 1;
        jobsSkipped += 1;
        continue;
      }

      if (
        isContactMemoryTransientError(jobError) &&
        currentAttempt < CONTACT_MEMORY_MAX_ATTEMPTS
      ) {
        await rescheduleContactMemoryJob(input.admin, rawJob.id, lastError);
        await setContactMemoryError(input.admin, rawJob.contact_id, lastError);
        continue;
      }

      await markContactMemoryJobStatus(input.admin, rawJob.id, {
        status: "failed",
        lastError,
      });
      await setContactMemoryError(input.admin, rawJob.contact_id, lastError);
      stats.jobs_failed += 1;
      jobsFailed += 1;
    }
  }

  const completedAt = new Date().toISOString();
  for (const [clinicId, stats] of clinicStats.entries()) {
    await recordContactMemoryRunnerRun(input.admin, {
      clinicId,
      triggerSource,
      requestedByUserId: input.requestedByUserId ?? null,
      startedAt,
      completedAt,
      status: "completed",
      stats,
    });
  }

  return {
    processed: jobsCompleted,
    jobs_scanned: jobs.length,
    jobs_completed: jobsCompleted,
    jobs_failed: jobsFailed,
    jobs_skipped: jobsSkipped,
  };
}

export async function getContactMemoryHealthSummary(
  client: ContactMemoryClient,
  clinicId: string,
  input: {
    runnerSecretConfigured: boolean;
  }
): Promise<ContactMemoryHealthSummary> {
  const nowIso = new Date().toISOString();
  const [
    pendingResult,
    overdueResult,
    failedResult,
    lastRunResult,
    latestGeneratedResult,
    latestErrorResult,
  ] = await Promise.all([
    client
      .from("contact_memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "pending"),
    client
      .from("contact_memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "pending")
      .lte("scheduled_for", nowIso),
    client
      .from("contact_memory_jobs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "failed"),
    client
      .from("contact_memory_runner_runs")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("contacts")
      .select("lead_memory_last_generated_at")
      .eq("clinic_id", clinicId)
      .not("lead_memory_last_generated_at", "is", null)
      .order("lead_memory_last_generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("contact_memory_jobs")
      .select("status, last_error, updated_at")
      .eq("clinic_id", clinicId)
      .not("last_error", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let schemaWarning: string | null = null;
  let lastRun: ContactMemoryRunnerRunSummary | null = null;
  const results = [
    pendingResult,
    overdueResult,
    failedResult,
    lastRunResult,
    latestGeneratedResult,
    latestErrorResult,
  ];

  for (const result of results) {
    if (!result.error) {
      continue;
    }

    if (isContactMemorySchemaMismatchError(result.error)) {
      schemaWarning =
        "Apply the latest supabase schema to enable lead memory health and runner history.";
      continue;
    }

    throw result.error;
  }

  if (lastRunResult.data) {
    const row = lastRunResult.data as Record<string, unknown>;
    lastRun = {
      id: row.id as string | undefined,
      clinic_id: row.clinic_id as string | undefined,
      trigger_source: row.trigger_source as AutomationTriggerSource,
      status: row.status as "completed" | "failed",
      jobs_scanned: (row.jobs_scanned as number | null) ?? 0,
      jobs_completed: (row.jobs_completed as number | null) ?? 0,
      jobs_failed: (row.jobs_failed as number | null) ?? 0,
      jobs_skipped: (row.jobs_skipped as number | null) ?? 0,
      started_at: row.started_at as string,
      completed_at: (row.completed_at as string | null) ?? null,
      error: (row.error as string | null) ?? null,
    };
  }

  return {
    provider_configured: hasContactMemoryAiConfig(),
    provider_configuration_error: getContactMemoryAiConfigError(),
    runner_secret_configured: input.runnerSecretConfigured,
    pending_jobs: pendingResult.count ?? 0,
    overdue_jobs: overdueResult.count ?? 0,
    failed_jobs: failedResult.count ?? 0,
    last_run: lastRun,
    latest_generated_at:
      (latestGeneratedResult.data?.lead_memory_last_generated_at as string | null) ??
      null,
    latest_error: latestErrorResult.data
      ? {
          message: (latestErrorResult.data.last_error as string | null) ?? "",
          updated_at:
            (latestErrorResult.data.updated_at as string | null) ?? null,
          status:
            (latestErrorResult.data.status as
              | "pending"
              | "processing"
              | "completed"
              | "failed"
              | "skipped"
              | null) ?? null,
        }
      : null,
    schema_warning: schemaWarning,
  };
}
