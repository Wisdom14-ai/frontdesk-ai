import "server-only";

import { getClinicUsageSummary } from "@/lib/server/clinic";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import type { ClinicUsageSummary } from "@/types";

// A contact counts as "converted" once it reaches one of these pipeline
// states — i.e. the lead turned into real business.
const CONVERSION_STATUSES = new Set([
  "booked_appointment",
  "attended_visit",
  "patient",
]);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function thirtyDaysAgoIso() {
  return new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "42703" || code === "PGRST204" || code === "PGRST205";
}

export interface ClinicOverviewRow {
  id: string;
  name: string;
  plan_type: string | null;
  subscription_status: string | null;
  payment_status: string | null;
  whatsapp_status: string | null;
  created_at: string | null;
  total_contacts: number;
  messages_30d: number;
  ai_spend_usd_30d: number;
  last_bot_skip_reason: string | null;
  last_bot_skip_at: string | null;
}

export interface ConversionCohort {
  label: string;
  contacts: number;
  converted: number;
  conversion_pct: number;
  revenue_myr: number;
}

export interface ConversionWindow {
  bot_touched: ConversionCohort;
  human_only: ConversionCohort;
}

export interface AiOperationStat {
  operation_type: string;
  calls: number;
  errors: number;
  blocked: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  avg_latency_ms: number | null;
}

export interface AiUsageWindow {
  total_cost_usd: number;
  total_calls: number;
  by_operation: AiOperationStat[];
}

export interface ClinicDrilldown {
  clinic: {
    id: string;
    name: string;
    plan_type: string | null;
    clinic_type: string | null;
    subscription_status: string | null;
    payment_status: string | null;
    payment_received_at: string | null;
    billing_cycle_anchor: string | null;
    whatsapp_status: string | null;
    evolution_instance_name: string | null;
    owner_name: string | null;
    owner_phone: string | null;
    clinic_prompt: string | null;
    clinic_knowledge: string | null;
    internal_notes: string | null;
    manual_monthly_cost_myr: number | null;
    contact_limit_override: number | null;
    monthly_message_limit_override: number | null;
    created_at: string | null;
    ai_paused_at: string | null;
    ai_paused_reason: string | null;
    last_bot_skip_reason: string | null;
    last_bot_skip_at: string | null;
  };
  usage: ClinicUsageSummary;
  staff_count: number;
  cap_blocked_contacts: number;
  inbound_reply_count: number;
  pipeline: { status: string; count: number }[];
  conversion: { all_time: ConversionWindow; last_30d: ConversionWindow };
  ai_usage: { all_time: AiUsageWindow; last_30d: AiUsageWindow };
  revenue_tracked: boolean;
}

export interface GoLiveCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface GoLiveChecklist {
  checks: GoLiveCheck[];
  live: boolean;
  failing: GoLiveCheck[];
}

/**
 * The go-live checklist that determines whether the bot is actually live for a
 * clinic. Every red item is a concrete reason inbound messages go unanswered —
 * this is what kills the silent-failure class.
 */
export function buildGoLiveChecklist(input: {
  clinic: ClinicDrilldown["clinic"];
  inboundReplyCount: number;
  chatbotConfigured: boolean;
}): GoLiveChecklist {
  const { clinic, inboundReplyCount, chatbotConfigured } = input;
  const knowledgeLen = clinic.clinic_knowledge?.trim().length ?? 0;

  const checks: GoLiveCheck[] = [
    {
      key: "payment",
      label: "Payment received",
      ok: clinic.payment_status === "received",
      detail:
        clinic.payment_status === "received"
          ? "Payment marked received."
          : "Payment is pending — the bot will not reply.",
    },
    {
      key: "subscription",
      label: "Subscription active",
      ok: clinic.subscription_status === "active",
      detail:
        clinic.subscription_status === "active"
          ? "Subscription active."
          : `Subscription is ${clinic.subscription_status ?? "unset"}.`,
    },
    {
      key: "whatsapp",
      label: "WhatsApp connected",
      ok:
        clinic.whatsapp_status === "connected" &&
        Boolean(clinic.evolution_instance_name),
      detail:
        clinic.whatsapp_status === "connected" && clinic.evolution_instance_name
          ? "WhatsApp connected."
          : "WhatsApp is not connected.",
    },
    {
      key: "knowledge",
      label: "Clinic knowledge filled",
      ok: knowledgeLen > 0,
      detail:
        knowledgeLen > 0
          ? `${knowledgeLen} characters of clinic knowledge.`
          : "Clinic knowledge is empty — replies will be generic.",
    },
    {
      key: "chatbot_env",
      label: "Chatbot configured",
      ok: chatbotConfigured,
      detail: chatbotConfigured
        ? "Chatbot environment configured."
        : "Chatbot environment (API key/model) is not configured on this server.",
    },
    {
      key: "inbound_reply",
      label: "Replied at least once",
      ok: inboundReplyCount > 0,
      detail:
        inboundReplyCount > 0
          ? `${inboundReplyCount} inbound replies logged.`
          : "No inbound_reply has ever been logged — the bot has not answered a single lead.",
    },
  ];

  const failing = checks.filter((c) => !c.ok);
  return { checks, live: failing.length === 0, failing };
}

interface ContactRow {
  id: string;
  current_status: string | null;
  created_at: string | null;
  revenue_generated_myr?: number | null;
}

/**
 * Fetch all non-trash contacts for a clinic. Revenue tracking is optional in
 * the schema, so fall back gracefully if the column is absent.
 */
async function fetchContacts(
  admin: SupabaseAdminClient,
  clinicId: string
): Promise<{ rows: ContactRow[]; revenueTracked: boolean }> {
  const withRevenue = await admin
    .from("contacts")
    .select("id, current_status, created_at, revenue_generated_myr")
    .eq("clinic_id", clinicId)
    .neq("current_status", "trash");

  if (!withRevenue.error) {
    return {
      rows: (withRevenue.data ?? []) as ContactRow[],
      revenueTracked: true,
    };
  }

  if (!isMissingColumnError(withRevenue.error)) {
    throw withRevenue.error;
  }

  const fallback = await admin
    .from("contacts")
    .select("id, current_status, created_at")
    .eq("clinic_id", clinicId)
    .neq("current_status", "trash");

  if (fallback.error) {
    throw fallback.error;
  }

  return { rows: (fallback.data ?? []) as ContactRow[], revenueTracked: false };
}

interface OptionalClinicColumns {
  clinic_knowledge: string | null;
  last_bot_skip_reason: string | null;
  last_bot_skip_at: string | null;
}

/**
 * Fetch columns that may not exist yet in every environment (clinic_knowledge
 * and the last_bot_skip_* observability columns). Degrades one column at a time
 * so a partial migration still returns whatever is present.
 */
async function fetchOptionalClinicColumns(
  admin: SupabaseAdminClient,
  clinicId: string
): Promise<OptionalClinicColumns> {
  const empty: OptionalClinicColumns = {
    clinic_knowledge: null,
    last_bot_skip_reason: null,
    last_bot_skip_at: null,
  };

  // Try the full optional set first.
  const full = await admin
    .from("clinics")
    .select("clinic_knowledge, last_bot_skip_reason, last_bot_skip_at")
    .eq("id", clinicId)
    .maybeSingle();

  if (!full.error && full.data) {
    const row = full.data as Record<string, unknown>;
    return {
      clinic_knowledge: (row.clinic_knowledge as string | null) ?? null,
      last_bot_skip_reason: (row.last_bot_skip_reason as string | null) ?? null,
      last_bot_skip_at: (row.last_bot_skip_at as string | null) ?? null,
    };
  }

  if (full.error && !isMissingColumnError(full.error)) {
    throw full.error;
  }

  // Some optional column is missing — probe each independently.
  const result = { ...empty };
  for (const column of [
    "clinic_knowledge",
    "last_bot_skip_reason",
    "last_bot_skip_at",
  ] as const) {
    const single = await admin
      .from("clinics")
      .select(column)
      .eq("id", clinicId)
      .maybeSingle();
    if (!single.error && single.data) {
      const value = (single.data as Record<string, unknown>)[column];
      result[column] = (value as string | null) ?? null;
    } else if (single.error && !isMissingColumnError(single.error)) {
      throw single.error;
    }
  }
  return result;
}

function buildCohort(label: string, rows: ContactRow[]): ConversionCohort {
  const contacts = rows.length;
  let converted = 0;
  let revenue = 0;
  for (const row of rows) {
    if (row.current_status && CONVERSION_STATUSES.has(row.current_status)) {
      converted += 1;
    }
    revenue += Number(row.revenue_generated_myr ?? 0) || 0;
  }
  return {
    label,
    contacts,
    converted,
    conversion_pct: contacts > 0 ? Math.round((converted / contacts) * 1000) / 10 : 0,
    revenue_myr: Math.round(revenue * 100) / 100,
  };
}

function splitConversion(
  rows: ContactRow[],
  botTouchedIds: Set<string>
): ConversionWindow {
  const bot: ContactRow[] = [];
  const human: ContactRow[] = [];
  for (const row of rows) {
    if (botTouchedIds.has(row.id)) bot.push(row);
    else human.push(row);
  }
  return {
    bot_touched: buildCohort("Bot-touched", bot),
    human_only: buildCohort("Human-only", human),
  };
}

/**
 * Contact ids that ever received a bot/AI-generated outbound message — used
 * to attribute conversion impact to the chatbot.
 */
async function fetchBotTouchedContactIds(
  admin: SupabaseAdminClient,
  clinicId: string
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("messages")
    .select("contact_id")
    .eq("clinic_id", clinicId)
    .eq("sender_type", "bot");

  if (error) {
    throw error;
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as { contact_id: string | null }[]) {
    if (row.contact_id) ids.add(row.contact_id);
  }
  return ids;
}

interface AiUsageRow {
  operation_type: string;
  status: string;
  cost_usd: number | string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

function aggregateAiUsage(rows: AiUsageRow[]): AiUsageWindow {
  const byOp = new Map<
    string,
    AiOperationStat & { _latencySum: number; _latencyCount: number }
  >();
  let totalCost = 0;

  for (const row of rows) {
    const op = row.operation_type || "unknown";
    const cost = Number(row.cost_usd ?? 0) || 0;
    totalCost += cost;

    const entry =
      byOp.get(op) ??
      {
        operation_type: op,
        calls: 0,
        errors: 0,
        blocked: 0,
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        avg_latency_ms: null,
        _latencySum: 0,
        _latencyCount: 0,
      };

    entry.calls += 1;
    if (row.status === "error") entry.errors += 1;
    if (row.status === "blocked") entry.blocked += 1;
    entry.cost_usd += cost;
    entry.input_tokens += row.input_tokens ?? 0;
    entry.output_tokens += row.output_tokens ?? 0;
    if (typeof row.latency_ms === "number") {
      entry._latencySum += row.latency_ms;
      entry._latencyCount += 1;
    }
    byOp.set(op, entry);
  }

  const by_operation: AiOperationStat[] = [...byOp.values()]
    .map((e) => ({
      operation_type: e.operation_type,
      calls: e.calls,
      errors: e.errors,
      blocked: e.blocked,
      cost_usd: Math.round(e.cost_usd * 1_000_000) / 1_000_000,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      avg_latency_ms:
        e._latencyCount > 0 ? Math.round(e._latencySum / e._latencyCount) : null,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  return {
    total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
    total_calls: rows.length,
    by_operation,
  };
}

/**
 * Platform-wide clinic list for the super-admin index.
 */
export async function getClinicsOverview(
  admin: SupabaseAdminClient
): Promise<ClinicOverviewRow[]> {
  const baseColumns =
    "id, name, plan_type, subscription_status, payment_status, whatsapp_status, created_at";

  // last_bot_skip_* may not be migrated yet — try with them, fall back without.
  const withSkip = await admin
    .from("clinics")
    .select(`${baseColumns}, last_bot_skip_reason, last_bot_skip_at`)
    .order("created_at", { ascending: false });

  let clinics = withSkip.data as Record<string, unknown>[] | null;
  let error = withSkip.error;

  if (error && isMissingColumnError(error)) {
    const fallback = await admin
      .from("clinics")
      .select(baseColumns)
      .order("created_at", { ascending: false });
    clinics = fallback.data as Record<string, unknown>[] | null;
    error = fallback.error;
  }

  if (error) {
    throw error;
  }

  const since = thirtyDaysAgoIso();

  const rows = await Promise.all(
    (clinics ?? []).map(async (clinic) => {
      const [contactsRes, messagesRes, aiRes] = await Promise.all([
        admin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinic.id as string)
          .neq("current_status", "trash"),
        admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinic.id as string)
          .gte("created_at", since),
        admin
          .from("ai_usage_logs")
          .select("cost_usd")
          .eq("clinic_id", clinic.id as string)
          .gte("created_at", since),
      ]);

      let aiSpend = 0;
      for (const r of (aiRes.data ?? []) as { cost_usd: number | string | null }[]) {
        aiSpend += Number(r.cost_usd ?? 0) || 0;
      }

      return {
        id: clinic.id as string,
        name: (clinic.name as string) ?? "Unnamed clinic",
        plan_type: (clinic.plan_type as string | null) ?? null,
        subscription_status: (clinic.subscription_status as string | null) ?? null,
        payment_status: (clinic.payment_status as string | null) ?? null,
        whatsapp_status: (clinic.whatsapp_status as string | null) ?? null,
        created_at: (clinic.created_at as string | null) ?? null,
        total_contacts: contactsRes.count ?? 0,
        messages_30d: messagesRes.count ?? 0,
        ai_spend_usd_30d: Math.round(aiSpend * 1_000_000) / 1_000_000,
        last_bot_skip_reason:
          (clinic.last_bot_skip_reason as string | null) ?? null,
        last_bot_skip_at: (clinic.last_bot_skip_at as string | null) ?? null,
      } satisfies ClinicOverviewRow;
    })
  );

  return rows;
}

/**
 * Full per-clinic drill-down for the super-admin dashboard.
 */
export async function getClinicDrilldown(
  admin: SupabaseAdminClient,
  clinicId: string
): Promise<ClinicDrilldown | null> {
  const { data: clinic, error } = await admin
    .from("clinics")
    .select(
      "id, name, plan_type, clinic_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, owner_name, owner_phone, clinic_prompt, internal_notes, manual_monthly_cost_myr, created_at, payment_received_at, billing_cycle_anchor, contact_limit_override, monthly_message_limit_override, ai_paused_at, ai_paused_reason"
    )
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!clinic) {
    return null;
  }

  // Columns that may not be migrated yet (clinic_knowledge, last_bot_skip_*).
  // Fetch them in an isolated, schema-tolerant query so a missing column never
  // breaks the whole drill-down.
  const optional = await fetchOptionalClinicColumns(admin, clinicId);

  const since = thirtyDaysAgoIso();

  const CAP_REASONS = ["cap_exceeded", "ai_paused", "cap_check_failed", "ai_cap_blocked"];

  const [
    usage,
    { rows: contacts, revenueTracked },
    botTouchedIds,
    staffRes,
    capBlockedRes,
    inboundReplyRes,
    aiAllRes,
    ai30Res,
  ] = await Promise.all([
    getClinicUsageSummary(admin, {
      id: clinic.id as string,
      plan_type: (clinic.plan_type as "starter" | "pro") ?? "starter",
      payment_received_at: (clinic.payment_received_at as string | null) ?? null,
      billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
      created_at: (clinic.created_at as string | null) ?? null,
      contact_limit_override:
        (clinic.contact_limit_override as number | null) ?? null,
      monthly_message_limit_override:
        (clinic.monthly_message_limit_override as number | null) ?? null,
    }),
    fetchContacts(admin, clinicId),
    fetchBotTouchedContactIds(admin, clinicId),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("bot_mode", "handoff_required")
      .in("last_handoff_reason", CAP_REASONS),
    admin
      .from("ai_usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("operation_type", "inbound_reply"),
    admin
      .from("ai_usage_logs")
      .select(
        "operation_type, status, cost_usd, input_tokens, output_tokens, latency_ms, created_at"
      )
      .eq("clinic_id", clinicId),
    admin
      .from("ai_usage_logs")
      .select(
        "operation_type, status, cost_usd, input_tokens, output_tokens, latency_ms, created_at"
      )
      .eq("clinic_id", clinicId)
      .gte("created_at", since),
  ]);

  // Pipeline snapshot
  const pipelineMap = new Map<string, number>();
  for (const row of contacts) {
    const key = row.current_status ?? "unknown";
    pipelineMap.set(key, (pipelineMap.get(key) ?? 0) + 1);
  }
  const pipeline = [...pipelineMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // Conversion: all-time vs contacts created in the last 30 days
  const sinceMs = Date.now() - THIRTY_DAYS_MS;
  const recentContacts = contacts.filter((c) => {
    if (!c.created_at) return false;
    return new Date(c.created_at).getTime() >= sinceMs;
  });

  const aiAllRows = (aiAllRes.data ?? []) as AiUsageRow[];
  const ai30Rows = (ai30Res.data ?? []) as AiUsageRow[];

  return {
    clinic: {
      id: clinic.id as string,
      name: (clinic.name as string) ?? "Unnamed clinic",
      plan_type: (clinic.plan_type as string | null) ?? null,
      clinic_type: (clinic.clinic_type as string | null) ?? null,
      subscription_status: (clinic.subscription_status as string | null) ?? null,
      payment_status: (clinic.payment_status as string | null) ?? null,
      payment_received_at: (clinic.payment_received_at as string | null) ?? null,
      billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
      whatsapp_status: (clinic.whatsapp_status as string | null) ?? null,
      evolution_instance_name:
        (clinic.evolution_instance_name as string | null) ?? null,
      owner_name: (clinic.owner_name as string | null) ?? null,
      owner_phone: (clinic.owner_phone as string | null) ?? null,
      clinic_prompt: (clinic.clinic_prompt as string | null) ?? null,
      clinic_knowledge: optional.clinic_knowledge,
      internal_notes: (clinic.internal_notes as string | null) ?? null,
      manual_monthly_cost_myr:
        (clinic.manual_monthly_cost_myr as number | null) ?? null,
      contact_limit_override:
        (clinic.contact_limit_override as number | null) ?? null,
      monthly_message_limit_override:
        (clinic.monthly_message_limit_override as number | null) ?? null,
      created_at: (clinic.created_at as string | null) ?? null,
      ai_paused_at: (clinic.ai_paused_at as string | null) ?? null,
      ai_paused_reason: (clinic.ai_paused_reason as string | null) ?? null,
      last_bot_skip_reason: optional.last_bot_skip_reason,
      last_bot_skip_at: optional.last_bot_skip_at,
    },
    usage,
    staff_count: staffRes.count ?? 0,
    cap_blocked_contacts: capBlockedRes.count ?? 0,
    inbound_reply_count: inboundReplyRes.count ?? 0,
    pipeline,
    conversion: {
      all_time: splitConversion(contacts, botTouchedIds),
      last_30d: splitConversion(recentContacts, botTouchedIds),
    },
    ai_usage: {
      all_time: aggregateAiUsage(aiAllRows),
      last_30d: aggregateAiUsage(ai30Rows),
    },
    revenue_tracked: revenueTracked,
  };
}
