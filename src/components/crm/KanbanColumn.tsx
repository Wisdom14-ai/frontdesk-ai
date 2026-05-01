"use client";

import { KanbanCard } from "@/components/crm/KanbanCard";
import type { AppContact, ContactStatus } from "@/types/app.types";

interface KanbanColumnProps {
  title: string;
  status: ContactStatus;
  color: string;
  contacts: AppContact[];
}

export function KanbanColumn({ title, color, contacts }: KanbanColumnProps) {
  return (
    <section className="flex min-h-0 w-[170px] min-w-[150px] shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="truncate text-[10px] font-medium uppercase text-[var(--text-muted)]">
          {title}
        </h2>
        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[9px] font-medium text-[var(--text-secondary)]">
          {contacts.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 fd-scrollbar">
        {contacts.map((contact) => (
          <KanbanCard key={contact.id} contact={contact} accentColor={color} />
        ))}
      </div>
    </section>
  );
}
