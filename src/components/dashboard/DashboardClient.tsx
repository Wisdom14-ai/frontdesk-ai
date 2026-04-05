"use client";

import Link from "next/link";
import {
  Users,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  MessageSquareOff,
  DollarSign,
  TrendingUp,
  Activity,
  Bot,
  User,
  ClipboardCheck,
  BellRing,
  ShieldAlert,
  ArrowRight,
  Lock,
} from "lucide-react";

import type {
  LaunchStatus,
  LaunchStatusCardState,
  PromptCard,
  WeeklyDigest,
} from "@/types";

interface DashboardProps {
  totalLeads: number;
  newLeads: number;
  booked: number;
  attended: number;
  noShow: number;
  noRespond: number;
  totalRevenue: number;
  botMessages: number;
  humanMessages: number;
  avgResponseTime: number;
  timeSavedHours: number;
  botHandledRate: number;
  handoffCount: number;
  unreadBacklog: number;
  overdueFollowUps: number;
  launchStatus: LaunchStatus;
  closeoutPrompts: PromptCard[];
  weeklyDigest: WeeklyDigest;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(amount);

const launchStateMeta: Record<
  LaunchStatusCardState,
  {
    label: string;
    container: string;
    badge: string;
    icon: typeof CheckCircle2;
    iconClass: string;
  }
> = {
  complete: {
    label: "Complete",
    container: "border-emerald-200/70 bg-emerald-500/5",
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
    icon: CheckCircle2,
    iconClass: "text-emerald-600",
  },
  warning: {
    label: "Needs attention",
    container: "border-amber-200/70 bg-amber-500/5",
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-700",
    icon: ShieldAlert,
    iconClass: "text-amber-600",
  },
  blocked: {
    label: "Blocked",
    container: "border-slate-300/70 bg-slate-500/5",
    badge: "border-slate-400/20 bg-slate-500/10 text-slate-700",
    icon: Lock,
    iconClass: "text-slate-600",
  },
  unavailable: {
    label: "Unavailable",
    container: "border-sky-200/70 bg-sky-500/5",
    badge: "border-sky-500/20 bg-sky-500/10 text-sky-700",
    icon: Activity,
    iconClass: "text-sky-600",
  },
};

export function DashboardClient({
  totalLeads,
  newLeads,
  booked,
  attended,
  noShow,
  noRespond,
  totalRevenue,
  botMessages,
  humanMessages,
  avgResponseTime,
  timeSavedHours,
  botHandledRate,
  handoffCount,
  unreadBacklog,
  overdueFollowUps,
  launchStatus,
  closeoutPrompts,
  weeklyDigest,
}: DashboardProps) {
  const bookingRate = totalLeads > 0 ? ((booked + attended) / totalLeads * 100).toFixed(1) : "0";
  const attendanceRate = (booked + attended) > 0 ? (attended / (booked + attended) * 100).toFixed(1) : "0";

  const stats = [
    { label: "Total Leads", value: totalLeads, icon: Users, color: "from-blue-500 to-blue-600" },
    { label: "New Leads", value: newLeads, icon: Activity, color: "from-emerald-500 to-emerald-600" },
    { label: "Booked", value: booked, icon: CalendarCheck, color: "from-violet-500 to-violet-600" },
    { label: "Attended", value: attended, icon: CheckCircle2, color: "from-teal-500 to-teal-600" },
    { label: "No Show", value: noShow, icon: XCircle, color: "from-amber-500 to-amber-600" },
    { label: "No Response", value: noRespond, icon: MessageSquareOff, color: "from-rose-500 to-rose-600" },
    { label: "Bot Messages", value: botMessages, icon: Bot, color: "from-indigo-500 to-indigo-600" },
    { label: "Human Messages", value: humanMessages, icon: User, color: "from-slate-500 to-slate-600" },
    { label: "Avg Response time", value: `${avgResponseTime.toFixed(1)}m`, icon: Activity, color: "from-blue-500 to-indigo-500" },
    { label: "Time Saved (est)", value: `${timeSavedHours.toFixed(1)}h`, icon: TrendingUp, color: "from-amber-500 to-orange-500" },
    { label: "Bot-handled Rate", value: `${botHandledRate.toFixed(1)}%`, icon: Bot, color: "from-fuchsia-500 to-pink-500" },
    { label: "Human Handoffs", value: handoffCount, icon: ShieldAlert, color: "from-rose-500 to-red-500" },
    { label: "Unread Backlog", value: unreadBacklog, icon: BellRing, color: "from-sky-500 to-blue-500" },
    { label: "Overdue Follow-ups", value: overdueFollowUps, icon: ClipboardCheck, color: "from-orange-500 to-amber-500" },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 pb-6 pt-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your clinic&apos;s WhatsApp lead conversion pipeline
        </p>
      </div>

      <div className="space-y-6 px-8 pb-8">
        <section className="overflow-hidden rounded-[2rem] border border-border/50 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.92),_rgba(240,253,250,0.86))] p-6 shadow-xl shadow-emerald-900/5 md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                <ClipboardCheck className="h-3.5 w-3.5" />
                Launch Status
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-foreground">
                Get the clinic live without leaving the dashboard
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {launchStatus.summary}
              </p>
            </div>

            <div className="min-w-[220px] rounded-2xl border border-border/50 bg-white/80 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Progress
              </p>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-4xl font-semibold text-foreground">
                  {launchStatus.completedCount}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">
                  / {launchStatus.totalCount} checks complete
                </span>
              </div>

              {launchStatus.canManage ? (
                launchStatus.primaryAction ? (
                  <Link
                    href={launchStatus.primaryAction.href}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
                  >
                    {launchStatus.primaryAction.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700">
                    Core launch steps are complete.
                  </div>
                )
              ) : launchStatus.readOnlyHint ? (
                <div className="mt-5 rounded-xl border border-border/60 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                  {launchStatus.readOnlyHint}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-5 xl:grid-cols-2">
            {launchStatus.groups.map((group) => (
              <div key={group.id} className="rounded-[1.5rem] border border-border/50 bg-white/80 p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                    {group.id === "workspace_readiness" ? (
                      <Activity className="h-4 w-4" />
                    ) : (
                      <Users className="h-4 w-4" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{group.title}</h3>
                </div>

                <div className="space-y-3">
                  {group.cards.map((card) => {
                    const stateMeta = launchStateMeta[card.state];
                    const StateIcon = stateMeta.icon;

                    return (
                      <div
                        key={card.id}
                        className={`rounded-2xl border p-4 transition-colors ${stateMeta.container}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-full bg-white/80 p-1.5 shadow-sm">
                              <StateIcon className={`h-4 w-4 ${stateMeta.iconClass}`} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-foreground">{card.label}</p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {card.description}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stateMeta.badge}`}
                          >
                            {stateMeta.label}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-foreground/80">{card.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="col-span-1 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 p-6 text-white shadow-lg shadow-emerald-500/20 md:col-span-1">
            <div className="mb-3 flex items-center gap-2">
              <DollarSign className="h-5 w-5 opacity-80" />
              <span className="text-sm font-medium opacity-80">Total Revenue</span>
            </div>
            <p className="text-3xl font-bold">{formatCurrency(totalRevenue)}</p>
            <p className="mt-1 text-sm opacity-70">from attended visits</p>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-violet-500" />
              <span className="text-sm font-medium text-muted-foreground">Booking Rate</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{bookingRate}%</p>
            <p className="mt-1 text-sm text-muted-foreground">leads -&gt; booked</p>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-teal-500" />
              <span className="text-sm font-medium text-muted-foreground">Attendance Rate</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{attendanceRate}%</p>
            <p className="mt-1 text-sm text-muted-foreground">booked -&gt; attended</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border/40 bg-card p-4 transition-colors hover:border-border/70"
            >
              <div className="mb-3 flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${stat.color}`}>
                  <stat.icon className="h-4 w-4 text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <BellRing className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-foreground">Daily Closeout</h2>
          </div>
          <div className="space-y-3">
            {closeoutPrompts.map((prompt) => (
              <div key={prompt.id} className="rounded-xl border border-border/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{prompt.label}</p>
                  <span className="text-sm font-semibold text-foreground">{prompt.count}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{prompt.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-violet-500" />
            <h2 className="text-lg font-semibold text-foreground">Weekly Digest</h2>
          </div>
          <p className="text-lg font-semibold text-foreground">{weeklyDigest.headline}</p>
          <p className="mt-2 text-sm text-muted-foreground">{weeklyDigest.summary}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {weeklyDigest.flags.map((flag) => (
              <div
                key={flag}
                className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-sm text-foreground"
              >
                {flag}
              </div>
            ))}
          </div>
        </div>

        {totalLeads === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
              <Users className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">No leads yet</h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Once you connect your WhatsApp number, incoming messages will automatically create leads here.
              You can also add leads manually from the Pipeline board.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
