"use client";

import { Check, Copy, Link2, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { StaffUser } from "@/types/app.types";

export function TeamTab() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffUser["role"]>("receptionist");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function loadStaff() {
    const response = await fetch("/api/staff", { cache: "no-store" });
    if (!response.ok) {
      setStaff([]);
      return;
    }
    const payload = (await response.json()) as { staff: StaffUser[] };
    setStaff(payload.staff);
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  function resetInviteForm() {
    setInviteOpen(false);
    setFullName("");
    setEmail("");
    setRole("receptionist");
    setInviteError(null);
    setInviteLink(null);
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(link);
      setTimeout(() => setCopiedLink((current) => (current === link ? null : current)), 2000);
    } catch {
      // Clipboard may be blocked (insecure context); the link stays visible to copy manually.
    }
  }

  async function invite() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const response = await fetch("/api/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, role }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        invite_link?: string | null;
      };

      if (!response.ok) {
        setInviteError(payload.error ?? "Could not send the invite. Please try again.");
        return;
      }

      await loadStaff();
      // Keep the modal open to show the copyable link — email is best-effort.
      setInviteLink(payload.invite_link ?? null);
      setFullName("");
      setEmail("");
      setRole("receptionist");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteFor(staffId: string) {
    setRowBusy(staffId);
    try {
      const response = await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend_invite" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        invite_link?: string | null;
      };
      if (response.ok && payload.invite_link) {
        await copyLink(payload.invite_link);
      }
      await loadStaff();
    } finally {
      setRowBusy(null);
    }
  }

  async function updateStaff(staffId: string, action: "disable" | "activate") {
    await fetch(`/api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await loadStaff();
  }

  return (
    <section className="max-w-[680px]">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex h-7 items-center gap-1 rounded-[6px] bg-[var(--brand-gold)] px-2.5 text-[11px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Invite staff
        </button>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-white">
        {staff.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#B5D4F4] text-[11px] font-semibold text-[#185FA5]">
                {member.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium">{member.full_name}</div>
                <div className="truncate text-[10px] text-[var(--text-muted)]">{member.email}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {member.status === "invited" ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  Invited
                </span>
              ) : null}
              <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-secondary)]">
                {member.role}
              </span>
              {member.status === "invited" ? (
                <button
                  type="button"
                  onClick={() => void copyInviteFor(member.id)}
                  disabled={rowBusy === member.id}
                  className="flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border-default)] px-2 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
                  title="Copy a fresh invite link to send on WhatsApp"
                >
                  <Link2 className="h-3 w-3" />
                  {rowBusy === member.id ? "…" : "Copy link"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  void updateStaff(member.id, member.status === "disabled" ? "activate" : "disable")
                }
                className="flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--surface-subtle)]"
                aria-label="Staff options"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {inviteOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="w-[360px] rounded-[8px] border border-[var(--border-default)] bg-white p-4">
            {inviteLink !== null ? (
              <>
                <h3 className="text-[13px] font-semibold">Invite sent</h3>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  We emailed an invite, but email can be unreliable. Copy this link and send it
                  to them on WhatsApp — it lets them set a password and sign in.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    onFocus={(event) => event.target.select()}
                    className="fd-input flex-1 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => void copyLink(inviteLink)}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-[6px] bg-[var(--brand-gold)] px-2.5 text-[11px] font-medium text-white"
                  >
                    {copiedLink === inviteLink ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={resetInviteForm}
                    className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-[13px] font-semibold">Invite staff</h3>
                {inviteError ? (
                  <div className="mt-3 rounded-[6px] border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-600">
                    {inviteError}
                  </div>
                ) : null}
                <div className="mt-3 space-y-3">
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Full name"
                    className="fd-input"
                  />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Email"
                    className="fd-input"
                  />
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as StaffUser["role"])}
                    className="fd-input"
                  >
                    <option value="receptionist">Receptionist</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetInviteForm}
                    className="rounded-[6px] border border-[var(--border-default)] px-3 py-1.5 text-[11px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void invite()}
                    disabled={!fullName.trim() || !email.trim() || inviteBusy}
                    className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {inviteBusy ? "Sending…" : "Send invite"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
