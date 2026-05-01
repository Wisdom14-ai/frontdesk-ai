import { NextResponse } from "next/server";

import { normalizeStatus } from "@/lib/frontdesk";
import { requireMembership } from "@/lib/server/auth";

interface ContactMetricRow {
  id: string;
  current_status?: string | null;
  unread_count?: number | null;
  appointment_date?: string | null;
  source?: string | null;
  created_at?: string | null;
}

interface RevenueMetricRow {
  amount?: number | string | null;
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

  for (const contact of input.contacts) {
    const status = normalizeStatus(contact.current_status);
    if (status in funnel) {
      funnel[status as keyof typeof funnel] += 1;
    }

    const contactCreatedAt = parseDate(contact.created_at ?? null)?.getTime();
    if (typeof contactCreatedAt === "number" && contactCreatedAt >= startMs && contactCreatedAt <= endMs) {
      const source = contact.source?.trim() || "Unknown";
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }

  const totalLeads = inRangeContacts.length;
  const attendedCount = inRangeContacts.filter(
    (contact) => normalizeStatus(contact.current_status) === "attended"
  ).length;
  const revenueTotal = input.revenue.reduce((sum, row) => {
    const createdAt = parseDate(row.created_at ?? null)?.getTime();
    if (typeof createdAt !== "number" || createdAt < startMs || createdAt > endMs) {
      return sum;
    }
    return sum + Number(row.amount ?? 0);
  }, 0);

  return {
    new_leads: totalLeads,
    unread_convos: input.contacts.filter((contact) => Number(contact.unread_count ?? 0) > 0).length,
    appointments_today: input.contacts.filter((contact) => contact.appointment_date === today).length,
    conversion_rate: totalLeads > 0 ? (attendedCount / totalLeads) * 100 : 0,
    revenue_total: revenueTotal,
    funnel,
    by_source: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 8),
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
      .select("id, current_status, unread_count, appointment_date, source, created_at")
      .eq("clinic_id", membership.clinic_id),
    supabase
      .from("revenue_logs")
      .select("amount, created_at")
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
    },
  });
}
