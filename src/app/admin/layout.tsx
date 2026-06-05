import { redirect } from "next/navigation";

import { getAgencyAdminState } from "@/lib/server/auth";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const auth = await getAgencyAdminState();

  if (!auth.user) {
    redirect("/login");
  }

  if (!auth.isAgencyAdmin) {
    redirect("/settings");
  }

  return children;
}
