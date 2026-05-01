"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { StaffUser } from "@/types/app.types";

export function TeamTab() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffUser["role"]>("receptionist");

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

  async function invite() {
    await fetch("/api/staff/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email, role }),
    });
    setInviteOpen(false);
    setFullName("");
    setEmail("");
    setRole("receptionist");
    await loadStaff();
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
              <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-secondary)]">
                {member.role}
              </span>
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
          <div className="w-[340px] rounded-[8px] border border-[var(--border-default)] bg-white p-4">
            <h3 className="text-[13px] font-semibold">Invite staff</h3>
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
              <select value={role} onChange={(event) => setRole(event.target.value as StaffUser["role"])} className="fd-input">
                <option value="receptionist">Receptionist</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-[6px] border border-[var(--border-default)] px-3 py-1.5 text-[11px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void invite()}
                disabled={!fullName.trim() || !email.trim()}
                className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
              >
                Send invite
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
