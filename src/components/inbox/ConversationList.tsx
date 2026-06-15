"use client";

import { useState } from "react";

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
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim().toLowerCase();

  const filteredContacts = sortConversations(
    contacts.filter((contact) => {
      if (filter === "unread" && contact.unread_count <= 0) return false;
      if (filter === "bot" && contact.bot_mode !== "active") return false;
      if (filter === "human" && contact.bot_mode === "active") return false;

      if (trimmedQuery) {
        const haystack = `${contact.full_name ?? ""} ${contact.phone_e164 ?? ""}`.toLowerCase();
        if (!haystack.includes(trimmedQuery)) return false;
      }

      return true;
    })
  );

  return (
    <section className="flex w-[230px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]">
      <div className="border-b border-[var(--border-subtle)] p-2">
        <div className="relative mb-2">
          <svg
            viewBox="0 0 16 16"
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="m11 11 3 3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or number"
            className="w-full rounded-full border border-[var(--border-default)] bg-[var(--surface-base)] py-1 pl-7 pr-2.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-gold-border)] focus:outline-none"
          />
        </div>
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
          <div className="space-y-px">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="flex animate-pulse items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5"
              >
                <span className="h-9 w-9 shrink-0 rounded-full bg-[var(--surface-subtle)]" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="h-3 w-2/3 rounded bg-[var(--surface-subtle)]" />
                  <span className="h-2.5 w-4/5 rounded bg-[var(--surface-subtle)]" />
                  <span className="h-2.5 w-1/3 rounded bg-[var(--surface-subtle)]" />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {!loading && filteredContacts.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
            {trimmedQuery ? "No matches found" : "No conversations"}
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
