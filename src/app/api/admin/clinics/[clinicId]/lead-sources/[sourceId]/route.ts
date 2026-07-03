import { NextResponse } from "next/server";

import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ clinicId: string; sourceId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { clinicId, sourceId } = await context.params;

  const { error } = await admin
    .from("lead_sources")
    .delete()
    .eq("id", sourceId)
    .eq("clinic_id", clinicId);

  if (error) {
    return NextResponse.json({ error: "Failed to delete the lead source." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
