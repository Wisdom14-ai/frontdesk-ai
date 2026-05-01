import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireMembership();

  return <SettingsScreen />;
}
