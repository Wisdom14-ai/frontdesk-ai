"use client";

import type { AppContact } from "@/types/app.types";
import { getContactNameReview } from "@/lib/contact-name";
import { formatRelativeTime, getInitials, getLastActivityAt, getStatusLabel } from "@/lib/frontdesk";

interface ConvoItemProps {
  contact: AppContact;
  selected: boolean;
  onSelect: (contact: AppContact) => void;
}

// Stable avatar colour per contact so the same lead always looks the same.
const AVATAR_COLORS = [
  { bg: "#B5D4F4", text: "#185FA5" },
  { bg: "#F4D7B5", text: "#A56318" },
  { bg: "#C9E8C0", text: "#3F7A2E" },
  { bg: "#E8C0DD", text: "#933C7E" },
  { bg: "#C0D6E8", text: "#2E5A7A" },
  { bg: "#E8D5C0", text: "#7A5A2E" },
];

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash];
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
  const color = avatarColor(contact.id || contact.phone_e164 || contact.full_name);

  return (
    <button
      type="button"
      onClick={() => onSelect(contact)}
      className={[
        "flex w-full items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-subtle)]",
        selected ? "bg-[var(--brand-gold-light)]" : "bg-transparent",
      ].join(" ")}
    >
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
        style={{ backgroundColor: color.bg, color: color.text }}
      >
        {getInitials(contact.full_name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
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
          {formatRelativeTime(new Date(getLastActivityAt(contact)).toISOString())}
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
          <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--wa-connected)] px-1 text-[10px] font-semibold text-white">
            {contact.unread_count > 99 ? "99+" : contact.unread_count}
          </span>
        ) : null}
      </div>
      </span>
    </button>
  );
}
