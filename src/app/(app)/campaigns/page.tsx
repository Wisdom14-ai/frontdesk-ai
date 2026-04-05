import { CampaignStudio } from "@/components/campaigns/CampaignStudio";
import { canManageStaff, requireMembership } from "@/lib/server/auth";

export default async function CampaignsPage() {
  const { membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return (
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-2xl rounded-2xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold text-foreground">Campaigns</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Only admins and managers can create or schedule broadcast campaigns.
            Ask a clinic admin if you need access.
          </p>
        </div>
      </div>
    );
  }

  return <CampaignStudio />;
}
