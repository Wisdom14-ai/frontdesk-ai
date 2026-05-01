import { InboxScreen } from "@/components/inbox/InboxScreen";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ contact_id?: string }>;
}) {
  const { membership } = await requireMembership();
  const params = await searchParams;

  return (
    <InboxScreen
      clinicId={membership.clinic_id}
      initialContactId={params.contact_id ?? null}
    />
  );
}
