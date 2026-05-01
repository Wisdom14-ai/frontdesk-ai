"use client";

export type DateRangeKey = "today" | "week" | "month" | "last_month" | "90d";

interface DateRangeSelectProps {
  value: DateRangeKey;
  onChange: (value: DateRangeKey) => void;
}

export const DATE_RANGE_OPTIONS: Array<{ value: DateRangeKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "90d", label: "Last 90 days" },
];

export function DateRangeSelect({ value, onChange }: DateRangeSelectProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as DateRangeKey)}
      className="h-8 rounded-[6px] border border-[var(--border-default)] bg-white px-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
    >
      {DATE_RANGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
