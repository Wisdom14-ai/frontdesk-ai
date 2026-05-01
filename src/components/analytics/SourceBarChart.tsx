"use client";

interface SourceBarChartProps {
  data: Array<{ source: string; count: number }>;
}

export function SourceBarChart({ data }: SourceBarChartProps) {
  const maxCount = Math.max(1, ...data.map((item) => item.count));

  return (
    <section className="rounded-[8px] border border-[var(--border-subtle)] bg-white p-3">
      <h2 className="text-[13px] font-semibold">Leads by source</h2>
      <div className="mt-3 flex h-[180px] items-end gap-3 border-b border-[var(--border-subtle)] px-1">
        {data.length === 0 ? (
          <div className="flex h-full flex-1 items-center justify-center text-[11px] text-[var(--text-muted)]">
            No source data
          </div>
        ) : (
          data.map((item, index) => (
            <div key={item.source} className="flex min-w-[44px] flex-1 flex-col items-center gap-1">
              <div className="text-[10px] font-medium text-[var(--text-secondary)]">
                {item.count}
              </div>
              <div
                className="w-full rounded-t-[6px] bg-[var(--brand-gold)]"
                style={{
                  height: `${Math.max(8, (item.count / maxCount) * 138)}px`,
                  opacity: 0.65 + index * 0.05,
                }}
              />
            </div>
          ))
        )}
      </div>
      {data.length > 0 ? (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {data.map((item) => (
            <span key={item.source} className="truncate text-center text-[10px] text-[var(--text-muted)]">
              {item.source}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
