import { NextResponse } from "next/server";

import {
  normalizeStaffRole,
  normalizeStaffStatus,
  requireMembership,
} from "@/lib/server/auth";
import { hasAdminClientConfig } from "@/lib/supabase/admin";

export async function GET() {
  const { supabase, membership } = await requireMembership();

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("clinic_id", membership.clinic_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load staff." }, { status: 500 });
  }

  return NextResponse.json({
    staff: (data ?? []).map((member) => {
      const row = member as Record<string, unknown>;

      return {
        id: row.id as string,
        clinic_id: row.clinic_id as string,
        full_name: row.full_name as string,
        email: row.email as string,
        role: normalizeStaffRole(row.role),
        status: normalizeStaffStatus(row),
        invited_at: (row.invited_at as string | null | undefined) ?? null,
        disabled_at: (row.disabled_at as string | null | undefined) ?? null,
        created_at: row.created_at as string,
      };
    }),
    serviceRoleConfigured: hasAdminClientConfig(),
  });
}
