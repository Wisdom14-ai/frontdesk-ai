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
    .select("id, clinic_id, current_status, revenue_generated_myr")
    .eq("id", contactId)
    .single();

  if (contactError || !contact || contact.clinic_id !== membership.clinic_id) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const writer = createAdminClient() ?? supabase;
  const previousStatus = contact.current_status as string;
  const existingRevenue = Number(contact.revenue_generated_myr ?? 0) || 0;
  const nowIso = new Date().toISOString();

  // Update status + denormalize revenue total onto the contact
  const contactUpdate: Record<string, unknown> = {
    // Canonical pipeline status (the board's "Attended" column normalizes to this).
    current_status: "attended_visit",
    attendance_status: "attended",
    updated_at: nowIso,
  };
  if (amount > 0) {
    contactUpdate.revenue_generated_myr = existingRevenue + amount;
  }

  const { error: statusError } = await writer
    .from("contacts")
    .update(contactUpdate)
    .eq("id", contactId)
    .eq("clinic_id", membership.clinic_id);

  if (statusError) {
    // Gracefully fall back if revenue_generated_myr column doesn't exist yet
    const isSchemaError =
      statusError &&
      ["42703", "PGRST204", "PGRST205"].includes(
        String((statusError as { code?: unknown }).code)
      );
    if (isSchemaError && "revenue_generated_myr" in contactUpdate) {
      const { error: fallbackError } = await writer
        .from("contacts")
        .update({
          current_status: "attended_visit",
          attendance_status: "attended",
          updated_at: nowIso,
        })
        .eq("id", contactId)
        .eq("clinic_id", membership.clinic_id);
      if (fallbackError) {
        return NextResponse.json({ error: "Failed to mark the lead as attended." }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: "Failed to mark the lead as attended." }, { status: 500 });
    }
  }

  const { error: revenueError } = await writer.from("revenue_logs").insert({
    clinic_id: membership.clinic_id,
    contact_id: contactId,
    amount,
    note: note?.trim() || null,
    created_at: nowIso,
    updated_at: nowIso,
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
