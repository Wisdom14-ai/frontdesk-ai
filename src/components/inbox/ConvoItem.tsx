"use client";

import type { AppContact } from "@/types/app.types";
import { getContactNameReview } from "@/lib/contact-name";
import { formatRelativeTime, getStatusLabel } from "@/lib/frontdesk";

interface ConvoItemProps {
  contact: AppContact;
  selected: boolean;
  onSelect: (contact: AppContact) => void;
}

export function ConvoItem({ contact, selected, onSelect }: ConvoItemProps) {
  const isUnread = contact.unread_count > 0;
  const statusLabel =
    contact.bot_mode === "active"
      ? "Bot"
      : contact.bot_mode === "handoff_required"
        ? "New"
        : "Human";
  const nameReview = getContactNameReview({
    fullName: contact.full_name,
    phone: contact.phone_e164,
  });

  return (
    <button
      type="button"
      onClick={() => onSelect(contact)}
      className={[
        "flex w-full flex-col gap-1 border-b border-[var(--border-subtle)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-subtle)]",
        selected ? "bg-[var(--brand-gold-light)]" : "bg-transparent",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={[
            "min-w-0 truncate text-[12px]",
            isUnread ? "font-semibold text-[var(--text-primary)]" : "font-medium text-[var(--text-secondary)]",
          ].join(" ")}
        >
          {contact.full_name}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
          {formatRelativeTime(contact.last_inbound_at ?? contact.last_message_at ?? contact.updated_at)}
        </span>
      </div>
      <p className="truncate text-[11px] text-[var(--text-muted)]">
        {contact.last_message_preview || contact.phone_e164}
      </p>
      <div className="flex items-center gap-1.5">
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            statusLabel === "Bot"
              ? "bg-[var(--status-bot-bg)] text-[var(--status-bot-text)]"
              : statusLabel === "Human"
                ? "bg-[var(--status-human-bg)] text-[var(--status-human-text)]"
                : "bg-[var(--status-new-bg)] text-[var(--status-new-text)]",
          ].join(" ")}
        >
          {statusLabel}
        </span>
        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
          {getStatusLabel(contact.current_status)}
        </span>
        {nameReview.status !== "trusted" ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Review name
          </span>
        ) : null}
        {isUnread ? (
          <span className="ml-auto h-2 w-2 rounded-full bg-[var(--danger)]" />
        ) : null}
      </div>
    </button>
  );
}
