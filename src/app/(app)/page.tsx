import { formatDistanceToNow } from "date-fns";

import { DashboardClient } from "@/components/dashboard/DashboardClient";
import {
  buildCloseoutPrompts,
  buildWeeklyDigest,
  calculateAverageResponseTime,
  calculateBotHandledRate,
  countHumanHandoffs,
} from "@/lib/metrics";
import { getAutomationHealthSummary } from "@/lib/server/automation";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { hasAutomationRunnerProtection } from "@/lib/server/runner-auth";
import type { AutomationHealthSummary, LaunchStatus, LaunchStatusCard } from "@/types";

const WHATSAPP_SYNC_HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTOMATION_RUNNER_HEALTH_WINDOW_MS = 15 * 60 * 1000;

function getTimestampMs(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getRelativeTimeLabel(value?: string | null) {
  const timestampMs = getTimestampMs(value);

  if (timestampMs === null) {
    return null;
  }

  return formatDistanceToNow(new Date(timestampMs), { addSuffix: true });
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function buildAutomationStatusCard(input: {
  health: AutomationHealthSummary;
  now: Date;
}): LaunchStatusCard {
  const monitoringUnavailable =
    !input.health.service_role_configured ||
    !input.health.runner_secret_configured ||
    Boolean(input.health.schema_warning);

  if (monitoringUnavailable) {
    return {
      id: "automation_runner",
      label: "Automation runner status",
      description: "Track whether scheduled follow-ups are processing cleanly.",
      state: "unavailable",
      detail: "Status unavailable until automation monitoring is fully configured.",
    };
  }

  if (!input.health.last_run) {
    return {
      id: "automation_runner",
      label: "Automation runner status",
      description: "Track whether scheduled follow-ups are processing cleanly.",
      state: "warning",
      detail: "No automation runner activity has been recorded yet.",
    };
  }

  const lastRunAt = input.health.last_run.completed_at ?? input.health.last_run.started_at;
  const lastRunMs = getTimestampMs(lastRunAt);
  const hasRecentRun =
    lastRunMs !== null &&
    input.now.getTime() - lastRunMs <= AUTOMATION_RUNNER_HEALTH_WINDOW_MS;
  const hasFailures =
    input.health.failed_jobs > 0 || input.health.last_run.status === "failed";

  if (hasRecentRun && input.health.overdue_jobs === 0 && !hasFailures) {
    return {
      id: "automation_runner",
      label: "Automation runner status",
      description: "Track whether scheduled follow-ups are processing cleanly.",
      state: "complete",
      detail: `Last run ${getRelativeTimeLabel(lastRunAt) ?? "recently"} with no overdue or failed jobs.`,
    };
  }

  const warningParts: string[] = [];

  if (!hasRecentRun) {
    warningParts.push(`Last run ${getRelativeTimeLabel(lastRunAt) ?? "recently"}.`);
  }

  if (input.health.overdue_jobs > 0) {
    warningParts.push(
      `${input.health.overdue_jobs} overdue ${pluralize(input.health.overdue_jobs, "job")} pending.`
    );
  }

  if (hasFailures) {
    const failedCount = input.health.failed_jobs > 0 ? input.health.failed_jobs : 1;
    warningParts.push(
      `${failedCount} failed ${pluralize(failedCount, "job")} need review.`
    );
  }

  return {
    id: "automation_runner",
    label: "Automation runner status",
    description: "Track whether scheduled follow-ups are processing cleanly.",
    state: "warning",
    detail: warningParts.join(" ").trim() || "Recent automation activity needs attention.",
  };
}

function buildLaunchStatus(input: {
  paymentStatus?: string | null;
  whatsappStatus?: string | null;
  whatsappLastSyncedAt?: string | null;
  staffCount: number;
  totalLeads: number;
  totalRevenue: number;
  canManage: boolean;
  automationHealth: AutomationHealthSummary;
  now: Date;
}): LaunchStatus {
  const paymentReceived = input.paymentStatus === "received";
  const whatsappConnected = input.whatsappStatus === "connected";
  const whatsappLastSyncedMs = getTimestampMs(input.whatsappLastSyncedAt);
  const hasRecentWhatsappSync =
    whatsappConnected &&
    whatsappLastSyncedMs !== null &&
    input.now.getTime() - whatsappLastSyncedMs <= WHATSAPP_SYNC_HEALTH_WINDOW_MS;
  const whatsappSyncRelative = getRelativeTimeLabel(input.whatsappLastSyncedAt);

  const readinessCards: LaunchStatusCard[] = [
    {
      id: "plan_activated",
      label: "Plan activated",
      description: "Your subscription payment has been marked received and the workspace is unlocked.",
      state: paymentReceived ? "complete" : "blocked",
      detail: paymentReceived
        ? "Payment has been received and the workspace is unlocked."
        : "Payment is still pending before the clinic can go live.",
    },
    {
      id: "whatsapp_connected",
      label: "WhatsApp connected",
      description: "Link the clinic phone so the shared inbox can send and receive messages.",
      state: whatsappConnected ? "complete" : "blocked",
      detail: whatsappConnected
        ? "The clinic number is linked to the shared inbox."
        : "Connect the clinic phone to start receiving and sending messages.",
    },
    {
      id: "whatsapp_sync",
      label: "Recent WhatsApp sync",
      description: "Check that the inbox has seen a recent platform sync.",
      state: !whatsappConnected
        ? "blocked"
        : hasRecentWhatsappSync
          ? "complete"
          : "warning",
      detail: !whatsappConnected
        ? "Connect WhatsApp before sync health can be tracked."
        : hasRecentWhatsappSync
          ? `Last sync ${whatsappSyncRelative ?? "recently"}.`
          : whatsappSyncRelative
            ? `Connected, but the last sync was ${whatsappSyncRelative}.`
            : "Connected, but no recent sync has been recorded yet.",
    },
    buildAutomationStatusCard({
      health: input.automationHealth,
      now: input.now,
    }),
  ];

  const goLiveCards: LaunchStatusCard[] = [
    {
      id: "invite_teammate",
      label: "Invite your first teammate",
      description: "Add at least one receptionist or manager into the shared workspace.",
      state: input.staffCount > 1 ? "complete" : "blocked",
      detail:
        input.staffCount > 1
          ? "The workspace has more than one active team member."
          : "Invite another teammate so the inbox can be shared in daily operations.",
    },
    {
      id: "capture_first_lead",
      label: "Capture your first lead",
      description: "Bring the first conversation into the CRM so the inbox and board become useful.",
      state: input.totalLeads > 0 ? "complete" : "blocked",
      detail:
        input.totalLeads > 0
          ? `${input.totalLeads} ${pluralize(input.totalLeads, "lead")} already tracked in the CRM.`
          : "Send a live WhatsApp message to the clinic number or add a lead manually.",
    },
    {
      id: "log_first_revenue",
      label: "Log first revenue",
      description: "Record the first attended visit so the owner can see ROI in the dashboard.",
      state: input.totalRevenue > 0 ? "complete" : "blocked",
      detail:
        input.totalRevenue > 0
          ? "Revenue has been logged from at least one attended visit."
          : "Mark an attended visit from the board and log the revenue there.",
    },
  ];

  const allCards = [...readinessCards, ...goLiveCards];
  const completedCount = allCards.filter((card) => card.state === "complete").length;
  const totalCount = allCards.length;

  const primaryAction = !input.canManage
    ? null
    : !paymentReceived
      ? { label: "Complete activation", href: "/activate" }
      : !whatsappConnected
        ? { label: "Connect WhatsApp", href: "/connect-whatsapp" }
        : input.staffCount <= 1
          ? { label: "Invite your first teammate", href: "/settings" }
          : input.totalLeads === 0
            ? { label: "Capture your first lead", href: "/inbox" }
            : input.totalRevenue <= 0
              ? { label: "Log first revenue", href: "/board" }
              : null;

  const summary = primaryAction
    ? `${completedCount} of ${totalCount} launch checks are complete. ${primaryAction.label} is the next step.`
    : `All ${totalCount} core launch checks are complete.`;

  return {
    groups: [
      {
        id: "workspace_readiness",
        title: "Workspace Readiness",
        cards: readinessCards,
      },
      {
        id: "go_live_checklist",
        title: "Go-Live Checklist",
        cards: goLiveCards,
      },
    ],
    primaryAction,
    canManage: input.canManage,
    readOnlyHint: input.canManage
      ? null
      : "Ask an admin to complete setup tasks or review workspace warnings.",
    completedCount,
    totalCount,
    summary,
  };
}

export default async function DashboardPage() {
  const { supabase, membership } = await requireMembership();
  const clinicId = membership.clinic_id;
  const canManageLaunchActions = canManageStaff(membership.role);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [
    { data: clinic },
    { data: contacts },
    { data: revenueData },
    { data: messages },
    { data: automationJobs },
    { count: staffCount },
    { data: avgResponseTimeRpc },
    automationHealth,
  ] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, payment_status, whatsapp_status, whatsapp_last_synced_at")
      .eq("id", clinicId)
      .single(),
    supabase
      .from("contacts")
      .select("id, full_name, current_status, bot_mode, unread_count, created_at, appointment_date")
      .eq("clinic_id", clinicId),
    supabase
      .from("revenue_logs")
      .select("contact_id, amount, created_at")
      .eq("clinic_id", clinicId),
    supabase
      .from("messages")
      .select("contact_id, direction, sender_type, created_at")
      .eq("clinic_id", clinicId),
    supabase
      .from("automation_jobs")
      .select("contact_id, status, scheduled_for")
      .eq("clinic_id", clinicId),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
    supabase.rpc("get_average_response_time", { p_clinic_id: clinicId }),
    getAutomationHealthSummary(supabase, clinicId, {
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      runnerSecretConfigured: hasAutomationRunnerProtection(),
      canManageAutomation: canManageLaunchActions,
    }),
  ]);

  const contactRows = contacts ?? [];
  const revenueRows = (revenueData ?? []).map((row) => ({
    contact_id: row.contact_id as string,
    amount: Number(row.amount),
    created_at: row.created_at as string,
  }));
  const messageRows = (messages ?? []).map((row) => ({
    contact_id: row.contact_id as string,
    direction: row.direction as "inbound" | "outbound",
    sender_type: row.sender_type as "lead" | "bot" | "human" | "system",
    created_at: row.created_at as string,
  }));
  const automationRows = (automationJobs ?? []).map((row) => ({
    contact_id: row.contact_id as string,
    status: row.status as string,
    scheduled_for: row.scheduled_for as string,
  }));

  const totalLeads = contactRows.length;
  const newLeads = contactRows.filter((contact) => contact.current_status === "new_lead").length;
  const booked = contactRows.filter((contact) => contact.current_status === "booked_appointment").length;
  const attended = contactRows.filter((contact) => contact.current_status === "attended_visit").length;
  const noShow = contactRows.filter((contact) => contact.current_status === "no_show").length;
  const noRespond = contactRows.filter((contact) => contact.current_status === "no_respond").length;
  const totalRevenue = revenueRows.reduce((sum, row) => sum + row.amount, 0);
  const botMessages = messageRows.filter((message) => message.sender_type === "bot").length;
  const humanMessages = messageRows.filter((message) => message.sender_type === "human").length;
  const avgResponseTime =
    typeof avgResponseTimeRpc === "number" && avgResponseTimeRpc > 0
      ? Number(avgResponseTimeRpc)
      : calculateAverageResponseTime(messageRows);
  const timeSavedHours = (botMessages * 2) / 60;
  const botHandledRate = calculateBotHandledRate(
    messageRows,
    contactRows.map((contact) => ({
      id: contact.id as string,
      full_name: contact.full_name as string,
      current_status: contact.current_status as string,
      bot_mode: contact.bot_mode as string | null,
      unread_count: contact.unread_count as number | null,
      created_at: contact.created_at as string,
    }))
  );
  const handoffCount = countHumanHandoffs(
    contactRows.map((contact) => ({
      id: contact.id as string,
      full_name: contact.full_name as string,
      current_status: contact.current_status as string,
      bot_mode: contact.bot_mode as string | null,
      unread_count: contact.unread_count as number | null,
      created_at: contact.created_at as string,
    }))
  );
  const unreadBacklog = contactRows.filter((contact) => Number(contact.unread_count ?? 0) > 0).length;
  const overdueFollowUps = automationRows.filter(
    (job) => job.status === "pending" && new Date(job.scheduled_for).getTime() <= now.getTime()
  ).length;
  const bookedMissingOutcome = contactRows.filter(
    (contact) =>
      contact.current_status === "booked_appointment" &&
      typeof contact.appointment_date === "string" &&
      contact.appointment_date <= today
  ).length;
  const attendedRevenueIds = new Set(revenueRows.map((row) => row.contact_id));
  const attendedMissingRevenue = contactRows.filter(
    (contact) =>
      contact.current_status === "attended_visit" &&
      !attendedRevenueIds.has(contact.id as string)
  ).length;

  const launchStatus = buildLaunchStatus({
    paymentStatus: (clinic?.payment_status as string | null) ?? null,
    whatsappStatus: (clinic?.whatsapp_status as string | null) ?? null,
    whatsappLastSyncedAt: (clinic?.whatsapp_last_synced_at as string | null) ?? null,
    staffCount: staffCount ?? 0,
    totalLeads,
    totalRevenue,
    canManage: canManageLaunchActions,
    automationHealth,
    now,
  });

  const closeoutPrompts = buildCloseoutPrompts({
    unreadBacklog,
    overdueFollowUps,
    bookedMissingOutcome,
    attendedMissingRevenue,
  });

  const weeklyDigest = buildWeeklyDigest({
    totalLeads,
    booked,
    attended,
    totalRevenue,
    avgResponseTime,
    overdueFollowUps,
    handoffCount,
  });

  return (
    <DashboardClient
      totalLeads={totalLeads}
      newLeads={newLeads}
      booked={booked}
      attended={attended}
      noShow={noShow}
      noRespond={noRespond}
      totalRevenue={totalRevenue}
      botMessages={botMessages}
      humanMessages={humanMessages}
      avgResponseTime={avgResponseTime}
      timeSavedHours={timeSavedHours}
      botHandledRate={botHandledRate}
      handoffCount={handoffCount}
      unreadBacklog={unreadBacklog}
      overdueFollowUps={overdueFollowUps}
      launchStatus={launchStatus}
      closeoutPrompts={closeoutPrompts}
      weeklyDigest={weeklyDigest}
    />
  );
}
