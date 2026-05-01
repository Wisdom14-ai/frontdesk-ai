import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";
import { runDueBroadcastCampaignJobs } from "@/lib/server/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
  context: { params: Promise<{ campaignId: string }> }
) {
  const { supabase, user, membership } = await requireMembership();
  const { campaignId } = await context.params;
  const writer = createAdminClient() ?? supabase;
  const nowIso = new Date().toISOString();

  const { data, error } = await writer
    .from("broadcast_campaigns")
    .update({
      status: "running",
      scheduled_for: nowIso,
      started_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", campaignId)
    .eq("clinic_id", membership.clinic_id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  await writer
    .from("broadcast_campaign_jobs")
    .update({
      scheduled_for: nowIso,
      updated_at: nowIso,
    })
    .eq("campaign_id", campaignId)
    .eq("clinic_id", membership.clinic_id)
    .eq("status", "pending");

  const summary = await runDueBroadcastCampaignJobs({
    client: writer,
    clinicId: membership.clinic_id,
    campaignId,
    triggerSource: "manual",
    requestedByUserId: user.id,
    limit: 100,
  });

  return NextResponse.json({ success: true, summary });
}
