import { NextResponse } from "next/server";

import { cancelPendingAutomationJobs } from "@/lib/server/automation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";

export async function POST(req: Request) {
  const { supabase, membership } = await requireMembership();
  const { contactId, amount, note } = (await req.json()) as {
    contactId?: string;
    amount?: number;
    note?: string;
  };

  if (!contactId || typeof amount !== "number" || Number.isNaN(amount) || amount < 0) {
    return NextResponse.json({ error: "A valid contact and revenue amount are required." }, { status: 400 });
  }

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, clinic_id, current_status")
    .eq("id", contactId)
    .single();

  if (contactError || !contact || contact.clinic_id !== membership.clinic_id) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const writer = createAdminClient() ?? supabase;
  const previousStatus = contact.current_status as string;

  const { error: statusError } = await writer
    .from("contacts")
    .update({
      current_status: "attended",
      attendance_status: "attended",
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .eq("clinic_id", membership.clinic_id);

  if (statusError) {
    return NextResponse.json({ error: "Failed to mark the lead as attended." }, { status: 500 });
  }

  const { error: revenueError } = await writer.from("revenue_logs").insert({
    clinic_id: membership.clinic_id,
    contact_id: contactId,
    amount,
    note: note?.trim() || null,
  });

  if (revenueError) {
    await writer
      .from("contacts")
      .update({ current_status: previousStatus })
      .eq("id", contactId)
      .eq("clinic_id", membership.clinic_id);

    return NextResponse.json({ error: "Failed to log revenue." }, { status: 500 });
  }

  const admin = createAdminClient();
  if (admin) {
    await cancelPendingAutomationJobs(admin, membership.clinic_id, contactId, "revenue_logged_attended");
  }

  return NextResponse.json({ success: true });
}
