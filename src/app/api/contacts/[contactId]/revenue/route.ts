import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";

export async function GET(
  _req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { contactId } = await context.params;

  // Verify contact belongs to this clinic
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, clinic_id")
    .eq("id", contactId)
    .single();

  if (contactError || !contact || contact.clinic_id !== membership.clinic_id) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("revenue_logs")
    .select("id, contact_id, amount, note, created_at")
    .eq("clinic_id", membership.clinic_id)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ logs: [] });
  }

  return NextResponse.json({ logs: data ?? [] });
}
