"use client";

import { useRouter } from "next/navigation";

import { getContactNameReview } from "@/lib/contact-name";
import { formatDateTime } from "@/lib/frontdesk";
import type { AppContact } from "@/types/app.types";

interface KanbanCardProps {
  contact: AppContact;
  accentColor: string;
}

function formatRevenueMyr(amount: number) {
  if (amount >= 1000) {
    return `RM ${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
  }
  return `RM ${Math.round(amount)}`;
}

export function KanbanCard({ contact, accentColor }: KanbanCardProps) {
  const router = useRouter();
  const isBot = contact.bot_mode === "active";
  const hasRevenue =
    typeof contact.revenue_generated_myr === "number" &&
    contact.revenue_generated_myr > 0;
  const nameReview = getContactNameReview({
    fullName: contact.full_name,
    phone: contact.phone_e164,
  });

  return (
    <button
      type="button"
      onClick={() => router.push(`/inbox?contact_id=${contact.id}`)}
      className="w-full rounded-[8px] border border-[var(--border-subtle)] bg-white p-2 text-left hover:border-[var(--brand-gold-border)]"
      style={{ borderLeft: `2px solid ${accentColor}` }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 truncate text-[11px] font-medium text-[var(--text-primary)]">
          {contact.full_name}
        </div>
        {hasRevenue ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
            {formatRevenueMyr(contact.revenue_generated_myr!)}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
        {[contact.treatment_interest, contact.source].filter(Boolean).join(" · ") || contact.phone_e164}
      </div>
      {contact.appointment_date ? (
        <div className="mt-1 text-[10px] font-medium text-[var(--brand-gold-dark)]">
          {formatDateTime(contact.appointment_date, contact.appointment_time)}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            isBot
              ? "bg-[var(--status-bot-bg)] text-[var(--status-bot-text)]"
              : "bg-[var(--status-human-bg)] text-[var(--status-human-text)]",
          ].join(" ")}
        >
          {isBot ? "Bot" : "Human"}
        </span>
        {contact.reminder_sent_at ? (
          <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            Reminder
          </span>
        ) : null}
        {contact.treatment_category ? (
          <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-muted)]">
            {contact.treatment_category}
          </span>
        ) : null}
        {nameReview.status !== "trusted" ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Review name
          </span>
        ) : null}
      </div>
    </button>
  );
}
