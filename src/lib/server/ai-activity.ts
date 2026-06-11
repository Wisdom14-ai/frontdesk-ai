import "server-only";

import { getClinicCapStatus, type ClinicCapStatus } from "@/lib/server/ai-cap";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";

export interface HandoffContactSummary {
  id: string;
  full_name: string;
  phone_e164: string;
  last_handoff_reason: string | null;
  updated_at: string;
}

export interface AiFeedItem {
  id: string;
  kind: "reply" | "follow_up" | "handoff" | "error";
  contactId: string | null;
  contactName: string;
  detail: string;
  confidence: number | null;
  at: string;
}

export interface AiActivitySummary {
  cap: ClinicCapStatus | null;
  aiRepliesLast7d: number;
  followUpsSentLast7d: number;
  pendingFollowUps: number;
  handoffCount: number;
  handoffContacts: HandoffContactSummary[];
  feed: AiFeedItem[];
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const JOB_TYPE_LABELS: Record<string, string> = {
  same_day_reminder: "Appointment reminder",
  no_reply_follow_up: "No-reply follow-up",
  monthly_nurture: "Monthly nurture",
  treatment_recall: "Treatment recall",
  no_show_recovery: "No-show recovery",
  post_visit_followup: "Post-visit follow-up",
};

export async function getAiActivitySummary(
  admin: SupabaseAdminClient,
  clinicId: string
): Promise<AiActivitySummary> {
  const since7d = daysAgoIso(7);
  const nowIso = new Date().toISOString();

  const [
    capResult,
    aiRepliesResult,
    followUpsSentResult,
    pendingFollowUpsResult,
    handoffCountResult,
    handoffContactsResult,
    aiMessagesResult,
    sentJobsResult,
    errorLogsResult,
  ] = await Promise.all([
    getClinicCapStatus(clinicId).catch(() => null),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("ai_generated", true)
      .eq("direction", "outbound")
      .gte("created_at", since7d),
    admin
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "sent")
      .gte("sent_at", since7d),
    admin
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("status", "pending")
      .gte("scheduled_for", nowIso),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("bot_mode", "handoff_required"),
    admin
      .from("contacts")
      .select("id, full_name, phone_e164, last_handoff_reason, updated_at")
      .eq("clinic_id", clinicId)
      .eq("bot_mode", "handoff_required")
      .order("updated_at", { ascending: false })
      .limit(8),
    admin
      .from("messages")
      .select("id, contact_id, content, ai_confidence, created_at")
      .eq("clinic_id", clinicId)
      .eq("ai_generated", true)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(15),
    admin
      .from("automation_jobs")
      .select("id, contact_id, job_type, sent_at")
      .eq("clinic_id", clinicId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(10),
    admin
      .from("ai_usage_logs")
      .select("id, contact_id, operation_type, status, error_message, created_at")
      .eq("clinic_id", clinicId)
      .in("status", ["error", "blocked"])
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  // Resolve contact names for everything in the feed with one query.
  const contactIds = new Set<string>();
  for (const row of aiMessagesResult.data ?? []) {
    if (row.contact_id) contactIds.add(row.contact_id as string);
  }
  for (const row of sentJobsResult.data ?? []) {
    if (row.contact_id) contactIds.add(row.contact_id as string);
  }
  for (const row of errorLogsResult.data ?? []) {
    if (row.contact_id) contactIds.add(row.contact_id as string);
  }

  const nameById = new Map<string, string>();
  if (contactIds.size > 0) {
    const { data: nameRows } = await admin
      .from("contacts")
      .select("id, full_name")
      .in("id", [...contactIds]);
    for (const row of nameRows ?? []) {
      nameById.set(row.id as string, (row.full_name as string) || "Unknown lead");
    }
  }

  const contactName = (id: string | null) =>
    (id && nameById.get(id)) || "Unknown lead";

  const feed: AiFeedItem[] = [];

  for (const row of aiMessagesResult.data ?? []) {
    feed.push({
      id: `msg-${row.id}`,
      kind: "reply",
      contactId: (row.contact_id as string | null) ?? null,
      contactName: contactName(row.contact_id as string | null),
      detail: (row.content as string) ?? "",
      confidence: row.ai_confidence != null ? Number(row.ai_confidence) : null,
      at: (row.created_at as string) ?? nowIso,
    });
  }

  for (const row of sentJobsResult.data ?? []) {
    feed.push({
      id: `job-${row.id}`,
      kind: "follow_up",
      contactId: (row.contact_id as string | null) ?? null,
      contactName: contactName(row.contact_id as string | null),
      detail: JOB_TYPE_LABELS[(row.job_type as string) ?? ""] ?? "Follow-up sent",
      confidence: null,
      at: (row.sent_at as string) ?? nowIso,
    });
  }

  for (const row of errorLogsResult.data ?? []) {
    feed.push({
      id: `log-${row.id}`,
      kind: "error",
      contactId: (row.contact_id as string | null) ?? null,
      contactName: contactName(row.contact_id as string | null),
      detail:
        row.status === "blocked"
          ? `AI call blocked (${row.operation_type})`
          : `${row.operation_type} failed: ${(row.error_message as string | null) ?? "unknown error"}`,
      confidence: null,
      at: (row.created_at as string) ?? nowIso,
    });
  }

  feed.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    cap: capResult,
    aiRepliesLast7d: aiRepliesResult.count ?? 0,
    followUpsSentLast7d: followUpsSentResult.count ?? 0,
    pendingFollowUps: pendingFollowUpsResult.count ?? 0,
    handoffCount: handoffCountResult.count ?? 0,
    handoffContacts: (handoffContactsResult.data ?? []).map((row) => ({
      id: row.id as string,
      full_name: (row.full_name as string) || "Unknown lead",
      phone_e164: (row.phone_e164 as string) || "",
      last_handoff_reason: (row.last_handoff_reason as string | null) ?? null,
      updated_at: (row.updated_at as string) ?? nowIso,
    })),
    feed: feed.slice(0, 25),
  };
}
