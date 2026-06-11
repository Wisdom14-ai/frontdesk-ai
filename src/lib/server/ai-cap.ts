import "server-only";

import { logAiUsage } from "@/lib/ai-usage-logger";
import { createAdminClient, type SupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_AI_MONTHLY_CAP_USD = 25;
const AI_CAP_WARNING_PERCENTAGE = 80;

export interface ClinicCapStatus {
  capUsd: number;
  currentCostUsd: number;
  percentageUsed: number;
  isPaused: boolean;
  pausedReason: string | null;
  shouldBlock: boolean;
  shouldWarn: boolean;
  cycleStart: Date;
}

interface ClinicCapStatusInternal extends ClinicCapStatus {
  warningSentAt: Date | null;
}

interface ClinicCapRow {
  id: string;
  ai_monthly_cost_cap_usd?: number | string | null;
  ai_paused_at?: string | null;
  ai_paused_reason?: string | null;
  ai_warning_sent_at?: string | null;
  billing_cycle_start_at?: string | null;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function startOfCurrentUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPercentageUsed(currentCostUsd: number, capUsd: number) {
  if (capUsd <= 0) {
    return currentCostUsd > 0 ? 100 : 0;
  }

  return Math.round((currentCostUsd / capUsd) * 10_000) / 100;
}

function getRequiredAdminClient() {
  const admin = createAdminClient();

  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for AI cap enforcement.");
  }

  return admin;
}

async function getCurrentCycleCostUsd(
  admin: SupabaseAdminClient,
  clinicId: string,
  cycleStart: Date
) {
  const { data, error } = await admin.rpc("get_clinic_ai_usage_cycle_cost", {
    p_clinic_id: clinicId,
    p_cycle_start: cycleStart.toISOString(),
  });

  if (error) {
    throw error;
  }

  return toFiniteNumber(data);
}

async function getClinicCapStatusInternal(
  clinicId: string
): Promise<ClinicCapStatusInternal> {
  const admin = getRequiredAdminClient();
  const { data: clinic, error } = await admin
    .from("clinics")
    .select(
      "id, ai_monthly_cost_cap_usd, ai_paused_at, ai_paused_reason, ai_warning_sent_at, billing_cycle_start_at"
    )
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!clinic) {
    throw new Error("Clinic not found for AI cap enforcement.");
  }

  const clinicRow = clinic as ClinicCapRow;
  const capUsd = toFiniteNumber(
    clinicRow.ai_monthly_cost_cap_usd,
    DEFAULT_AI_MONTHLY_CAP_USD
  );
  const cycleStart =
    parseTimestamp(clinicRow.billing_cycle_start_at) ?? startOfCurrentUtcMonth();
  const currentCostUsd = await getCurrentCycleCostUsd(admin, clinicId, cycleStart);
  const percentageUsed = buildPercentageUsed(currentCostUsd, capUsd);
  const isPaused = Boolean(clinicRow.ai_paused_at);
  const shouldBlock = capUsd <= 0 || currentCostUsd >= capUsd;
  const shouldWarn =
    percentageUsed >= AI_CAP_WARNING_PERCENTAGE && percentageUsed < 100;

  return {
    capUsd,
    currentCostUsd,
    percentageUsed,
    isPaused,
    pausedReason: clinicRow.ai_paused_reason ?? null,
    shouldBlock,
    shouldWarn,
    cycleStart,
    warningSentAt: parseTimestamp(clinicRow.ai_warning_sent_at),
  };
}

export async function getClinicCapStatus(
  clinicId: string
): Promise<ClinicCapStatus> {
  const status = await getClinicCapStatusInternal(clinicId);

  return {
    capUsd: status.capUsd,
    currentCostUsd: status.currentCostUsd,
    percentageUsed: status.percentageUsed,
    isPaused: status.isPaused,
    pausedReason: status.pausedReason,
    shouldBlock: status.shouldBlock,
    shouldWarn: status.shouldWarn,
    cycleStart: status.cycleStart,
  };
}

async function logBlockedAiUsage(params: {
  clinicId: string;
  contactId?: string | null;
  operationType: string;
  model: string;
  errorMessage: string;
}) {
  await logAiUsage({
    clinicId: params.clinicId,
    contactId: params.contactId,
    operationType: params.operationType,
    model: params.model,
    inputTokens: 0,
    outputTokens: 0,
    status: "blocked",
    errorMessage: params.errorMessage,
  });
}

async function insertClinicNotification(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    severity: "info" | "warning" | "critical";
    category: string;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
  }
) {
  const { error } = await admin.from("clinic_notifications").insert({
    clinic_id: input.clinicId,
    severity: input.severity,
    category: input.category,
    title: input.title,
    body: input.body,
    metadata: input.metadata,
  });

  if (error) {
    throw error;
  }
}

function buildUsageMetadata(status: ClinicCapStatus) {
  return {
    current_cost_usd: status.currentCostUsd,
    cap_usd: status.capUsd,
    percentage: status.percentageUsed,
    cycle_start: status.cycleStart.toISOString(),
  };
}

function warningAlreadySentThisCycle(status: ClinicCapStatusInternal) {
  return Boolean(
    status.warningSentAt && status.warningSentAt.getTime() >= status.cycleStart.getTime()
  );
}

async function selfHealExpiredCapPause(
  clinicId: string,
  status: ClinicCapStatusInternal
): Promise<ClinicCapStatusInternal> {
  if (!status.isPaused || status.pausedReason !== "cap_exceeded") {
    return status;
  }

  const currentMonthStart = startOfCurrentUtcMonth();
  if (status.cycleStart.getTime() >= currentMonthStart.getTime()) {
    return status;
  }

  // The pause belongs to a previous billing cycle. Clear it inline so AI
  // recovers even if the reset cron failed or never ran.
  const admin = getRequiredAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("clinics")
    .update({
      ai_paused_at: null,
      ai_paused_reason: null,
      ai_warning_sent_at: null,
      billing_cycle_start_at: currentMonthStart.toISOString(),
      updated_at: nowIso,
    })
    .eq("id", clinicId);

  if (error) {
    console.error("[ai-cap] Failed to self-heal expired cap pause.", {
      clinicId,
      message: error.message,
      code: error.code,
    });
    return status;
  }

  console.info("[ai-cap] Cleared expired cap pause for new billing cycle.", {
    clinicId,
    newCycleStart: currentMonthStart.toISOString(),
  });

  return getClinicCapStatusInternal(clinicId);
}

export async function enforceCapBeforeAiCall(params: {
  clinicId: string;
  contactId?: string | null;
  operationType: string;
  model: string;
}): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  let status: ClinicCapStatusInternal;

  try {
    status = await getClinicCapStatusInternal(params.clinicId);
    status = await selfHealExpiredCapPause(params.clinicId, status);
  } catch (error) {
    console.error("[ai-cap] Failed to evaluate AI cap. Blocking AI call.", {
      clinicId: params.clinicId,
      operationType: params.operationType,
      message: error instanceof Error ? error.message : String(error),
    });

    return { allowed: false, reason: "cap_check_failed" };
  }

  if (status.isPaused) {
    const pausedReason = status.pausedReason ?? "unknown";
    await logBlockedAiUsage({
      ...params,
      errorMessage: `AI paused: ${pausedReason}`,
    });

    return { allowed: false, reason: "ai_paused" };
  }

  const admin = getRequiredAdminClient();

  if (status.shouldBlock) {
    const nowIso = new Date().toISOString();

    const { error: pauseError } = await admin
      .from("clinics")
      .update({
        ai_paused_at: nowIso,
        ai_paused_reason: "cap_exceeded",
        updated_at: nowIso,
      })
      .eq("id", params.clinicId);

    if (pauseError) {
      console.error("[ai-cap] Failed to persist AI pause flag.", {
        clinicId: params.clinicId,
        message: pauseError.message,
        details: pauseError.details,
        hint: pauseError.hint,
        code: pauseError.code,
      });
    }

    try {
      await insertClinicNotification(admin, {
        clinicId: params.clinicId,
        severity: "critical",
        category: "ai_cap_paused",
        title: "AI replies paused",
        body: "Your clinic reached its monthly AI usage cap. AI replies and memory generation are paused until the next cycle or an agency override.",
        metadata: buildUsageMetadata(status),
      });

      console.info("[ai-cap] Created AI cap pause notification.", {
        clinicId: params.clinicId,
        currentCostUsd: status.currentCostUsd,
        capUsd: status.capUsd,
      });
    } catch (error) {
      console.warn("[ai-cap] Failed to create AI cap pause notification.", {
        clinicId: params.clinicId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await logBlockedAiUsage({
      ...params,
      errorMessage: "AI paused: cap_exceeded",
    });

    return { allowed: false, reason: "cap_exceeded" };
  }

  if (status.shouldWarn && !warningAlreadySentThisCycle(status)) {
    try {
      await insertClinicNotification(admin, {
        clinicId: params.clinicId,
        severity: "warning",
        category: "ai_cap_warning",
        title: "AI usage is near the monthly cap",
        body: "Your clinic has used at least 80% of its monthly AI usage cap.",
        metadata: buildUsageMetadata(status),
      });

      const { error: warningError } = await admin
        .from("clinics")
        .update({ ai_warning_sent_at: new Date().toISOString() })
        .eq("id", params.clinicId);

      if (warningError) {
        console.warn("[ai-cap] Failed to store AI warning timestamp.", {
          clinicId: params.clinicId,
          message: warningError.message,
          details: warningError.details,
          hint: warningError.hint,
          code: warningError.code,
        });
      }

      console.info("[ai-cap] Created AI cap warning notification.", {
        clinicId: params.clinicId,
        currentCostUsd: status.currentCostUsd,
        capUsd: status.capUsd,
      });
    } catch (error) {
      console.warn("[ai-cap] Failed to create AI cap warning notification.", {
        clinicId: params.clinicId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { allowed: true };
}
