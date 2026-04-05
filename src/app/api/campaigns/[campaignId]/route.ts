import { NextResponse } from "next/server";

import {
  cancelBroadcastCampaign,
  isBroadcastSchemaMismatchError,
} from "@/lib/server/campaigns";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ campaignId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { campaignId } = await context.params;

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to cancel campaigns." },
      { status: 403 }
    );
  }

  const writer = createAdminClient() ?? supabase;

  try {
    const campaign = await cancelBroadcastCampaign(writer, {
      clinicId: membership.clinic_id,
      campaignId,
    });

    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json(
      {
        error: isBroadcastSchemaMismatchError(error)
          ? "Apply the latest supabase-schema.sql to manage broadcast campaigns."
          : error instanceof Error
            ? error.message
            : "Failed to cancel the campaign.",
      },
      { status: 500 }
    );
  }
}
