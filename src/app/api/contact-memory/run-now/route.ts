import { NextResponse } from "next/server";

import {
  isContactMemorySchemaMismatchError,
  runDueContactMemoryJobs,
} from "@/lib/server/contact-memory";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const { user, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to run lead memory manually." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required to run lead memory manually." },
      { status: 503 }
    );
  }

  try {
    const summary = await runDueContactMemoryJobs({
      admin,
      clinicId: membership.clinic_id,
      triggerSource: "manual",
      requestedByUserId: user.id,
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
