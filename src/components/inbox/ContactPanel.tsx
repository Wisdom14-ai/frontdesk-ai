"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { PIPELINE_COLUMNS, formatDateTime, getStatusLabel, normalizeStatus } from "@/lib/frontdesk";
import type { AppContact, StaffUser } from "@/types/app.types";

interface ContactPanelProps {
  contact: AppContact | null;
  staff: StaffUser[];
  onPatchContact: (contactId: string, updates: Partial<AppContact>) => Promise<void>;
}

function getStatusClasses(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "new_lead") return "bg-[var(--status-new-bg)] text-[var(--status-new-text)]";
  if (normalized === "appointment_set") return "bg-[var(--status-appt-bg)] text-[var(--status-appt-text)]";
  if (normalized === "attended") return "bg-[var(--status-attended-bg)] text-[var(--status-attended-text)]";
  if (normalized === "converted") return "bg-[var(--status-converted-bg)] text-[var(--status-converted-text)]";
  return "bg-[var(--surface-subtle)] text-[var(--text-secondary)]";
}

export function ContactPanel({ contact, staff, onPatchContact }: ContactPanelProps) {
  const router = useRouter();
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [revenueOpen, setRevenueOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<"attended" | "no_show">("attended");
  const [revenueAmount, setRevenueAmount] = useState("");
  const [noteDraft, setNoteDraft] = useState(contact?.staff_note ?? "");

  useEffect(() => {
    setNoteDraft(contact?.staff_note ?? "");
  }, [contact?.id, contact?.staff_note]);

  if (!contact) {
    return (
      <aside className="flex w-[200px] shrink-0 items-center justify-center border-l border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-center text-[11px] text-[var(--text-muted)]">
        No contact selected
      </aside>
    );
  }

  const assignedStaff =
    staff.find((member) => member.id === contact.assigned_user_id)?.full_name ??
    contact.assigned_user_name ??
    "Unassigned";

  async function saveRevenue() {
    if (!contact) return;

    if (attendanceStatus === "no_show") {
      await onPatchContact(contact.id, {
        current_status: "no_show",
        attendance_status: "no_show",
      });
    } else if (Number(revenueAmount) > 0) {
      await fetch("/api/revenue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: contact.id,
          amount: Number(revenueAmount),
          note: "Logged from inbox",
        }),
      });
      await onPatchContact(contact.id, {
        current_status: "attended",
        attendance_status: "attended",
      });
    } else {
      await onPatchContact(contact.id, {
        current_status: "attended",
        attendance_status: "attended",
      });
    }

    setRevenueOpen(false);
    setRevenueAmount("");
  }

  return (
    <aside className="w-[200px] shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 fd-scrollbar">
      <div className="space-y-1">
        <h2 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {contact.full_name}
        </h2>
        <p className="text-[11px] text-[var(--text-muted)]">{contact.phone_e164}</p>
      </div>

      <div className="mt-4 space-y-2 text-[11px]">
        <InfoRow
          label="STATUS"
          value={
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusClasses(contact.current_status)}`}>
              {getStatusLabel(contact.current_status)}
            </span>
          }
        />
        <InfoRow label="TREATMENT" value={contact.treatment_interest || "-"} />
        <InfoRow label="SOURCE" value={contact.source || "-"} />
        <InfoRow
          label="NEXT APPT"
          value={
            contact.appointment_date ? (
              <span className="font-medium text-[var(--brand-gold-dark)]">
                {formatDateTime(contact.appointment_date, contact.appointment_time)}
              </span>
            ) : (
              "-"
            )
          }
        />
        <InfoRow label="ASSIGNED TO" value={assignedStaff} />
      </div>

      <div className="my-4 border-t border-[var(--border-subtle)]" />

      <label className="text-[10px] font-semibold text-[var(--text-hint)]">
        STAFF NOTE
      </label>
      <textarea
        value={noteDraft}
        onChange={(event) => setNoteDraft(event.target.value)}
        onBlur={() => {
          if (noteDraft !== (contact.staff_note ?? "")) {
            void onPatchContact(contact.id, { staff_note: noteDraft });
          }
        }}
        rows={5}
        className="mt-1 w-full resize-none rounded-[6px] border border-[var(--border-default)] bg-white p-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
      />

      <div className="my-4 border-t border-[var(--border-subtle)]" />

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setPipelineOpen((value) => !value)}
          className="w-full rounded-[6px] border border-[var(--border-default)] px-2 py-1.5 text-left text-[11px] font-medium hover:bg-[var(--surface-subtle)]"
        >
          Move to pipeline -&gt;
        </button>
        {pipelineOpen ? (
          <select
            value={normalizeStatus(contact.current_status)}
            onChange={(event) => {
              void onPatchContact(contact.id, {
                current_status: event.target.value,
              });
              setPipelineOpen(false);
            }}
            className="h-8 w-full rounded-[6px] border border-[var(--brand-gold-border)] bg-white px-2 text-[11px] outline-none"
          >
            {PIPELINE_COLUMNS.map((column) => (
              <option key={column.value} value={column.value}>
                {column.label}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          onClick={() => setRevenueOpen(true)}
          className="w-full rounded-[6px] border border-[var(--border-default)] px-2 py-1.5 text-left text-[11px] font-medium hover:bg-[var(--surface-subtle)]"
        >
          Log attended + revenue
        </button>
        <button
          type="button"
          onClick={() => router.push(`/inbox?contact_id=${contact.id}`)}
          className="w-full rounded-[6px] border border-[var(--border-default)] px-2 py-1.5 text-left text-[11px] font-medium hover:bg-[var(--surface-subtle)]"
        >
          View full history
        </button>
      </div>

      {revenueOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="w-[280px] rounded-[8px] border border-[var(--border-default)] bg-white p-4">
            <h3 className="text-[13px] font-semibold">Log visit outcome</h3>
            <div className="mt-3 space-y-2 text-[12px]">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={attendanceStatus === "attended"}
                  onChange={() => setAttendanceStatus("attended")}
                />
                Attended
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={attendanceStatus === "no_show"}
                  onChange={() => setAttendanceStatus("no_show")}
                />
                No show
              </label>
              <input
                type="number"
                min="0"
                value={revenueAmount}
                onChange={(event) => setRevenueAmount(event.target.value)}
                placeholder="Revenue amount"
                className="h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 outline-none focus:border-[var(--brand-gold-border)]"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevenueOpen(false)}
                className="rounded-[6px] border border-[var(--border-default)] px-3 py-1.5 text-[11px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveRevenue()}
                className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[70px_1fr] items-center gap-2">
      <span className="text-[10px] font-semibold text-[var(--text-hint)]">
        {label}
      </span>
      <span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
        {value}
      </span>
    </div>
  );
}
