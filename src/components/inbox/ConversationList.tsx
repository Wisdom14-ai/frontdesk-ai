"use client";

import type { AppContact } from "@/types/app.types";
import { sortConversations } from "@/lib/frontdesk";
import { ConvoItem } from "@/components/inbox/ConvoItem";

type FilterValue = "all" | "unread" | "bot" | "human";

interface ConversationListProps {
  contacts: AppContact[];
  selectedContactId: string | null;
  filter: FilterValue;
  onFilterChange: (filter: FilterValue) => void;
  onSelect: (contact: AppContact) => void;
  loading: boolean;
}

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "bot", label: "Bot" },
  { value: "human", label: "Human" },
];

export function ConversationList({
  contacts,
  selectedContactId,
  filter,
  onFilterChange,
  onSelect,
  loading,
}: ConversationListProps) {
  const filteredContacts = sortConversations(
    contacts.filter((contact) => {
      if (filter === "unread") return contact.unread_count > 0;
      if (filter === "bot") return contact.bot_mode === "active";
      if (filter === "human") return contact.bot_mode !== "active";
      return true;
    })
  );

  return (
    <section className="flex w-[230px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]">
      <div className="border-b border-[var(--border-subtle)] p-2">
        <div className="flex gap-1 overflow-x-auto fd-scrollbar">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onFilterChange(item.value)}
              className={[
                "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                filter === item.value
                  ? "border-[var(--brand-gold-border)] bg-[var(--brand-gold-light)] text-[var(--brand-gold-dark)]"
                  : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto fd-scrollbar">
        {loading ? (
          <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
            Loading conversations...
          </div>
        ) : null}
        {!loading && filteredContacts.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
            No conversations
          </div>
        ) : null}
        {filteredContacts.map((contact) => (
          <ConvoItem
            key={contact.id}
            contact={contact}
            selected={selectedContactId === contact.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
