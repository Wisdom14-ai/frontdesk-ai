"use client";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
}

export function KpiCard({ label, value, delta }: KpiCardProps) {
  const deltaLabel =
    typeof delta === "number" && Number.isFinite(delta)
      ? `${delta >= 0 ? "+" : ""}${Math.round(delta)}%`
      : null;

  return (
    <div className="rounded-[8px] bg-[var(--surface-subtle)] px-3 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-normal text-[var(--text-hint)]">
        {label}
      </div>
      <div className="mt-1 text-[22px] font-medium leading-none text-[var(--text-primary)]">
        {value}
      </div>
      {deltaLabel ? (
        <div
          className={[
            "mt-1 text-[10px] font-medium",
            (delta ?? 0) >= 0 ? "text-[var(--wa-connected)]" : "text-[var(--danger)]",
          ].join(" ")}
        >
          {deltaLabel}
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-[var(--text-hint)]">-</div>
      )}
    </div>
  );
}
