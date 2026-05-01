import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { WaBanner } from "@/components/layout/WaBanner";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, membership } = await requireMembership();

  if (membership.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-base)] p-8">
        <div className="max-w-md rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-raised)] p-8 text-center">
          <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">
            Access disabled
          </h1>
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            Your workspace access has been disabled. Contact your clinic admin to restore access.
          </p>
        </div>
      </div>
    );
  }

  if (membership.status === "invited") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-base)] p-8">
        <div className="max-w-md rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-raised)] p-8 text-center">
          <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">
            Activating workspace
          </h1>
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            Sign in again once the invite has been activated.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: clinic }, { count: unreadCount }] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, whatsapp_status")
      .eq("id", membership.clinic_id)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", membership.clinic_id)
      .gt("unread_count", 0),
  ]);

  const whatsappStatus =
    (clinic?.whatsapp_status as string | null | undefined) ??
    membership.whatsapp_status ??
    "not_connected";

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--surface-base)] text-[var(--text-primary)]">
      <Sidebar
        clinicId={membership.clinic_id}
        unreadCount={unreadCount ?? 0}
        whatsappStatus={whatsappStatus}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <WaBanner whatsappStatus={whatsappStatus} />
        <Topbar />
        {children}
      </main>
    </div>
  );
}
