import { notFound } from "next/navigation";

import { CampaignDetailScreen } from "@/components/campaigns/CampaignDetailScreen";
import { requireMembership } from "@/lib/server/auth";
import {
  getBroadcastCampaignDetail,
  isBroadcastSchemaMismatchError,
} from "@/lib/server/campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { supabase, membership } = await requireMembership();
  const { campaignId } = await params;

  let detail = null;
  let schemaError: string | null = null;

  try {
    detail = await getBroadcastCampaignDetail(supabase, {
      clinicId: membership.clinic_id,
      campaignId,
    });
  } catch (error) {
    if (isBroadcastSchemaMismatchError(error)) {
      schemaError =
        "Apply the latest supabase-schema.sql to enable campaign analytics.";
    } else {
      throw error;
    }
  }

  if (!detail && !schemaError) {
    notFound();
  }

  return (
    <CampaignDetailScreen
      campaignId={campaignId}
      initialDetail={detail}
      schemaError={schemaError}
    />
  );
}
