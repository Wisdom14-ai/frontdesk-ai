import Link from "next/link";
import {
  Activity,
  Bot,
  Building2,
  CreditCard,
  DollarSign,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  calculateAverageResponseTime,
  calculateBotHandledRate,
  countHumanHandoffs,
} from "@/lib/metrics";
import {
  CLINIC_TYPE_LABELS,
  PLAN_DEFINITIONS,
  SUBSCRIPTION_STATUS_LABELS,
  getBillingCycleWindow,
  getPlanLimits,
} from "@/lib/plans";
import { requireAgencyAdmin } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(amount);

function getMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getPreviousMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

function getNextMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function inRange(dateValue: string | null | undefined, start: Date, end: Date) {
  if (!dateValue) {
    return false;
  }

  const time = new Date(dateValue).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function formatDelta(current: number, previous: number, suffix = "") {
  const diff = current - previous;
  const prefix = diff > 0 ? "+" : "";
  return `${prefix}${diff.toFixed(Number.isInteger(diff) ? 0 : 1)}${suffix}`;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; clinicType?: string }>;
}) {
  const auth = await requireAgencyAdmin();
  if (!auth.isAgencyAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold text-foreground">
            Super admin access required
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This dashboard is only available to internal operators listed in `agency_admins`.
          </p>
        </div>
      </div>
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold text-foreground">
            Service role required
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Configure `SUPABASE_SERVICE_ROLE_KEY` to unlock global reporting and clinic controls.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const statusFilter = params.status ?? "all";
  const clinicTypeFilter = params.clinicType ?? "all";
  const now = new Date();
  const currentMonthStart = getMonthStart(now);
  const currentMonthEnd = getNextMonthStart(now);
  const previousMonthStart = getPreviousMonthStart(now);
  const previousMonthEnd = currentMonthStart;

  const [
    { data: clinics, error: clinicsError },
    { data: contacts, error: contactsError },
    { data: messages, error: messagesError },
    { data: revenueLogs, error: revenueError },
  ] = await Promise.all([
    admin
      .from("clinics")
      .select(
        "id, name, clinic_type, plan_type, subscription_status, payment_status, payment_received_at, billing_cycle_anchor, whatsapp_status, whatsapp_connected_at, whatsapp_last_synced_at, onboarding_completed_at, owner_name, owner_phone, whatsapp_number, manual_monthly_cost_myr, contact_limit_override, monthly_message_limit_override, created_at, updated_at"
      )
      .order("created_at", { ascending: false }),
    admin
      .from("contacts")
      .select(
        "id, clinic_id, full_name, current_status, bot_mode, unread_count, appointment_date, created_at"
      ),
    admin
      .from("messages")
      .select("clinic_id, contact_id, direction, sender_type, created_at"),
    admin.from("revenue_logs").select("clinic_id, amount, created_at"),
  ]);

  const loadError =
    clinicsError?.message ??
    contactsError?.message ??
    messagesError?.message ??
    revenueError?.message;

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-8">
          <h1 className="text-2xl font-semibold text-foreground">
            Admin data failed to load
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The admin dashboard hit a database query error. Fix the missing schema field and refresh this page.
          </p>
          <p className="mt-4 rounded-xl border border-rose-500/20 bg-background/80 px-4 py-3 font-mono text-sm text-rose-700">
            {loadError}
          </p>
        </div>
      </div>
    );
  }

  const clinicRows = (clinics ?? []).filter((clinic) => {
    const matchesStatus =
      statusFilter === "all" ||
      (clinic.subscription_status as string) === statusFilter;
    const matchesClinicType =
      clinicTypeFilter === "all" ||
      (clinic.clinic_type as string) === clinicTypeFilter;
    return matchesStatus && matchesClinicType;
  });

  const filteredClinicIds = new Set(clinicRows.map((clinic) => clinic.id as string));
  const contactRows = (contacts ?? []).filter((contact) =>
    filteredClinicIds.has(contact.clinic_id as string)
  );
  const messageRows = (messages ?? []).filter((message) =>
    filteredClinicIds.has(message.clinic_id as string)
  );
  const revenueRows = (revenueLogs ?? []).filter((row) =>
    filteredClinicIds.has(row.clinic_id as string)
  );

  const contactsByClinic = new Map<string, typeof contactRows>();
  const messagesByClinic = new Map<string, typeof messageRows>();
  const revenueByClinic = new Map<string, typeof revenueRows>();

  for (const clinicId of filteredClinicIds) {
    contactsByClinic.set(
      clinicId,
      contactRows.filter((contact) => contact.clinic_id === clinicId)
    );
    messagesByClinic.set(
      clinicId,
      messageRows.filter((message) => message.clinic_id === clinicId)
    );
    revenueByClinic.set(
      clinicId,
      revenueRows.filter((row) => row.clinic_id === clinicId)
    );
  }

  const bookedEquivalentStatuses = new Set([
    "booked_appointment",
    "attended_visit",
    "no_show",
    "patient",
  ]);
  const attendedEquivalentStatuses = new Set(["attended_visit", "patient"]);

  const clinicMetrics = clinicRows.map((clinic) => {
    const clinicId = clinic.id as string;
    const clinicContacts = contactsByClinic.get(clinicId) ?? [];
    const clinicMessages = messagesByClinic.get(clinicId) ?? [];
    const clinicRevenue = revenueByClinic.get(clinicId) ?? [];
    const planType = (clinic.plan_type as "starter" | "pro") ?? "starter";
    const plan = PLAN_DEFINITIONS[planType];
    const planLimits = getPlanLimits(planType, {
      contactLimit: (clinic.contact_limit_override as number | null) ?? null,
      monthlyMessageLimit:
        (clinic.monthly_message_limit_override as number | null) ?? null,
    });
    const billingWindow = getBillingCycleWindow(
      (clinic.billing_cycle_anchor as string | null) ??
        (clinic.payment_received_at as string | null) ??
        (clinic.created_at as string | null)
    );
    const currentCycleOutboundMessages = clinicMessages.filter((message) => {
      if (message.direction !== "outbound") {
        return false;
      }
      if (!billingWindow.start || !billingWindow.end) {
        return true;
      }
      return inRange(
        message.created_at as string,
        billingWindow.start,
        billingWindow.end
      );
    }).length;
    const activeContacts = clinicContacts.filter(
      (contact) => (contact.current_status as string) !== "trash"
    ).length;
    const totalLeads = clinicContacts.length;
    const booked = clinicContacts.filter((contact) =>
      bookedEquivalentStatuses.has((contact.current_status as string) ?? "")
    ).length;
    const attended = clinicContacts.filter((contact) =>
      attendedEquivalentStatuses.has((contact.current_status as string) ?? "")
    ).length;
    const totalRevenue = clinicRevenue.reduce(
      (sum, row) => sum + Number(row.amount),
      0
    );
    const avgResponseTime = calculateAverageResponseTime(
      clinicMessages.map((message) => ({
        contact_id: message.contact_id as string,
        direction: message.direction as "inbound" | "outbound",
        sender_type: message.sender_type as "lead" | "bot" | "human" | "system",
        created_at: message.created_at as string,
      }))
    );
    const bookingRate = totalLeads > 0 ? (booked / totalLeads) * 100 : 0;
    const attendanceRate = booked > 0 ? (attended / booked) * 100 : 0;
    const manualMonthlyCost = Number(clinic.manual_monthly_cost_myr ?? 0);
    const projectedMrr =
      (clinic.subscription_status as string) === "active" &&
      (clinic.payment_status as string) === "received"
        ? plan.priceMyr
        : 0;
    const risks = [
      (clinic.whatsapp_status as string) !== "connected"
        ? "WhatsApp disconnected"
        : null,
      avgResponseTime > 30 ? "Slow response time" : null,
      totalLeads > 0 && bookingRate < 5 ? "Low booking rate" : null,
    ].filter(Boolean) as string[];

    return {
      id: clinicId,
      name: clinic.name as string,
      clinicType: clinic.clinic_type as keyof typeof CLINIC_TYPE_LABELS,
      planType,
      subscriptionStatus:
        clinic.subscription_status as keyof typeof SUBSCRIPTION_STATUS_LABELS,
      paymentStatus: clinic.payment_status as string,
      whatsappStatus: clinic.whatsapp_status as string,
      whatsappNumber: (clinic.whatsapp_number as string | null) ?? "",
      ownerName: (clinic.owner_name as string | null) ?? null,
      totalLeads,
      booked,
      attended,
      totalRevenue,
      avgResponseTime,
      bookingRate,
      attendanceRate,
      activeContacts,
      contactLimit: planLimits.contactLimit,
      currentCycleOutboundMessages,
      monthlyMessageLimit: planLimits.monthlyMessageLimit,
      projectedMrr,
      manualMonthlyCost,
      projectedProfit: projectedMrr - manualMonthlyCost,
      unreadBacklog: clinicContacts.filter(
        (contact) => Number(contact.unread_count ?? 0) > 0
      ).length,
      botHandledRate: calculateBotHandledRate(
        clinicMessages.map((message) => ({
          contact_id: message.contact_id as string,
          direction: message.direction as "inbound" | "outbound",
          sender_type: message.sender_type as "lead" | "bot" | "human" | "system",
          created_at: message.created_at as string,
        })),
        clinicContacts.map((contact) => ({
          id: contact.id as string,
          full_name: (contact.full_name as string) ?? "",
          current_status: (contact.current_status as string) ?? "",
          bot_mode: (contact.bot_mode as string | null) ?? null,
          unread_count: (contact.unread_count as number | null) ?? null,
          created_at: contact.created_at as string,
        }))
      ),
      handoffCount: countHumanHandoffs(
        clinicContacts.map((contact) => ({
          id: contact.id as string,
          full_name: (contact.full_name as string) ?? "",
          current_status: (contact.current_status as string) ?? "",
          bot_mode: (contact.bot_mode as string | null) ?? null,
          unread_count: (contact.unread_count as number | null) ?? null,
          created_at: contact.created_at as string,
        }))
      ),
      onboarded: Boolean(clinic.onboarding_completed_at),
      onboardingCompletedAt: (clinic.onboarding_completed_at as string | null) ?? null,
      createdAt: clinic.created_at as string,
      risks,
    };
  });

  const totalClinics = clinicMetrics.length;
  const onboardedClinics = clinicMetrics.filter((clinic) => clinic.onboarded).length;
  const activeClinics = clinicMetrics.filter(
    (clinic) => clinic.subscriptionStatus === "active"
  ).length;
  const totalLeads = contactRows.length;
  const totalBooked = clinicMetrics.reduce((sum, clinic) => sum + clinic.booked, 0);
  const totalAttended = clinicMetrics.reduce((sum, clinic) => sum + clinic.attended, 0);
  const totalRevenue = clinicMetrics.reduce((sum, clinic) => sum + clinic.totalRevenue, 0);
  const totalProjectedMrr = clinicMetrics.reduce((sum, clinic) => sum + clinic.projectedMrr, 0);
  const totalManualCost = clinicMetrics.reduce(
    (sum, clinic) => sum + clinic.manualMonthlyCost,
    0
  );
  const averageResponseTime =
    clinicMetrics.length > 0
      ? clinicMetrics.reduce((sum, clinic) => sum + clinic.avgResponseTime, 0) /
        clinicMetrics.length
      : 0;
  const averageBookingRate =
    clinicMetrics.length > 0
      ? clinicMetrics.reduce((sum, clinic) => sum + clinic.bookingRate, 0) /
        clinicMetrics.length
      : 0;

  const currentMonthOnboarded = clinicMetrics.filter((clinic) =>
    inRange(clinic.onboardingCompletedAt, currentMonthStart, currentMonthEnd)
  ).length;
  const previousMonthOnboarded = clinicMetrics.filter((clinic) =>
    inRange(clinic.onboardingCompletedAt, previousMonthStart, previousMonthEnd)
  ).length;
  const currentMonthLeads = contactRows.filter((contact) =>
    inRange(contact.created_at as string, currentMonthStart, currentMonthEnd)
  ).length;
  const previousMonthLeads = contactRows.filter((contact) =>
    inRange(contact.created_at as string, previousMonthStart, previousMonthEnd)
  ).length;
  const currentMonthRevenue = revenueRows
    .filter((row) => inRange(row.created_at as string, currentMonthStart, currentMonthEnd))
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const previousMonthRevenue = revenueRows
    .filter((row) => inRange(row.created_at as string, previousMonthStart, previousMonthEnd))
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const currentMonthBookings = contactRows.filter((contact) =>
    typeof contact.appointment_date === "string" &&
    inRange(
      `${contact.appointment_date}T00:00:00.000Z`,
      currentMonthStart,
      currentMonthEnd
    )
  ).length;
  const previousMonthBookings = contactRows.filter((contact) =>
    typeof contact.appointment_date === "string" &&
    inRange(
      `${contact.appointment_date}T00:00:00.000Z`,
      previousMonthStart,
      previousMonthEnd
    )
  ).length;

  const businessStats = [
    {
      label: "Projected MRR",
      value: formatCurrency(totalProjectedMrr),
      delta: `${formatCurrency(totalProjectedMrr - totalManualCost)} projected profit`,
      icon: CreditCard,
    },
    {
      label: "Onboarded Clinics",
      value: onboardedClinics,
      delta: `${formatDelta(currentMonthOnboarded, previousMonthOnboarded)} vs last month`,
      icon: Building2,
    },
    {
      label: "Global Leads",
      value: totalLeads,
      delta: `${formatDelta(currentMonthLeads, previousMonthLeads)} this month`,
      icon: Users,
    },
    {
      label: "Tracked Revenue",
      value: formatCurrency(totalRevenue),
      delta: `${formatCurrency(currentMonthRevenue - previousMonthRevenue)} MoM`,
      icon: DollarSign,
    },
  ];

  const operationalStats = [
    {
      label: "Active Clinics",
      value: activeClinics,
      sublabel: `${clinicMetrics.filter((clinic) => clinic.subscriptionStatus === "paused").length} paused`,
    },
    {
      label: "Booking Rate",
      value: `${(totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0).toFixed(1)}%`,
      sublabel: `${formatDelta(currentMonthBookings, previousMonthBookings)} booked visits this month`,
    },
    {
      label: "Attendance Rate",
      value: `${(totalBooked > 0 ? (totalAttended / totalBooked) * 100 : 0).toFixed(1)}%`,
      sublabel: `${totalAttended} attended visits`,
    },
    {
      label: "Avg Response",
      value: `${averageResponseTime.toFixed(1)}m`,
      sublabel: `${averageBookingRate.toFixed(1)}% avg booking rate`,
    },
  ];

  const planMix = Object.entries(PLAN_DEFINITIONS).map(([planType, plan]) => ({
    planType,
    label: plan.label,
    count: clinicMetrics.filter((clinic) => clinic.planType === planType).length,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Super Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Internal overview of onboarding, clinic health, subscription performance, and profit signals.
          </p>
        </div>

        <form className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/40 bg-card p-3 shadow-sm">
          <select
            name="status"
            defaultValue={statusFilter}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="all">All subscription statuses</option>
            {Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="clinicType"
            defaultValue={clinicTypeFilter}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="all">All clinic types</option>
            {Object.entries(CLINIC_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-500 px-4 text-sm font-medium text-white">
            Apply
          </button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {businessStats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <stat.icon className="h-5 w-5" />
            </div>
            <p className="text-3xl font-semibold text-foreground">{stat.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            <p className="mt-3 text-xs font-medium text-emerald-700">{stat.delta}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-violet-500" />
            <h2 className="text-lg font-semibold text-foreground">Operational Snapshot</h2>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {operationalStats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border/60 p-4">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{stat.value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{stat.sublabel}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-foreground">Risk Queue</h2>
          </div>
          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">WhatsApp disconnected</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {clinicMetrics.filter((clinic) => clinic.whatsappStatus !== "connected").length}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Slow response time</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {clinicMetrics.filter((clinic) => clinic.avgResponseTime > 30).length}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Low booking rate</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {clinicMetrics.filter((clinic) => clinic.totalLeads > 0 && clinic.bookingRate < 5).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-sky-500" />
            <h2 className="text-lg font-semibold text-foreground">AI And Team Metrics</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Bot-handled rate</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {calculateBotHandledRate(
                  messageRows.map((message) => ({
                    contact_id: message.contact_id as string,
                    direction: message.direction as "inbound" | "outbound",
                    sender_type: message.sender_type as "lead" | "bot" | "human" | "system",
                    created_at: message.created_at as string,
                  })),
                  contactRows.map((contact) => ({
                    id: contact.id as string,
                    full_name: (contact.full_name as string) ?? "",
                    current_status: (contact.current_status as string) ?? "",
                    bot_mode: (contact.bot_mode as string | null) ?? null,
                    unread_count: (contact.unread_count as number | null) ?? null,
                    created_at: contact.created_at as string,
                  }))
                ).toFixed(1)}
                %
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Human handoffs</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {countHumanHandoffs(
                  contactRows.map((contact) => ({
                    id: contact.id as string,
                    full_name: (contact.full_name as string) ?? "",
                    current_status: (contact.current_status as string) ?? "",
                    bot_mode: (contact.bot_mode as string | null) ?? null,
                    unread_count: (contact.unread_count as number | null) ?? null,
                    created_at: contact.created_at as string,
                  }))
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Manual monthly cost</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {formatCurrency(totalManualCost)}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Projected profit</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {formatCurrency(totalProjectedMrr - totalManualCost)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-foreground">Plan Mix</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {planMix.map((plan) => (
              <div key={plan.planType} className="rounded-xl border border-border/60 p-4">
                <p className="text-sm text-muted-foreground">{plan.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{plan.count}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {clinicMetrics.filter(
                    (clinic) =>
                      clinic.planType === plan.planType &&
                      clinic.subscriptionStatus === "active" &&
                      clinic.paymentStatus === "received"
                  ).length}{" "}
                  active and paying
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Clinic Health View</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {totalClinics} clinics matching the current filters
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-6 py-4 font-medium text-muted-foreground">Clinic</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Plan</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Subscription</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Leads</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Booking Rate</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Response</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Usage</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Revenue</th>
                <th className="px-6 py-4 font-medium text-muted-foreground">Risks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clinicMetrics.map((clinic) => (
                <tr key={clinic.id} className="transition-colors hover:bg-muted/20">
                  <td className="px-6 py-4">
                    <Link
                      href={`/admin/clinics/${clinic.id}`}
                      className="font-medium text-foreground hover:text-emerald-600"
                    >
                      {clinic.name}
                    </Link>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {CLINIC_TYPE_LABELS[clinic.clinicType]} • {clinic.ownerName || "No owner name"}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-foreground">
                      {PLAN_DEFINITIONS[clinic.planType].label}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      MRR {formatCurrency(clinic.projectedMrr)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-foreground">
                      {SUBSCRIPTION_STATUS_LABELS[clinic.subscriptionStatus]}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      WhatsApp {clinic.whatsappStatus.replace("_", " ")}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-foreground">{clinic.totalLeads}</td>
                  <td className="px-6 py-4 text-foreground">
                    {clinic.bookingRate.toFixed(1)}%
                  </td>
                  <td className="px-6 py-4 text-foreground">
                    {clinic.avgResponseTime.toFixed(1)}m
                  </td>
                  <td className="px-6 py-4 text-foreground">
                    <div>
                      Contacts {clinic.activeContacts}/{clinic.contactLimit}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Msgs {clinic.currentCycleOutboundMessages}/{clinic.monthlyMessageLimit}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-foreground">
                    {formatCurrency(clinic.totalRevenue)}
                  </td>
                  <td className="px-6 py-4">
                    {clinic.risks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {clinic.risks.map((risk) => (
                          <span
                            key={risk}
                            className="inline-flex rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-800"
                          >
                            {risk}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        Healthy
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
