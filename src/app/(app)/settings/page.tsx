"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CreditCard,
  Loader2,
  MessageSquareCode,
  UserPlus,
  Users2,
} from "lucide-react";

import { ClinicWhatsappConnectionCard } from "@/components/whatsapp/ClinicWhatsappConnectionCard";
import {
  inviteStaffMember,
  updateClinic,
  updateStaffMember,
  useClinic,
  useStaff,
} from "@/lib/supabase/hooks";
import {
  CLINIC_TYPE_LABELS,
  PLAN_DEFINITIONS,
  SUBSCRIPTION_STATUS_LABELS,
} from "@/lib/plans";
import type { StaffRole } from "@/types";

function buildSupportUrl(number?: string | null) {
  if (!number) {
    return null;
  }

  const sanitized = number.replace(/[^\d+]/g, "");
  return `https://wa.me/${sanitized.replace(/^\+/, "")}`;
}

export default function SettingsPage() {
  const { clinic, loading, setClinic } = useClinic();
  const {
    staff,
    loading: staffLoading,
    fetchStaff,
    serviceRoleConfigured,
  } = useStaff();

  const [clinicName, setClinicName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [clinicPrompt, setClinicPrompt] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [staffActionId, setStaffActionId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, StaffRole>>({});

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("receptionist");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [promptMessage, setPromptMessage] = useState("");

  useEffect(() => {
    if (!clinic) {
      return;
    }

    setClinicName(clinic.name || "");
    setOwnerName(clinic.owner_name || "");
    setOwnerPhone(clinic.owner_phone || "");
    setClinicPrompt(clinic.clinic_prompt || "");
  }, [clinic]);

  useEffect(() => {
    setRoleDrafts(
      Object.fromEntries(staff.map((member) => [member.id, member.role]))
    );
  }, [staff]);

  const plan = clinic ? PLAN_DEFINITIONS[clinic.plan_type] : null;
  const supportUrl = useMemo(
    () => buildSupportUrl(clinic?.support_whatsapp_number),
    [clinic?.support_whatsapp_number]
  );

  const handleSaveProfile = async () => {
    if (!clinic || !clinicName.trim()) {
      return;
    }

    setSavingProfile(true);
    setWorkspaceMessage("");
    const result = await updateClinic(clinic.id, {
      name: clinicName.trim(),
      owner_name: ownerName.trim() || "",
      owner_phone: ownerPhone.trim() || "",
    });

    if (result.success && result.clinic) {
      setClinic(result.clinic);
      setWorkspaceMessage("Workspace details updated.");
    } else {
      setWorkspaceMessage(result.error || "Failed to update workspace.");
    }

    setSavingProfile(false);
  };

  const handleSavePrompt = async () => {
    if (!clinic) {
      return;
    }

    setSavingPrompt(true);
    setPromptMessage("");
    const result = await updateClinic(clinic.id, {
      clinic_prompt: clinicPrompt,
    });

    if (result.success && result.clinic) {
      setClinic(result.clinic);
      setPromptMessage("Clinic AI prompt saved.");
    } else {
      setPromptMessage(result.error || "Failed to save the clinic AI prompt.");
    }

    setSavingPrompt(false);
  };

  const handleInviteStaff = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) {
      return;
    }

    setInviting(true);
    setInviteError("");
    setInviteSuccess("");

    const result = await inviteStaffMember({
      email: inviteEmail.trim(),
      full_name: inviteName.trim(),
      role: inviteRole,
    });

    if ("error" in result) {
      setInviteError(result.error || "Failed to invite user.");
    } else {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("receptionist");
      setInviteSuccess("Invite sent. Pending users will appear below.");
      await fetchStaff();
    }

    setInviting(false);
  };

  const handleStaffAction = async (
    staffId: string,
    action: "update_role" | "disable" | "activate" | "resend_invite"
  ) => {
    setStaffActionId(staffId);

    const payload =
      action === "update_role"
        ? { action, role: roleDrafts[staffId] }
        : { action };

    const result = await updateStaffMember(staffId, payload as {
      action: "update_role" | "disable" | "activate" | "resend_invite";
      role?: StaffRole;
    });

    if ("error" in result) {
      setInviteError(result.error || "Failed to update staff member.");
    } else {
      await fetchStaff();
    }

    setStaffActionId(null);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the clinic profile, subscription status, AI prompt, WhatsApp connection, and staff access.
        </p>
      </div>

      <div className="max-w-6xl space-y-6 px-8 pb-8">
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
            <div className="border-b border-border/40 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                  <Building2 className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">Clinic Workspace</h2>
                  <p className="text-sm text-muted-foreground">
                    Core details used across the CRM and by Super Admin.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-6 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Clinic Name
                </label>
                <input
                  type="text"
                  value={clinicName}
                  onChange={(event) => setClinicName(event.target.value)}
                  disabled={loading}
                  className="h-11 w-full rounded-lg border border-border bg-background px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Clinic Type
                </label>
                <div className="flex h-11 items-center rounded-lg border border-border bg-muted/20 px-4 text-sm text-foreground">
                  {clinic ? CLINIC_TYPE_LABELS[clinic.clinic_type] : "Loading..."}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Owner Name
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  disabled={loading}
                  className="h-11 w-full rounded-lg border border-border bg-background px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Owner Phone
                </label>
                <input
                  type="text"
                  value={ownerPhone}
                  onChange={(event) => setOwnerPhone(event.target.value)}
                  disabled={loading}
                  placeholder="+60123456789"
                  className="h-11 w-full rounded-lg border border-border bg-background px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                {workspaceMessage ? (
                  <div className="mb-3 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {workspaceMessage}
                  </div>
                ) : null}
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile || loading}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-500 px-6 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
                >
                  {savingProfile ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save Workspace"
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
            <div className="border-b border-border/40 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                  <CreditCard className="h-5 w-5 text-violet-500" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">Subscription</h2>
                  <p className="text-sm text-muted-foreground">
                    View plan, usage, and activation state.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 p-6">
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {plan?.label ?? "Starter"} Plan
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      RM {plan?.priceMyr ?? 89} / month
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Status
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {clinic
                        ? SUBSCRIPTION_STATUS_LABELS[clinic.subscription_status]
                        : "Loading..."}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Payment state: {clinic?.payment_status === "received" ? "Received" : "Pending activation"}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Contact Usage
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {clinic?.usage.active_contacts ?? 0}
                    <span className="text-base font-medium text-muted-foreground">
                      {" "}
                      / {clinic?.usage.contact_limit ?? 0}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Contacts in Trash do not count. Patients still count toward the plan limit.
                  </p>
                </div>

                <div className="rounded-xl border border-border/60 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Monthly Sent Messages
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {clinic?.usage.monthly_outbound_messages ?? 0}
                    <span className="text-base font-medium text-muted-foreground">
                      {" "}
                      / {clinic?.usage.monthly_message_limit ?? 0}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resets on your billing cycle date. Outbound sends are blocked once the limit is reached.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 p-4">
                <p className="text-sm font-medium text-foreground">
                  Need to upgrade or downgrade?
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Plans are changed manually. Contact admin on WhatsApp to request a plan change.
                </p>
                {supportUrl ? (
                  <a
                    href={supportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    Contact Admin on WhatsApp
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <ClinicWhatsappConnectionCard
          title="Clinic WhatsApp Connection"
          description="Clinics never need to configure API keys or automation URLs. This section only handles the QR-based WhatsApp connection."
        />

        <section className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="border-b border-border/40 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10">
                <MessageSquareCode className="h-5 w-5 text-sky-500" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Clinic AI Prompt</h2>
                <p className="text-sm text-muted-foreground">
                  This prompt guides WhatsApp replies, booking nudges, and handoff judgement.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <textarea
              value={clinicPrompt}
              onChange={(event) => setClinicPrompt(event.target.value)}
              rows={8}
              placeholder="Example: You are the WhatsApp front desk for our clinic. Be concise, reassuring, and focus on getting the patient to share their concern and preferred booking time."
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={handleSavePrompt}
                disabled={savingPrompt}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-500 px-6 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                {savingPrompt ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save AI Prompt"
                )}
              </button>
              {promptMessage ? (
                <p className="text-sm text-muted-foreground">{promptMessage}</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="border-b border-border/40 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                <Users2 className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Staff Management</h2>
                <p className="text-sm text-muted-foreground">
                  Invite, change roles, resend invites, and disable access.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6">
            <div>
              <h3 className="mb-3 text-sm font-medium text-foreground">Current Team</h3>
              {staffLoading ? (
                <p className="animate-pulse text-sm text-muted-foreground">Loading staff...</p>
              ) : staff.length === 0 ? (
                <p className="text-sm text-muted-foreground">No staff members found.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Email</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {staff.map((member) => (
                        <tr key={member.id}>
                          <td className="px-4 py-3 font-medium text-foreground">{member.full_name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                          <td className="px-4 py-3">
                            <select
                              value={roleDrafts[member.id] ?? member.role}
                              onChange={(event) =>
                                setRoleDrafts((current) => ({
                                  ...current,
                                  [member.id]: event.target.value as StaffRole,
                                }))
                              }
                              className="h-9 rounded-lg border border-border bg-background px-3"
                            >
                              <option value="receptionist">Receptionist</option>
                              <option value="manager">Manager</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize text-foreground">
                              {member.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="text-xs font-medium text-violet-600 hover:underline"
                                disabled={staffActionId === member.id}
                                onClick={() => void handleStaffAction(member.id, "update_role")}
                              >
                                Save role
                              </button>
                              {member.status === "invited" && (
                                <button
                                  className={`text-xs font-medium ${
                                    serviceRoleConfigured
                                      ? "text-sky-600 hover:underline"
                                      : "cursor-not-allowed text-muted-foreground"
                                  }`}
                                  disabled={staffActionId === member.id || !serviceRoleConfigured}
                                  onClick={() => void handleStaffAction(member.id, "resend_invite")}
                                >
                                  Resend invite
                                </button>
                              )}
                              {member.status === "disabled" ? (
                                <button
                                  className="text-xs font-medium text-emerald-600 hover:underline"
                                  disabled={staffActionId === member.id}
                                  onClick={() => void handleStaffAction(member.id, "activate")}
                                >
                                  Re-activate
                                </button>
                              ) : (
                                <button
                                  className="text-xs font-medium text-rose-600 hover:underline"
                                  disabled={staffActionId === member.id}
                                  onClick={() => void handleStaffAction(member.id, "disable")}
                                >
                                  Disable
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="border-t border-border/40 pt-4">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <UserPlus className="h-4 w-4" /> Invite New Member
              </h3>
              {!serviceRoleConfigured && (
                <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  Staff invites and invite resends need `SUPABASE_SERVICE_ROLE_KEY`.
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  disabled={!serviceRoleConfigured}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  disabled={!serviceRoleConfigured}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 md:col-span-2"
                />
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as StaffRole)}
                  disabled={!serviceRoleConfigured}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="receptionist">Receptionist</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {inviteError && <p className="mt-2 text-xs text-rose-500">{inviteError}</p>}
              {inviteSuccess && <p className="mt-2 text-xs text-emerald-600">{inviteSuccess}</p>}
              <button
                onClick={handleInviteStaff}
                disabled={inviting || !inviteEmail || !inviteName || !serviceRoleConfigured}
                className="mt-4 inline-flex h-10 min-w-[120px] items-center justify-center rounded-lg bg-violet-500 px-6 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
              >
                {inviting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : serviceRoleConfigured ? (
                  "Send Invite"
                ) : (
                  "Service Role Required"
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
