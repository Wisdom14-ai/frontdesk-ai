import { NextResponse } from "next/server";

import {
  getBroadcastCampaignDetail,
  isBroadcastSchemaMismatchError,
} from "@/lib/server/campaigns";
import { requireMembership } from "@/lib/server/auth";

export async function GET(
  _req: Request,
  context: { params: Promise<{ campaignId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { campaignId } = await context.params;

  try {
    const detail = await getBroadcastCampaignDetail(supabase, {
      clinicId: membership.clinic_id,
      campaignId,
    });

    if (!detail) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    if (isBroadcastSchemaMismatchError(error)) {
      return NextResponse.json(
        {
          error:
            "Apply the latest supabase-schema.sql to enable campaign analytics.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load campaign analytics.",
      },
      { status: 500 }
    );
  }
}
