import { NextResponse } from "next/server";

import {
  isCrmSchemaMismatchError,
} from "@/lib/crm-data";
import { requireMembership } from "@/lib/server/auth";
import { listMessagesForContact } from "@/lib/server/messages";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { contactId } = await context.params;

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, clinic_id")
    .eq("id", contactId)
    .single();

  if (contactError || !contact || contact.clinic_id !== membership.clinic_id) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  try {
    const messages = await listMessagesForContact(supabase, {
      clinicId: membership.clinic_id,
      contactId,
      order: "asc",
    });

    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json(
      {
        error: isCrmSchemaMismatchError(error)
          ? "Apply the latest supabase-schema.sql to load the CRM data model."
          : "Failed to load messages.",
      },
      { status: 500 }
    );
  }
}
