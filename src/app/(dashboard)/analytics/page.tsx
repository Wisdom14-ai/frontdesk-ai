import { AnalyticsScreen } from "@/components/analytics/AnalyticsScreen";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { membership } = await requireMembership();

  return <AnalyticsScreen clinicId={membership.clinic_id} />;
}
