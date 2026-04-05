import { NextResponse } from "next/server";

import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";

export async function POST(
  _req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { contactId } = await context.params;

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, clinic_id")
    .eq("id", contactId)
    .maybeSingle();

  if (contactError || !contact || contact.clinic_id !== membership.clinic_id) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const writer = createAdminClient() ?? supabase;

  try {
    await enqueueContactMemoryJob(writer, {
      clinicId: membership.clinic_id,
      contactId,
      triggerSource: "manual_refresh",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: isContactMemorySchemaMismatchError(error)
          ? "Apply the latest supabase-schema.sql to enable lead memory."
          : error instanceof Error
            ? error.message
            : "Failed to queue lead memory refresh.",
      },
      { status: 500 }
    );
  }
}
