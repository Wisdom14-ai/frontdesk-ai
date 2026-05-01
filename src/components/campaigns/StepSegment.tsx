"use client";

import { PIPELINE_COLUMNS } from "@/lib/frontdesk";

export interface SegmentState {
  statuses: string[];
  treatments: string[];
  sources: string[];
  dateAdded: "7d" | "30d" | "90d" | "all";
}

interface StepSegmentProps {
  segment: SegmentState;
  treatments: string[];
  sources: string[];
  previewCount: number;
  onChange: (segment: SegmentState) => void;
  onNext: () => void;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function StepSegment({
  segment,
  treatments,
  sources,
  previewCount,
  onChange,
  onNext,
}: StepSegmentProps) {
  return (
    <div className="space-y-4">
      <FilterGroup label="Status">
        {PIPELINE_COLUMNS.map((column) => (
          <label key={column.value} className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={segment.statuses.includes(column.value)}
              onChange={() =>
                onChange({
                  ...segment,
                  statuses: toggleValue(segment.statuses, column.value),
                })
              }
            />
            {column.label}
          </label>
        ))}
      </FilterGroup>
      <FilterGroup label="Treatment">
        {treatments.map((treatment) => (
          <label key={treatment} className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={segment.treatments.includes(treatment)}
              onChange={() =>
                onChange({
                  ...segment,
                  treatments: toggleValue(segment.treatments, treatment),
                })
              }
            />
            {treatment}
          </label>
        ))}
      </FilterGroup>
      <FilterGroup label="Source">
        {sources.map((source) => (
          <label key={source} className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={segment.sources.includes(source)}
              onChange={() =>
                onChange({
                  ...segment,
                  sources: toggleValue(segment.sources, source),
                })
              }
            />
            {source}
          </label>
        ))}
      </FilterGroup>
      <label className="block text-[11px] font-medium">
        Date added
        <select
          value={segment.dateAdded}
          onChange={(event) =>
            onChange({ ...segment, dateAdded: event.target.value as SegmentState["dateAdded"] })
          }
          className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2"
        >
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
          <option value="90d">Last 90d</option>
          <option value="all">All time</option>
        </select>
      </label>
      <div className="rounded-[8px] bg-[var(--brand-gold-light)] px-3 py-2 text-[13px] font-semibold text-[var(--brand-gold-dark)]">
        {previewCount} contacts match these filters
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={previewCount === 0}
          className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          Next -&gt;
        </button>
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--text-hint)]">
        {label}
      </div>
      <div className="grid max-h-[92px] grid-cols-2 gap-1 overflow-y-auto rounded-[6px] border border-[var(--border-subtle)] p-2 fd-scrollbar">
        {children}
      </div>
    </div>
  );
}
