"use server";

import { redirect } from "next/navigation";

import { bootstrapMembershipForCurrentUser, getCurrentMembership } from "@/lib/server/auth";

export async function completeSetup(formData: FormData) {
  const context = await getCurrentMembership({ attemptBootstrap: false });

  if (!context.user) {
    redirect("/login");
  }

  if (context.membership) {
    redirect("/inbox");
  }

  const result = await bootstrapMembershipForCurrentUser({
    full_name: String(formData.get("fullName") ?? ""),
    clinic_name: String(formData.get("clinicName") ?? ""),
    clinic_type: String(formData.get("clinicType") ?? "") as
      | "dental"
      | "aesthetic"
      | "gp"
      | "functional_medicine"
      | "physio",
    plan_type: String(formData.get("planType") ?? "") as "starter" | "pro",
  });

  if (!result.success) {
    redirect(
      `/setup?error=${encodeURIComponent(result.error ?? "Failed to create clinic membership.")}`
    );
  }

  redirect("/inbox");
}
