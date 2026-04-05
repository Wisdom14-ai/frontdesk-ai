import Link from "next/link";

import { Sidebar } from "@/components/layout/Sidebar";
import { requireMembership } from "@/lib/server/auth";
import { getWorkspaceAccessState } from "@/lib/plans";
import { getClinicLifecycleMessage } from "@/lib/server/clinic";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, membership } = await requireMembership();

  if (membership.status === "disabled") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">Access disabled</h1>
          <p className="text-sm text-muted-foreground">
            Your workspace access has been disabled. Contact your clinic admin to restore access.
          </p>
        </div>
      </div>
    );
  }

  if (membership.status === "invited") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">Activating your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Your membership exists, but activation is still pending. Apply the updated SQL helpers and sign in again.
          </p>
        </div>
      </div>
    );
  }

  const workspaceAccessState = getWorkspaceAccessState({
    subscriptionStatus: membership.subscription_status ?? "active",
    paymentStatus: membership.payment_status ?? "pending",
    whatsappStatus: membership.whatsapp_status ?? "not_connected",
  });
  const workspaceLifecycle =
    workspaceAccessState === "ready"
      ? null
      : getClinicLifecycleMessage(
          workspaceAccessState,
          membership.subscription_status ?? "active"
        );
  const workspaceAction =
    workspaceAccessState === "ready"
      ? null
      : workspaceAccessState === "connect_whatsapp"
        ? {
            href: "/connect-whatsapp",
            label: "Open WhatsApp connection",
          }
        : {
            href: "/activate",
            label: "Open workspace status",
          };
  const workspaceBannerTone =
    workspaceAccessState === "connect_whatsapp"
      ? "border-sky-200/80 bg-sky-50/80"
      : workspaceAccessState === "awaiting_payment"
        ? "border-amber-200/80 bg-amber-50/80"
        : "border-rose-200/80 bg-rose-50/80";

  const { data: agencyAdmin } = await supabase
    .from("agency_admins")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        userName={membership.full_name}
        userRole={membership.role}
        clinicName={membership.clinic_name ?? "Frontdesk AI"}
        showAdminLink={Boolean(agencyAdmin)}
      />
      <main className="flex-1 flex min-w-0 flex-col overflow-hidden">
        {workspaceLifecycle ? (
          <div className="border-b border-border/40 px-6 py-4">
            <div
              className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border px-4 py-3 ${workspaceBannerTone}`}
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {workspaceLifecycle.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  {workspaceLifecycle.description}
                </p>
              </div>
              {workspaceAction ? (
                <Link
                  href={workspaceAction.href}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-border/60 bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-background/80"
                >
                  {workspaceAction.label}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
