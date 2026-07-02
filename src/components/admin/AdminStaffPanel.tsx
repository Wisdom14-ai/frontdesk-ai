"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { StaffRole, StaffStatus } from "@/types";

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  invited_at: string | null;
  created_at: string;
}

export function AdminStaffPanel({ clinicId }: { clinicId: string }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Invite form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("receptionist");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const base = `/api/admin/clinics/${clinicId}/staff`;

  const loadStaff = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) {
      setStaff([]);
      setLoading(false);
      return;
    }
    const payload = (await res.json()) as { staff: StaffRow[] };
    setStaff(payload.staff);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  async function copyLink(link: string | null | undefined) {
    if (!link) {
      setNotice("No invite link could be generated — check the service role config.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(link);
      setNotice("Invite link copied — send it on WhatsApp.");
      setTimeout(() => setCopiedLink((c) => (c === link ? null : c)), 2500);
    } catch {
      setNotice(link); // fallback: show it so it can be copied manually
    }
  }

  async function invite() {
    setInviteBusy(true);
    setInviteError(null);
    setNotice(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, role }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        invite_link?: string | null;
      };
      if (!res.ok) {
        setInviteError(payload.error ?? "Could not send the invite.");
        return;
      }
      setFullName("");
      setEmail("");
      setRole("receptionist");
      await loadStaff();
      await copyLink(payload.invite_link);
    } finally {
      setInviteBusy(false);
    }
  }

  async function rowAction(
    staffId: string,
    action: "resend_invite" | "disable" | "activate"
  ) {
    setRowBusy(staffId);
    setNotice(null);
    try {
      const res = await fetch(`${base}/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        invite_link?: string | null;
      };
      if (!res.ok) {
        setNotice(payload.error ?? "Action failed.");
        return;
      }
      if (action === "resend_invite") {
        await copyLink(payload.invite_link);
      }
      await loadStaff();
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(staffId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this clinic? This cannot be undone.`)) {
      return;
    }
    setRowBusy(staffId);
    setNotice(null);
    try {
      const res = await fetch(`${base}/${staffId}`, { method: "DELETE" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(payload.error ?? "Failed to remove the member.");
        return;
      }
      await loadStaff();
    } finally {
      setRowBusy(null);
    }
  }

  const btn =
    "rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff &amp; access</CardTitle>
        <CardDescription>
          Invite, resend, disable, or remove team members for this clinic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
            {notice}
          </div>
        ) : null}

        {/* Invite form */}
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (unique per clinic)"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="receptionist">receptionist</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="button"
            onClick={() => void invite()}
            disabled={!fullName.trim() || !email.trim() || inviteBusy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {inviteBusy ? "Inviting…" : "Invite"}
          </button>
          {inviteError ? (
            <p className="text-xs text-destructive sm:col-span-4">{inviteError}</p>
          ) : null}
        </div>

        {/* Roster */}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading staff…</p>
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff on this clinic yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {staff.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {member.full_name || "—"}
                    </span>
                    <Badge variant="outline">{member.role}</Badge>
                    {member.status === "invited" ? (
                      <Badge variant="secondary">invited</Badge>
                    ) : null}
                    {member.status === "disabled" ? (
                      <Badge variant="destructive">disabled</Badge>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void rowAction(member.id, "resend_invite")}
                    disabled={rowBusy === member.id}
                    className={btn}
                    title="Resend the email invite and copy a fresh link"
                  >
                    {copiedLink && rowBusy === member.id ? "Copied" : "Copy invite link"}
                  </button>
                  {member.status === "disabled" ? (
                    <button
                      type="button"
                      onClick={() => void rowAction(member.id, "activate")}
                      disabled={rowBusy === member.id}
                      className={btn}
                    >
                      Enable
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void rowAction(member.id, "disable")}
                      disabled={rowBusy === member.id}
                      className={btn}
                    >
                      Disable
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(member.id, member.full_name || member.email)}
                    disabled={rowBusy === member.id}
                    className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
