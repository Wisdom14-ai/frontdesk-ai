"use client";

import { PIPELINE_COLUMNS } from "@/lib/frontdesk";

interface FunnelChartProps {
  data: Record<string, number>;
}

const FUNNEL_STAGES = PIPELINE_COLUMNS.filter((column) =>
  ["new_lead", "contacted", "appointment_set", "attended", "converted"].includes(column.value)
);

export function FunnelChart({ data }: FunnelChartProps) {
  const maxCount = Math.max(1, ...FUNNEL_STAGES.map((stage) => data[stage.value] ?? 0));

  return (
    <section className="rounded-[8px] border border-[var(--border-subtle)] bg-white p-3">
      <h2 className="text-[13px] font-semibold">Conversion funnel</h2>
      <div className="mt-3 space-y-2">
        {FUNNEL_STAGES.map((stage, index) => {
          const count = data[stage.value] ?? 0;
          const pct = Math.round((count / maxCount) * 100);
          return (
            <div key={stage.value} className="grid grid-cols-[98px_1fr_42px] items-center gap-2">
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                {stage.label}
              </span>
              <div className="h-6 rounded-full bg-[var(--surface-subtle)]">
                <div
                  className="flex h-6 items-center rounded-full px-2 text-[10px] font-medium text-white"
                  style={{
                    width: `${Math.max(4, pct)}%`,
                    background: `linear-gradient(90deg, #BA7517, ${
                      index >= 3 ? "#639922" : "#EF9F27"
                    })`,
                  }}
                >
                  {count}
                </div>
              </div>
              <span className="text-right text-[10px] text-[var(--text-muted)]">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
