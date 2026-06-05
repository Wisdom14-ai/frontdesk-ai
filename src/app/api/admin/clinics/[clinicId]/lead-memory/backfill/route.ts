import { NextResponse } from "next/server";

import {
  enqueueContactMemoryBackfillJobs,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for super admin actions." },
      { status: 503 }
    );
  }

  const { clinicId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    refreshExisting?: boolean;
  };

  try {
    const summary = await enqueueContactMemoryBackfillJobs(admin, clinicId, {
      includeExisting: body.refreshExisting === true,
    });
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
