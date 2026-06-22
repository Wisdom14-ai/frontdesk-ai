"use client";

import type { AppContact, ContactPatch } from "@/types/app.types";
import { buildBotResumePlan } from "@/lib/contact-actions";
import { formatDateTime, getInitials, getStatusLabel } from "@/lib/frontdesk";

interface ChatHeaderProps {
  contact: AppContact;
  onPatchContact: (contactId: string, updates: ContactPatch) => Promise<void>;
}

export function ChatHeader({ contact, onPatchContact }: ChatHeaderProps) {
  const isActive = contact.bot_mode === "active";

  async function turnBotOn() {
    // Fully reverses a pause / "Okk" / opt-out, confirming first if the contact
    // had asked to stop.
    const { patch, confirmMessage } = buildBotResumePlan(contact);
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }
    await onPatchContact(contact.id, patch);
  }

  return (
    <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#B5D4F4] text-[11px] font-semibold text-[#185FA5]">
          {getInitials(contact.full_name)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {contact.full_name}
          </div>
          <div className="truncate text-[10px] text-[var(--text-muted)]">
            {[contact.treatment_interest, getStatusLabel(contact.current_status), contact.phone_e164]
              .filter(Boolean)
              .join(" · ")}
            {contact.appointment_date ? ` · ${formatDateTime(contact.appointment_date, contact.appointment_time)}` : ""}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() =>
            isActive
              ? void onPatchContact(contact.id, { bot_mode: "paused" })
              : void turnBotOn()
          }
          className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--text-secondary)]"
        >
          <span
            className={[
              "relative h-4 w-7 rounded-full transition-colors",
              isActive ? "bg-[var(--wa-connected)]" : "bg-[var(--border-strong)]",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-[2px] h-3 w-3 rounded-full bg-white transition-transform",
                isActive ? "translate-x-[13px]" : "translate-x-[2px]",
              ].join(" ")}
            />
          </span>
          Bot
        </button>
        <button
          type="button"
          onClick={() => void onPatchContact(contact.id, { bot_mode: "paused" })}
          className="rounded-full bg-[var(--brand-gold)] px-[9px] py-[3px] text-[10px] font-medium text-white hover:bg-[var(--brand-gold-dark)]"
        >
          Take over
        </button>
      </div>
    </header>
  );
}
