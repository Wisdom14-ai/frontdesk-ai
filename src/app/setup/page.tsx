import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";

import { FrontdeskLogo } from "@/components/brand/FrontdeskLogo";
import { CLINIC_TYPE_LABELS, PLAN_DEFINITIONS } from "@/lib/plans";
import { getCurrentMembership } from "@/lib/server/auth";

import { completeSetup } from "./actions";
import { signOut } from "../login/actions";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const context = await getCurrentMembership({ attemptBootstrap: true });

  if (!context.user) {
    redirect("/login");
  }

  if (context.membership) {
    redirect("/inbox");
  }

  const error = params.error ? decodeURIComponent(params.error) : "";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_32%),linear-gradient(135deg,_var(--background),_oklch(0.975_0.01_210))]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-12 lg:flex-row lg:items-center lg:gap-12">
        <section className="max-w-xl rounded-[2rem] border border-white/40 bg-white/55 p-8 shadow-xl shadow-emerald-900/5 backdrop-blur md:p-10">
          <div className="mb-8">
            <FrontdeskLogo
              showTagline={false}
              markClassName="h-12 w-12"
              nameClassName="text-lg font-semibold text-foreground"
            />
            <h1 className="mt-5 text-3xl font-semibold text-foreground">
              Finish your workspace setup
            </h1>
          </div>

          <p className="max-w-lg text-sm leading-6 text-muted-foreground">
            Your Supabase account exists, but this clinic workspace still needs a membership record.
            Add the clinic details once and the app will route you straight into the CRM after this.
          </p>

          <div className="mt-8 grid gap-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-4">
              <Building2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              <div>
                <p className="font-medium text-foreground">Signed in as {context.user.email}</p>
                <p className="mt-1">
                  This setup creates your clinic row and links your account as the first admin.
                </p>
              </div>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Sign out
              </button>
            </form>
          </div>
        </section>

        <section className="mt-8 w-full max-w-lg rounded-[2rem] border border-border/60 bg-card p-8 shadow-2xl shadow-emerald-900/10 md:p-10 lg:mt-0">
          <div className="mb-8">
            <p className="text-sm font-medium text-emerald-700">Workspace Recovery</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Create the missing membership
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This form writes the `clinics` and `users` records that the CRM expects.
            </p>
          </div>

          {error ? (
            <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <form action={completeSetup} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="fullName" className="block text-sm font-medium text-foreground">
                Full Name
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                defaultValue={context.bootstrapProfile?.full_name ?? ""}
                placeholder="Dr. Sarah Jenkins"
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="clinicName" className="block text-sm font-medium text-foreground">
                Clinic Name
              </label>
              <input
                id="clinicName"
                name="clinicName"
                type="text"
                required
                defaultValue={context.bootstrapProfile?.clinic_name ?? ""}
                placeholder="Bright Smile Dental"
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="clinicType" className="block text-sm font-medium text-foreground">
                Clinic Type
              </label>
              <select
                id="clinicType"
                name="clinicType"
                required
                defaultValue={context.bootstrapProfile?.clinic_type ?? "dental"}
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {Object.entries(CLINIC_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="planType" className="block text-sm font-medium text-foreground">
                Plan
              </label>
              <select
                id="planType"
                name="planType"
                required
                defaultValue={context.bootstrapProfile?.plan_type ?? "starter"}
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {Object.entries(PLAN_DEFINITIONS).map(([value, plan]) => (
                  <option key={value} value={value}>
                    {plan.label} - RM {plan.priceMyr}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
            >
              Finish Setup
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
