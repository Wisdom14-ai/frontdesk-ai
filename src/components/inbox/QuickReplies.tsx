"use client";

import type { MessageTemplate } from "@/types/app.types";

interface QuickRepliesProps {
  templates: MessageTemplate[];
  onPick: (body: string) => void;
}

export function QuickReplies({ templates, onPick }: QuickRepliesProps) {
  const visibleTemplates = templates.slice(0, 6);
  const hiddenCount = Math.max(0, templates.length - visibleTemplates.length);

  if (templates.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 fd-scrollbar">
      {visibleTemplates.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onPick(template.body)}
          className="shrink-0 rounded-full border border-[var(--border-default)] bg-transparent px-2.5 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand-gold-border)] hover:text-[var(--brand-gold-dark)]"
        >
          {template.name}
        </button>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]"
        >
          +{hiddenCount} more
        </button>
      ) : null}
    </div>
  );
}
