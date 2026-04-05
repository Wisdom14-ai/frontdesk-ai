import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";

export async function POST(
  _req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { contactId } = await context.params;
  const writer = createAdminClient() ?? supabase;

  const { error } = await writer
    .from("contacts")
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .eq("clinic_id", membership.clinic_id);

  if (error) {
    return NextResponse.json({ error: "Failed to mark the thread as read." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
