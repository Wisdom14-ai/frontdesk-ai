import { NextResponse } from "next/server";

import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { runDueAutomationJobs } from "@/lib/server/automation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const { user, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to run automations manually." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required to run automations manually." },
      { status: 503 }
    );
  }

  try {
    const summary = await runDueAutomationJobs({
      admin,
      clinicId: membership.clinic_id,
      triggerSource: "manual",
      requestedByUserId: user.id,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to run due automations.",
      },
      { status: 500 }
    );
  }
}
