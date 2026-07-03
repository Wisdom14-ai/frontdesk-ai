"use client";

interface SourceAttributionTableProps {
  data: Array<{ source: string; leads: number; booked: number; attended: number; revenue: number }>;
}

function formatRevenue(value: number) {
  if (value >= 1000) {
    return `RM ${(value / 1000).toFixed(1)}k`;
  }
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

export function SourceAttributionTable({ data }: SourceAttributionTableProps) {
  return (
    <section className="rounded-[8px] border border-[var(--border-subtle)] bg-white p-3">
      <h2 className="text-[13px] font-semibold">ROI by channel</h2>
      {data.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center text-[11px] text-[var(--text-muted)]">
          No attributed leads yet
        </div>
      ) : (
        <table className="mt-3 w-full text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-hint)]">
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Leads</th>
              <th className="pb-2 font-medium">Booked</th>
              <th className="pb-2 font-medium">Attended</th>
              <th className="pb-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.source} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="max-w-[120px] truncate py-1.5 font-medium">{row.source}</td>
                <td className="py-1.5">{row.leads}</td>
                <td className="py-1.5">{row.booked}</td>
                <td className="py-1.5">{row.attended}</td>
                <td className="py-1.5">{formatRevenue(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
