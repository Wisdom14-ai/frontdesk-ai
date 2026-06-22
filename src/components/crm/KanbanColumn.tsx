"use client";

import { useState } from "react";

import { KanbanCard } from "@/components/crm/KanbanCard";
import type { AppContact, ContactStatus } from "@/types/app.types";

interface KanbanColumnProps {
  title: string;
  status: ContactStatus;
  color: string;
  contacts: AppContact[];
  onMove?: (contactId: string, status: ContactStatus) => void;
}

export function KanbanColumn({ title, status, color, contacts, onMove }: KanbanColumnProps) {
  const [isOver, setIsOver] = useState(false);

  return (
    <section
      className="flex min-h-0 w-[170px] min-w-[150px] shrink-0 flex-col"
      onDragOver={(event) => {
        // Allow this column to receive dropped cards.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer actually leaves the column, not when it
        // crosses onto a child element.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        const contactId = event.dataTransfer.getData("text/plain");
        if (contactId) {
          onMove?.(contactId, status);
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="truncate text-[10px] font-medium uppercase text-[var(--text-muted)]">
          {title}
        </h2>
        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[9px] font-medium text-[var(--text-secondary)]">
          {contacts.length}
        </span>
      </div>
      <div
        className={[
          "min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-[8px] pr-1 fd-scrollbar transition-colors",
          isOver
            ? "bg-[var(--brand-gold-soft,rgba(186,117,23,0.08))] outline outline-2 outline-dashed outline-[var(--brand-gold-border)]"
            : "",
        ].join(" ")}
      >
        {contacts.map((contact) => (
          <KanbanCard key={contact.id} contact={contact} accentColor={color} />
        ))}
      </div>
    </section>
  );
}
