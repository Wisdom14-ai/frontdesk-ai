import { NextResponse } from "next/server";

import {
  createBroadcastCampaign,
  getBroadcastCampaignListPayload,
  isBroadcastSchemaMismatchError,
  runDueBroadcastCampaignJobs,
} from "@/lib/server/campaigns";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { hasCampaignRunnerProtection } from "@/lib/server/runner-auth";
import { createAdminClient, hasAdminClientConfig } from "@/lib/supabase/admin";
import type { BroadcastCampaignCreatePayload } from "@/types";

function buildSchemaErrorMessage() {
  return "Apply the latest supabase-schema.sql to manage broadcast campaigns.";
}

export async function GET() {
  const { supabase, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage campaigns." },
      { status: 403 }
    );
  }

  try {
    const payload = await getBroadcastCampaignListPayload(
      supabase,
      membership.clinic_id,
      {
        serviceRoleConfigured: hasAdminClientConfig(),
        runnerSecretConfigured: hasCampaignRunnerProtection(),
        canManageCampaigns: true,
      }
    );

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: isBroadcastSchemaMismatchError(error)
          ? buildSchemaErrorMessage()
          : "Failed to load broadcast campaigns.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { supabase, user, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to create broadcast campaigns." },
      { status: 403 }
    );
  }

  const body = (await req.json()) as BroadcastCampaignCreatePayload;
  const writer = createAdminClient() ?? supabase;

  try {
    const campaignId = await createBroadcastCampaign(writer, {
      ...body,
      clinicId: membership.clinic_id,
      createdByUserId: user.id,
      createdByName: membership.full_name,
    });

    let summary = null;
    if (body.delivery_type === "send_now") {
      summary = await runDueBroadcastCampaignJobs({
        client: writer,
        clinicId: membership.clinic_id,
        campaignId,
        triggerSource: "manual",
        requestedByUserId: user.id,
        limit: Math.max(100, Math.round(body.daily_send_cap || 1)),
      });
    }

    const payload = await getBroadcastCampaignListPayload(
      supabase,
      membership.clinic_id,
      {
        serviceRoleConfigured: hasAdminClientConfig(),
        runnerSecretConfigured: hasCampaignRunnerProtection(),
        canManageCampaigns: true,
      }
    );

    return NextResponse.json({
      ...payload,
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: isBroadcastSchemaMismatchError(error)
          ? buildSchemaErrorMessage()
          : error instanceof Error
            ? error.message
            : "Failed to create the broadcast campaign.",
      },
      { status: 500 }
    );
  }
}
