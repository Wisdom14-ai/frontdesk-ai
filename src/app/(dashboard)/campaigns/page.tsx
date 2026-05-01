import { CampaignsScreen } from "@/components/campaigns/CampaignsScreen";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { membership } = await requireMembership();

  return <CampaignsScreen clinicId={membership.clinic_id} />;
}
