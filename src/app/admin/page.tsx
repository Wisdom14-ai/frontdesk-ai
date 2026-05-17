import { redirect } from "next/navigation";

import { AdminClinicTable } from "@/components/admin/AdminClinicTable";
import { getAgencyAdminState } from "@/lib/server/auth";
import { getClinicsOverview } from "@/lib/server/admin-analytics";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const state = await getAgencyAdminState();

  if (!state.user) {
    redirect("/login");
  }
  if (!state.isAgencyAdmin) {
    redirect("/settings");
  }

  const admin = createAdminClient();
  if (!admin) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Super admin</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          <code>SUPABASE_SERVICE_ROLE_KEY</code> is not configured on this
          environment, so cross-clinic analytics cannot be loaded.
        </p>
      </main>
    );
  }

  const clinics = await getClinicsOverview(admin);

  return (
    <main className="mx-auto max-w-6xl p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Super admin · Clinics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All tenants across the platform. Last-30-day message and AI spend
          figures.
        </p>
      </header>
      <AdminClinicTable rows={clinics} />
    </main>
  );
}
