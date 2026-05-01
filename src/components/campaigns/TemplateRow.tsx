"use client";

import { Pencil, Trash2 } from "lucide-react";

import type { MessageTemplate } from "@/types/app.types";

interface TemplateRowProps {
  template: MessageTemplate;
  onEdit: (template: MessageTemplate) => void;
  onDelete: (template: MessageTemplate) => void;
}

export function TemplateRow({ template, onEdit, onDelete }: TemplateRowProps) {
  return (
    <div className="group flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[12px] font-semibold">{template.name}</h3>
          {template.show_as_quick_reply ? (
            <span className="rounded-full bg-[var(--status-human-bg)] px-2 py-0.5 text-[10px] text-[var(--status-human-text)]">
              Quick reply
            </span>
          ) : null}
          <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            {template.category.replace("_", " ")}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
          {template.body.slice(0, 80)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(template)}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--surface-subtle)]"
          aria-label="Edit template"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(template)}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
          aria-label="Delete template"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
