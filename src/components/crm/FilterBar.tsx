"use client";

import { Search } from "lucide-react";

import type { StaffUser } from "@/types/app.types";

export interface CrmFilters {
  staffId: string;
  treatment: string;
  source: string;
  search: string;
}

interface FilterBarProps {
  filters: CrmFilters;
  staff: StaffUser[];
  treatments: string[];
  sources: string[];
  onChange: (filters: CrmFilters) => void;
}

export function FilterBar({
  filters,
  staff,
  treatments,
  sources,
  onChange,
}: FilterBarProps) {
  return (
    <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3">
      <select
        value={filters.staffId}
        onChange={(event) => onChange({ ...filters, staffId: event.target.value })}
        className="h-8 w-[130px] rounded-[6px] border border-[var(--border-default)] bg-white px-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
      >
        <option value="">Staff</option>
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {member.full_name}
          </option>
        ))}
      </select>

      <select
        value={filters.treatment}
        onChange={(event) => onChange({ ...filters, treatment: event.target.value })}
        className="h-8 w-[150px] rounded-[6px] border border-[var(--border-default)] bg-white px-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
      >
        <option value="">Treatment</option>
        {treatments.map((treatment) => (
          <option key={treatment} value={treatment}>
            {treatment}
          </option>
        ))}
      </select>

      <select
        value={filters.source}
        onChange={(event) => onChange({ ...filters, source: event.target.value })}
        className="h-8 w-[130px] rounded-[6px] border border-[var(--border-default)] bg-white px-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
      >
        <option value="">Source</option>
        {sources.map((source) => (
          <option key={source} value={source}>
            {source}
          </option>
        ))}
      </select>

      <div className="relative min-w-[180px] flex-1">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-hint)]" />
        <input
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          placeholder="Search..."
          className="h-8 w-full rounded-[6px] border border-[var(--border-default)] bg-white pl-7 pr-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
        />
      </div>
    </div>
  );
}
