import { NextResponse } from "next/server";

import {
  isContactMemorySchemaMismatchError,
  runDueContactMemoryJobs,
} from "@/lib/server/contact-memory";
import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
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

  try {
    const summary = await runDueContactMemoryJobs({
      admin,
      clinicId,
      triggerSource: "manual",
      requestedByUserId: auth.user?.id ?? null,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error: isContactMemorySchemaMismatchError(error)
          ? "Apply the latest supabase-schema.sql to enable lead memory."
          : error instanceof Error
            ? error.message
            : "Failed to run due lead memory jobs.",
      },
      { status: 500 }
    );
  }
}
