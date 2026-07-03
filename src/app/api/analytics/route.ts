import { NextResponse } from "next/server";

import { normalizeStatus } from "@/lib/frontdesk";
import { requireMembership } from "@/lib/server/auth";

interface ContactMetricRow {
  id: string;
  current_status?: string | null;
  unread_count?: number | null;
  appointment_date?: string | null;
  source?: string | null;
  treatment_category?: string | null;
  created_at?: string | null;
}

interface RevenueMetricRow {
  amount?: number | string | null;
  note?: string | null;
  contact_id?: string | null;
  created_at?: string | null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateDelta(current: number, previous: number) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function getMonthKey(iso: string) {
  return iso.slice(0, 7); // "YYYY-MM"
}

function summarize(input: {
  contacts: ContactMetricRow[];
  revenue: RevenueMetricRow[];
  start: Date;
  end: Date;
}) {
  const startMs = input.start.getTime();
  const endMs = input.end.getTime();
  const inRangeContacts = input.contacts.filter((contact) => {
    const createdAt = parseDate(contact.created_at ?? null)?.getTime();
    return typeof createdAt === "number" && createdAt >= startMs && createdAt <= endMs;
  });
  const today = new Date().toISOString().slice(0, 10);
  const funnel = {
    new_lead: 0,
    contacted: 0,
    appointment_set: 0,
    attended: 0,
    converted: 0,
  };
  const sourceCounts = new Map<string, number>();
  interface SourceFunnel {
    leads: number;
    booked: number;
    attended: number;
    revenue: number;
  }
  const sourceFunnel = new Map<string, SourceFunnel>();
  const BOOKED_STATUSES = new Set(["appointment_set", "attended", "converted"]);
  const ATTENDED_STATUSES = new Set(["attended", "converted"]);

  function getSourceFunnel(source: string) {
    let entry = sourceFunnel.get(source);
    if (!entry) {
      entry = { leads: 0, booked: 0, attended: 0, revenue: 0 };
      sourceFunnel.set(source, entry);
    }
    return entry;
  }

  for (const contact of input.contacts) {
    const status = normalizeStatus(contact.current_status);
    if (status in funnel) {
      funnel[status as keyof typeof funnel] += 1;
    }

    const contactCreatedAt = parseDate(contact.created_at ?? null)?.getTime();
    if (typeof contactCreatedAt === "number" && contactCreatedAt >= startMs && contactCreatedAt <= endMs) {
      const source = contact.source?.trim() || "Unknown";
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);

      const entry = getSourceFunnel(source);
      entry.leads += 1;
      if (BOOKED_STATUSES.has(status)) entry.booked += 1;
      if (ATTENDED_STATUSES.has(status)) entry.attended += 1;
    }
  }

  const inRangeRevenue = input.revenue.filter((row) => {
    const createdAt = parseDate(row.created_at ?? null)?.getTime();
    return typeof createdAt === "number" && createdAt >= startMs && createdAt <= endMs;
  });

  const totalLeads = inRangeContacts.length;
  const attendedCount = inRangeContacts.filter(
    (contact) => normalizeStatus(contact.current_status) === "attended"
  ).length;
  const revenueTotal = inRangeRevenue.reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0
  );

  // Revenue by treatment category
  const contactById = new Map(input.contacts.map((c) => [c.id, c]));
  const revenueByCat = new Map<string, number>();
  for (const row of inRangeRevenue) {
    const cat =
      (row.contact_id ? contactById.get(row.contact_id)?.treatment_category : null) ??
      "other";
    const label = cat || "other";
    revenueByCat.set(label, (revenueByCat.get(label) ?? 0) + Number(row.amount ?? 0));

    const source = row.contact_id
      ? contactById.get(row.contact_id)?.source?.trim() || "Unknown"
      : "Unknown";
    getSourceFunnel(source).revenue += Number(row.amount ?? 0);
  }

  // Revenue by month (last 6 months from today)
  const revenueByMonth = new Map<string, number>();
  for (const row of input.revenue) {
    if (!row.created_at) continue;
    const monthKey = getMonthKey(row.created_at);
    revenueByMonth.set(monthKey, (revenueByMonth.get(monthKey) ?? 0) + Number(row.amount ?? 0));
  }

  return {
    new_leads: totalLeads,
    unread_convos: input.contacts.filter((contact) => Number(contact.unread_count ?? 0) > 0).length,
    appointments_today: input.contacts.filter((contact) => contact.appointment_date === today).length,
    conversion_rate: totalLeads > 0 ? (attendedCount / totalLeads) * 100 : 0,
    revenue_total: revenueTotal,
    avg_revenue_per_patient:
      attendedCount > 0 ? revenueTotal / attendedCount : 0,
    funnel,
    by_source: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 8),
    source_breakdown: [...sourceFunnel.entries()]
      .map(([source, stats]) => ({ source, ...stats }))
      .sort((left, right) => right.leads - left.leads || right.revenue - left.revenue)
      .slice(0, 8),
    revenue_by_category: [...revenueByCat.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    revenue_by_month: [...revenueByMonth.entries()]
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6),
  };
}

export async function GET(req: Request) {
  const { supabase, membership } = await requireMembership();
  const params = new URL(req.url).searchParams;
  const requestedClinicId = params.get("clinic_id");

  if (requestedClinicId && requestedClinicId !== membership.clinic_id) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  const start = parseDate(params.get("start_date")) ?? new Date(new Date().setDate(1));
  const end = parseDate(params.get("end_date")) ?? new Date();
  const periodMs = Math.max(1, end.getTime() - start.getTime());
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - periodMs);

  const [{ data: contacts }, { data: revenue }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, current_status, unread_count, appointment_date, source, treatment_category, created_at")
      .eq("clinic_id", membership.clinic_id),
    supabase
      .from("revenue_logs")
      .select("amount, note, contact_id, created_at")
      .eq("clinic_id", membership.clinic_id),
  ]);

  const contactRows = (contacts ?? []) as ContactMetricRow[];
  const revenueRows = (revenue ?? []) as RevenueMetricRow[];
  const current = summarize({ contacts: contactRows, revenue: revenueRows, start, end });
  const previous = summarize({
    contacts: contactRows,
    revenue: revenueRows,
    start: previousStart,
    end: previousEnd,
  });

  return NextResponse.json({
    ...current,
    deltas: {
      new_leads: calculateDelta(current.new_leads, previous.new_leads),
      unread_convos: calculateDelta(current.unread_convos, previous.unread_convos),
      appointments_today: calculateDelta(
        current.appointments_today,
        previous.appointments_today
      ),
      conversion_rate: calculateDelta(current.conversion_rate, previous.conversion_rate),
      revenue_total: calculateDelta(current.revenue_total, previous.revenue_total),
      avg_revenue_per_patient: calculateDelta(
        current.avg_revenue_per_patient,
        previous.avg_revenue_per_patient
      ),
    },
  });
}
