"use client";

interface RevenueChartProps {
  byMonth: Array<{ month: string; amount: number }>;
  byCategory: Array<{ category: string; amount: number }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  dental: "Dental",
  aesthetic: "Aesthetic",
  gp: "GP",
  other: "Other",
};

function formatMyr(value: number) {
  if (value >= 1000) {
    return `RM ${(value / 1000).toFixed(1)}k`;
  }
  return `RM ${Math.round(value)}`;
}

function formatMonthLabel(yyyyMm: string) {
  const [year, month] = yyyyMm.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-MY", { month: "short", year: "2-digit" });
}

const CATEGORY_COLORS: Record<string, string> = {
  dental: "#2563eb",
  aesthetic: "#9333ea",
  gp: "#16a34a",
  other: "#d97706",
};

export function RevenueChart({ byMonth, byCategory }: RevenueChartProps) {
  const maxMonthAmount = Math.max(1, ...byMonth.map((m) => m.amount));
  const totalCategory = byCategory.reduce((s, c) => s + c.amount, 0);

  return (
    <section className="rounded-[8px] border border-[var(--border-subtle)] bg-white p-3">
      <h2 className="text-[13px] font-semibold">Revenue</h2>

      {/* Monthly trend */}
      {byMonth.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase text-[var(--text-hint)]">
            Monthly trend
          </p>
          <div className="mt-2 flex h-[120px] items-end gap-2 border-b border-[var(--border-subtle)]">
            {byMonth.map((item) => (
              <div
                key={item.month}
                className="group relative flex flex-1 flex-col items-center gap-1"
              >
                <div className="absolute -top-5 hidden rounded bg-gray-800 px-1.5 py-0.5 text-[9px] text-white group-hover:block whitespace-nowrap">
                  {formatMyr(item.amount)}
                </div>
                <div
                  className="w-full rounded-t-[4px] bg-emerald-500"
                  style={{
                    height: `${Math.max(4, (item.amount / maxMonthAmount) * 100)}px`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            {byMonth.map((item) => (
              <div key={item.month} className="flex-1 text-center text-[9px] text-[var(--text-muted)]">
                {formatMonthLabel(item.month)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex h-[120px] items-center justify-center text-[11px] text-[var(--text-muted)]">
          No revenue data yet
        </div>
      )}

      {/* Category breakdown */}
      {byCategory.length > 0 && totalCategory > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase text-[var(--text-hint)]">
            By treatment category
          </p>
          <div className="mt-2 space-y-2">
            {byCategory.map((item) => {
              const pct = totalCategory > 0 ? (item.amount / totalCategory) * 100 : 0;
              const color = CATEGORY_COLORS[item.category] ?? "#6b7280";
              const label = CATEGORY_LABELS[item.category] ?? item.category;
              return (
                <div key={item.category} className="flex items-center gap-2">
                  <div className="w-[56px] shrink-0 text-right text-[10px] text-[var(--text-secondary)]">
                    {label}
                  </div>
                  <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="w-[52px] shrink-0 text-right text-[10px] font-medium text-[var(--text-secondary)]">
                    {formatMyr(item.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
