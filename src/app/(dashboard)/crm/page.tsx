import { CrmScreen } from "@/components/crm/CrmScreen";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const { membership } = await requireMembership();

  return <CrmScreen clinicId={membership.clinic_id} />;
}
