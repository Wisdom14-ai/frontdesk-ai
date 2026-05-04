"use client";

import { useEffect, useMemo, useState } from "react";

import { DateRangeSelect, type DateRangeKey } from "@/components/analytics/DateRangeSelect";
import { FunnelChart } from "@/components/analytics/FunnelChart";
import { KpiCard } from "@/components/analytics/KpiCard";
import { RevenueChart } from "@/components/analytics/RevenueChart";
import { SourceBarChart } from "@/components/analytics/SourceBarChart";

interface AnalyticsPayload {
  new_leads: number;
  unread_convos: number;
  appointments_today: number;
  conversion_rate: number;
  revenue_total: number;
  avg_revenue_per_patient: number;
  funnel: Record<string, number>;
  by_source: Array<{ source: string; count: number }>;
  revenue_by_category: Array<{ category: string; amount: number }>;
  revenue_by_month: Array<{ month: string; amount: number }>;
  deltas?: Record<string, number>;
}

interface AnalyticsScreenProps {
  clinicId: string;
}

function getDateRange(range: DateRangeKey) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "last_month") {
    start.setMonth(start.getMonth() - 1, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "90d") {
    start.setDate(start.getDate() - 90);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

function formatRevenue(value: number) {
  if (value >= 1000) {
    return `RM ${(value / 1000).toFixed(1)}k`;
  }
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

export function AnalyticsScreen({ clinicId }: AnalyticsScreenProps) {
  const [range, setRange] = useState<DateRangeKey>("month");
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  const dateRange = useMemo(() => getDateRange(range), [range]);

  useEffect(() => {
    async function loadAnalytics() {
      const params = new URLSearchParams({
        clinic_id: clinicId,
        start_date: dateRange.start.toISOString(),
        end_date: dateRange.end.toISOString(),
      });
      const response = await fetch(`/api/analytics?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setData(null);
        return;
      }
      setData((await response.json()) as AnalyticsPayload);
    }

    void loadAnalytics();
  }, [clinicId, dateRange]);

  const current = data ?? {
    new_leads: 0,
    unread_convos: 0,
    appointments_today: 0,
    conversion_rate: 0,
    revenue_total: 0,
    avg_revenue_per_patient: 0,
    funnel: {},
    by_source: [],
    revenue_by_category: [],
    revenue_by_month: [],
    deltas: {},
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-base)] p-3 fd-scrollbar">
      <div className="mb-3 flex h-10 items-center justify-between rounded-[8px] border border-[var(--border-subtle)] bg-white px-3">
        <span className="text-[10px] font-semibold uppercase text-[var(--text-hint)]">
          Date range
        </span>
        <DateRangeSelect value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <KpiCard label="New leads" value={String(current.new_leads)} delta={current.deltas?.new_leads} />
        <KpiCard label="Unread convos" value={String(current.unread_convos)} delta={current.deltas?.unread_convos} />
        <KpiCard label="Appts today" value={String(current.appointments_today)} delta={current.deltas?.appointments_today} />
        <KpiCard label="Lead → attended" value={`${Math.round(current.conversion_rate)}%`} delta={current.deltas?.conversion_rate} />
        <KpiCard label="Revenue" value={formatRevenue(current.revenue_total)} delta={current.deltas?.revenue_total} />
        <KpiCard
          label="Avg / patient"
          value={current.avg_revenue_per_patient > 0 ? formatRevenue(current.avg_revenue_per_patient) : "-"}
          delta={current.deltas?.avg_revenue_per_patient}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <FunnelChart data={current.funnel} />
        <SourceBarChart data={current.by_source} />
      </div>

      <div className="mt-3">
        <RevenueChart
          byMonth={current.revenue_by_month}
          byCategory={current.revenue_by_category}
        />
      </div>
    </div>
  );
}
