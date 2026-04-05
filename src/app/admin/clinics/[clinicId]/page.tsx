import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Building2,
  DollarSign,
  MessageSquare,
  ShieldAlert,
  Users,
} from "lucide-react";

import { AdminLeadMemoryControlCard } from "@/components/admin/AdminLeadMemoryControlCard";
import { AutomationControlCenter } from "@/components/settings/AutomationControlCenter";
import { AdminWhatsappConnectionCard } from "@/components/whatsapp/AdminWhatsappConnectionCard";
import {
  calculateAverageResponseTime,
  calculateBotHandledRate,
  countHumanHandoffs,
} from "@/lib/metrics";
import {
  CLINIC_TYPE_LABELS,
  PLAN_DEFINITIONS,
  SUBSCRIPTION_STATUS_LABELS,
  WHATSAPP_STATUS_LABELS,
} from "@/lib/plans";
import { CLINIC_BASE_SELECT, getClinicUsageSummary } from "@/lib/server/clinic";
import { requireAgencyAdmin } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  updateClinicCommercial,
  updateClinicProfile,
  updateClinicPrompt,
} from "./actions";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(amount);

function toDateInputValue(value?: string | null) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

export default async function SuperAdminClinicDetailPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const auth = await requireAgencyAdmin();
  if (!auth.isAgencyAdmin) {
    notFound();
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
            Configure `SUPABASE_SERVICE_ROLE_KEY` to manage clinics from Super Admin.
          </p>
        </div>
      </div>
    );
  }

  const { clinicId } = await params;

  const [
    { data: clinicData },
    { data: contacts },
    { data: messages },
    { data: revenueLogs },
    { count: staffCount },
  ] = await Promise.all([
    admin.from("clinics").select(CLINIC_BASE_SELECT).eq("id", clinicId).single(),
    admin
      .from("contacts")
      .select("id, full_name, current_status, bot_mode, unread_count, created_at")
      .eq("clinic_id", clinicId),
    admin
      .from("messages")
      .select("contact_id, direction, sender_type, created_at")
      .eq("clinic_id", clinicId),
    admin
      .from("revenue_logs")
      .select("amount, created_at")
      .eq("clinic_id", clinicId),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId),
  ]);

  if (!clinicData) {
    notFound();
  }

  const clinic = clinicData as unknown as Record<string, unknown>;

  const usage = await getClinicUsageSummary(admin, {
    id: clinic.id as string,
    plan_type: ((clinic.plan_type as "starter" | "pro") ?? "starter"),
    payment_received_at: (clinic.payment_received_at as string | null) ?? null,
    billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
    created_at: (clinic.created_at as string | null) ?? null,
    contact_limit_override: (clinic.contact_limit_override as number | null) ?? null,
    monthly_message_limit_override:
      (clinic.monthly_message_limit_override as number | null) ?? null,
  });

  const contactRows = contacts ?? [];
  const messageRows = (messages ?? []).map((row) => ({
    contact_id: row.contact_id as string,
    direction: row.direction as "inbound" | "outbound",
    sender_type: row.sender_type as "lead" | "bot" | "human" | "system",
    created_at: row.created_at as string,
  }));
  const revenueRows = (revenueLogs ?? []).map((row) => ({
    amount: Number(row.amount),
    created_at: row.created_at as string,
  }));

  const bookedEquivalentStatuses = new Set([
    "booked_appointment",
    "attended_visit",
    "no_show",
    "patient",
  ]);
  const attendedEquivalentStatuses = new Set(["attended_visit", "patient"]);
  const totalLeads = contactRows.length;
  const booked = contactRows.filter((contact) =>
    bookedEquivalentStatuses.has((contact.current_status as string) ?? "")
  ).length;
  const attended = contactRows.filter((contact) =>
    attendedEquivalentStatuses.has((contact.current_status as string) ?? "")
  ).length;
  const unreadBacklog = contactRows.filter(
    (contact) => Number(contact.unread_count ?? 0) > 0
  ).length;
  const totalRevenue = revenueRows.reduce((sum, row) => sum + row.amount, 0);
  const avgResponseTime = calculateAverageResponseTime(messageRows);
  const botHandledRate = calculateBotHandledRate(
    messageRows,
    contactRows.map((contact) => ({
      id: contact.id as string,
      full_name: (contact.full_name as string) ?? "",
      current_status: (contact.current_status as string) ?? "",
      bot_mode: (contact.bot_mode as string | null) ?? null,
      unread_count: (contact.unread_count as number | null) ?? null,
      created_at: contact.created_at as string,
    }))
  );
  const handoffCount = countHumanHandoffs(
    contactRows.map((contact) => ({
      id: contact.id as string,
      full_name: (contact.full_name as string) ?? "",
      current_status: (contact.current_status as string) ?? "",
      bot_mode: (contact.bot_mode as string | null) ?? null,
      unread_count: (contact.unread_count as number | null) ?? null,
      created_at: contact.created_at as string,
    }))
  );
  const bookingRate = totalLeads > 0 ? (booked / totalLeads) * 100 : 0;
  const attendanceRate = booked > 0 ? (attended / booked) * 100 : 0;
  const plan = PLAN_DEFINITIONS[(clinic.plan_type as "starter" | "pro") ?? "starter"];
  const manualCost = Number(clinic.manual_monthly_cost_myr ?? 0);
  const projectedMrr =
    (clinic.subscription_status as string) === "active" &&
    (clinic.payment_status as string) === "received"
      ? plan.priceMyr
      : 0;
  const projectedProfit = projectedMrr - manualCost;
  const risks = [
    (clinic.whatsapp_status as string) !== "connected"
      ? "WhatsApp disconnected"
      : null,
    avgResponseTime > 30 ? "Average response time above 30 minutes" : null,
    totalLeads > 0 && bookingRate < 5 ? "Booking rate below 5%" : null,
  ].filter(Boolean) as string[];

  const profileAction = updateClinicProfile.bind(null, clinicId);
  const commercialAction = updateClinicCommercial.bind(null, clinicId);
  const promptAction = updateClinicPrompt.bind(null, clinicId);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Super Admin
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-foreground">
            {clinic.name as string}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {CLINIC_TYPE_LABELS[(clinic.clinic_type as keyof typeof CLINIC_TYPE_LABELS) ?? "dental"]} clinic
            {" • "}
            {plan.label} plan
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
            {SUBSCRIPTION_STATUS_LABELS[(clinic.subscription_status as keyof typeof SUBSCRIPTION_STATUS_LABELS) ?? "active"]}
          </span>
          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
            {WHATSAPP_STATUS_LABELS[(clinic.whatsapp_status as keyof typeof WHATSAPP_STATUS_LABELS) ?? "not_connected"]}
          </span>
          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
            Payment {(clinic.payment_status as string) === "received" ? "received" : "pending"}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "Leads", value: totalLeads, icon: Users },
          { label: "Booking Rate", value: `${bookingRate.toFixed(1)}%`, icon: Building2 },
          { label: "Attendance Rate", value: `${attendanceRate.toFixed(1)}%`, icon: ShieldAlert },
          { label: "Revenue", value: formatCurrency(totalRevenue), icon: DollarSign },
          { label: "Avg Response", value: `${avgResponseTime.toFixed(1)}m`, icon: MessageSquare },
          { label: "Bot Handled", value: `${botHandledRate.toFixed(1)}%`, icon: Bot },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <item.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-semibold text-foreground">{item.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Risk Flags</h2>
          <div className="mt-4 space-y-3">
            {risks.length > 0 ? (
              risks.map((risk) => (
                <div
                  key={risk}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800"
                >
                  {risk}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                No risk rules are currently triggered.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Commercial Snapshot</h2>
          <div className="mt-4 grid gap-3">
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Projected MRR</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {formatCurrency(projectedMrr)}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Manual monthly cost</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {formatCurrency(manualCost)}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Projected profit</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {formatCurrency(projectedProfit)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <form action={profileAction} className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Clinic Profile</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Clinic Name</label>
              <input
                name="name"
                defaultValue={(clinic.name as string) ?? ""}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Clinic Type</label>
              <select
                name="clinic_type"
                defaultValue={(clinic.clinic_type as string) ?? "dental"}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              >
                {Object.entries(CLINIC_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Owner Name</label>
              <input
                name="owner_name"
                defaultValue={(clinic.owner_name as string | null) ?? ""}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Owner Phone</label>
              <input
                name="owner_phone"
                defaultValue={(clinic.owner_phone as string | null) ?? ""}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
          </div>
          <button className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-emerald-500 px-5 text-sm font-medium text-white">
            Save Profile
          </button>
        </form>

        <form action={commercialAction} className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Subscription And Billing</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Plan</label>
              <select
                name="plan_type"
                defaultValue={(clinic.plan_type as string) ?? "starter"}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              >
                {Object.entries(PLAN_DEFINITIONS).map(([value, plan]) => (
                  <option key={value} value={value}>
                    {plan.label} - RM {plan.priceMyr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Subscription Status</label>
              <select
                name="subscription_status"
                defaultValue={(clinic.subscription_status as string) ?? "active"}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              >
                {Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Payment Status</label>
              <select
                name="payment_status"
                defaultValue={(clinic.payment_status as string) ?? "pending"}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="received">Received</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Payment Received Date</label>
              <input
                type="date"
                name="payment_received_at"
                defaultValue={toDateInputValue(clinic.payment_received_at as string | null)}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Billing Cycle Anchor</label>
              <input
                type="date"
                name="billing_cycle_anchor"
                defaultValue={toDateInputValue(clinic.billing_cycle_anchor as string | null)}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Manual Monthly Cost (MYR)</label>
              <input
                type="number"
                step="0.01"
                name="manual_monthly_cost_myr"
                defaultValue={clinic.manual_monthly_cost_myr ? String(clinic.manual_monthly_cost_myr) : ""}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Contact Limit Override</label>
              <input
                type="number"
                name="contact_limit_override"
                defaultValue={clinic.contact_limit_override ? String(clinic.contact_limit_override) : ""}
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Message Limit Override</label>
              <input
                type="number"
                name="monthly_message_limit_override"
                defaultValue={
                  clinic.monthly_message_limit_override
                    ? String(clinic.monthly_message_limit_override)
                    : ""
                }
                className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-foreground">Internal Notes</label>
              <textarea
                name="internal_notes"
                defaultValue={(clinic.internal_notes as string | null) ?? ""}
                rows={4}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm"
              />
            </div>
          </div>
          <button className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-indigo-500 px-5 text-sm font-medium text-white">
            Save Commercial Settings
          </button>
        </form>
      </div>

      <AdminWhatsappConnectionCard clinicId={clinicId} />

      <AdminLeadMemoryControlCard clinicId={clinicId} />

      <AutomationControlCenter
        apiBasePath={`/api/admin/clinics/${clinicId}/automation`}
        runNowPath={`/api/admin/clinics/${clinicId}/automation/run-now`}
        title="Super Admin Automation Control Center"
        description="Configure follow-up timing, templates, runner health, and manual execution for this clinic centrally."
      />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <form action={promptAction} className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Clinic AI Prompt</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Super Admin can override the clinic-level prompt used by staff-facing AI controls.
          </p>
          <textarea
            name="clinic_prompt"
            rows={10}
            defaultValue={(clinic.clinic_prompt as string | null) ?? ""}
            className="mt-5 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm"
          />
          <button className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-sky-500 px-5 text-sm font-medium text-white">
            Save Prompt
          </button>
        </form>

        <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Operational Snapshot</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Staff seats</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{staffCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Unread backlog</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{unreadBacklog}</p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Contact usage</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {usage.active_contacts} / {usage.contact_limit}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Monthly sent messages</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {usage.monthly_outbound_messages} / {usage.monthly_message_limit}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Human handoffs</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{handoffCount}</p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-sm text-muted-foreground">Onboarded at</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {(clinic.onboarding_completed_at as string | null)
                  ? new Date(clinic.onboarding_completed_at as string).toLocaleString("en-MY")
                  : "Not onboarded yet"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
