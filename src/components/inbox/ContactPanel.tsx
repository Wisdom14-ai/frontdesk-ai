"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { getContactNameReview } from "@/lib/contact-name";
import { PIPELINE_COLUMNS, formatDateTime, getStatusLabel, normalizeStatus } from "@/lib/frontdesk";
import type { AppContact, RevenueLogEntry, StaffUser } from "@/types/app.types";

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

function formatRevenueMyr(amount: number) {
  return `RM ${amount.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ContactPanel({ contact, staff, onPatchContact }: ContactPanelProps) {
  const router = useRouter();
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [revenueOpen, setRevenueOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<"attended" | "no_show">("attended");
  const [revenueAmount, setRevenueAmount] = useState("");
  const [revenueNote, setRevenueNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState(contact?.staff_note ?? "");
  const [nameDraft, setNameDraft] = useState(contact?.full_name ?? "");
  const [revenueLogs, setRevenueLogs] = useState<RevenueLogEntry[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);

  useEffect(() => {
    setNoteDraft(contact?.staff_note ?? "");
    setNameDraft(contact?.full_name ?? "");
    setLogsLoaded(false);
    setRevenueLogs([]);
  }, [contact?.id, contact?.staff_note, contact?.full_name]);

  const loadRevenueLogs = useCallback(async (contactId: string) => {
    const res = await fetch(`/api/contacts/${contactId}/revenue`);
    if (!res.ok) return;
    const payload = (await res.json()) as { logs: RevenueLogEntry[] };
    setRevenueLogs(payload.logs);
    setLogsLoaded(true);
  }, []);

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

  const totalRevenue =
    typeof contact.revenue_generated_myr === "number" &&
    contact.revenue_generated_myr > 0
      ? contact.revenue_generated_myr
      : null;
  const nameReview = getContactNameReview({
    fullName: contact.full_name,
    phone: contact.phone_e164,
  });
  const canSaveName =
    nameDraft.trim().length >= 2 && nameDraft.trim() !== contact.full_name;

  async function saveContactName() {
    if (!contact || !canSaveName) return;
    setSaving(true);
    try {
      await onPatchContact(contact.id, { full_name: nameDraft.trim() });
    } finally {
      setSaving(false);
    }
  }

  async function saveRevenue() {
    if (!contact) return;
    setSaving(true);
    try {
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
            note: revenueNote.trim() || null,
          }),
        });
        await onPatchContact(contact.id, {
          current_status: "attended",
          attendance_status: "attended",
          revenue_generated_myr:
            (contact.revenue_generated_myr ?? 0) + Number(revenueAmount),
        });
      } else {
        await onPatchContact(contact.id, {
          current_status: "attended",
          attendance_status: "attended",
        });
      }

      setRevenueOpen(false);
      setRevenueAmount("");
      setRevenueNote("");
      // Refresh logs if panel was open
      if (logsLoaded) {
        void loadRevenueLogs(contact.id);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="w-[200px] shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 fd-scrollbar">
      <div className="space-y-1">
        <h2 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {contact.full_name}
        </h2>
        <p className="text-[11px] text-[var(--text-muted)]">{contact.phone_e164}</p>
      </div>

      {nameReview.status !== "trusted" ? (
        <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 p-2">
          <div className="text-[10px] font-semibold uppercase text-amber-700">
            Name review
          </div>
          <p className="mt-1 text-[10px] leading-4 text-amber-700">
            {nameReview.reason}
          </p>
          <input
            type="text"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Prospect name"
            className="mt-2 h-7 w-full rounded-[6px] border border-amber-200 bg-white px-2 text-[11px] outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={() => void saveContactName()}
            disabled={!canSaveName || saving}
            className="mt-2 w-full rounded-[6px] bg-amber-600 px-2 py-1 text-left text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:bg-amber-200"
          >
            Save name
          </button>
        </div>
      ) : null}

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

      {/* Revenue summary */}
      <div className="my-4 border-t border-[var(--border-subtle)]" />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-[var(--text-hint)]">REVENUE</span>
        {totalRevenue !== null ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {formatRevenueMyr(totalRevenue)}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--text-muted)]">None yet</span>
        )}
      </div>

      {/* Revenue log history toggle */}
      {totalRevenue !== null && (
        <button
          type="button"
          onClick={() => {
            if (!logsLoaded) void loadRevenueLogs(contact.id);
            else setLogsLoaded((prev) => !prev ? true : true); // toggle trick: re-fetch
          }}
          className="mt-1 text-[10px] text-[var(--brand-gold)] hover:underline"
        >
          {logsLoaded ? "Hide history" : "View history"}
        </button>
      )}
      {logsLoaded && revenueLogs.length > 0 && (
        <div className="mt-2 space-y-1">
          {revenueLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-[6px] border border-[var(--border-subtle)] bg-white p-1.5 text-[10px]"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-emerald-700">
                  {formatRevenueMyr(Number(log.amount))}
                </span>
                <span className="text-[var(--text-muted)]">
                  {formatShortDate(log.created_at)}
                </span>
              </div>
              {log.note && (
                <div className="mt-0.5 truncate text-[var(--text-secondary)]">
                  {log.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
        rows={4}
        className="mt-1 w-full resize-none rounded-[6px] border border-[var(--border-default)] bg-white p-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
      />

      <div className="my-4 border-t border-[var(--border-subtle)]" />

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setPipelineOpen((value) => !value)}
          className="w-full rounded-[6px] border border-[var(--border-default)] px-2 py-1.5 text-left text-[11px] font-medium hover:bg-[var(--surface-subtle)]"
        >
          Move to pipeline →
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
          onClick={() => {
            setRevenueAmount("");
            setRevenueNote("");
            setAttendanceStatus("attended");
            setRevenueOpen(true);
          }}
          className="w-full rounded-[6px] bg-emerald-600 px-2 py-1.5 text-left text-[11px] font-medium text-white hover:bg-emerald-700"
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
          <div className="w-[300px] rounded-[8px] border border-[var(--border-default)] bg-white p-4 shadow-lg">
            <h3 className="text-[13px] font-semibold">Log visit outcome</h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{contact.full_name}</p>
            <div className="mt-3 space-y-3">
              <div className="flex gap-3 text-[12px]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={attendanceStatus === "attended"}
                    onChange={() => setAttendanceStatus("attended")}
                  />
                  Attended
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={attendanceStatus === "no_show"}
                    onChange={() => setAttendanceStatus("no_show")}
                  />
                  No-show
                </label>
              </div>

              {attendanceStatus === "attended" && (
                <>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-hint)]">
                      REVENUE (RM) — optional
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={revenueAmount}
                      onChange={(event) => setRevenueAmount(event.target.value)}
                      placeholder="e.g. 1500"
                      className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 text-[12px] outline-none focus:border-[var(--brand-gold-border)]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[var(--text-hint)]">
                      NOTE — optional
                    </label>
                    <input
                      type="text"
                      value={revenueNote}
                      onChange={(event) => setRevenueNote(event.target.value)}
                      placeholder="e.g. Braces fitting, scaling"
                      className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 text-[12px] outline-none focus:border-[var(--brand-gold-border)]"
                    />
                  </div>
                </>
              )}
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
                disabled={saving}
                onClick={() => void saveRevenue()}
                className="rounded-[6px] bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
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
