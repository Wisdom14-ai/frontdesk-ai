import { NextResponse } from "next/server";

import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { runDueBroadcastCampaignJobs } from "@/lib/server/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const { supabase, user, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to run campaigns manually." },
      { status: 403 }
    );
  }

  const writer = createAdminClient() ?? supabase;

  try {
    const summary = await runDueBroadcastCampaignJobs({
      client: writer,
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
            : "Failed to run due campaigns.",
      },
      { status: 500 }
    );
  }
}
