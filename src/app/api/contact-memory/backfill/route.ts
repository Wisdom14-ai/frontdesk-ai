import { NextResponse } from "next/server";

import {
  enqueueContactMemoryBackfillJobs,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const { supabase, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to queue lead memory backfill." },
      { status: 403 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  const body = (await req.json().catch(() => ({}))) as {
    refreshExisting?: boolean;
  };

  try {
    const summary = await enqueueContactMemoryBackfillJobs(
      writer,
      membership.clinic_id,
      { includeExisting: body.refreshExisting === true }
    );

    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      {
        error: isContactMemorySchemaMismatchError(error)
          ? "Apply the latest supabase-schema.sql to enable lead memory."
          : error instanceof Error
            ? error.message
            : "Failed to queue lead memory backfill.",
      },
      { status: 500 }
    );
  }
}
