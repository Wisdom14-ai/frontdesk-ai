import Link from "next/link";
import { CreditCard, MessageSquare, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";

import { FrontdeskLogo } from "@/components/brand/FrontdeskLogo";
import {
  CLINIC_TYPE_LABELS,
  PLAN_DEFINITIONS,
  SUBSCRIPTION_STATUS_LABELS,
  getWorkspaceAccessState,
} from "@/lib/plans";
import { getClinicLifecycleMessage } from "@/lib/server/clinic";
import { requireMembership } from "@/lib/server/auth";
import { getSupportWhatsappNumber } from "@/lib/server/whatsapp";

export const dynamic = "force-dynamic";

function buildSupportLink(number: string) {
  const sanitized = number.replace(/[^\d+]/g, "");
  return `https://wa.me/${sanitized.replace(/^\+/, "")}`;
}

export default async function ActivatePage() {
  const { membership } = await requireMembership();
  const accessState = getWorkspaceAccessState({
    subscriptionStatus: membership.subscription_status ?? "active",
    paymentStatus: membership.payment_status ?? "pending",
    whatsappStatus: membership.whatsapp_status ?? "not_connected",
  });

  if (accessState === "ready") {
    redirect("/");
  }

  if (accessState === "connect_whatsapp") {
    redirect("/connect-whatsapp");
  }

  const lifecycle = getClinicLifecycleMessage(
    accessState,
    membership.subscription_status ?? "active"
  );
  const plan = PLAN_DEFINITIONS[membership.plan_type ?? "starter"];
  const supportWhatsapp = getSupportWhatsappNumber();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_32%),linear-gradient(135deg,_var(--background),_oklch(0.975_0.01_210))] px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[2rem] border border-white/40 bg-white/60 p-8 shadow-xl shadow-emerald-900/5 backdrop-blur md:p-10">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
                {accessState === "awaiting_payment" ? (
                  <CreditCard className="h-7 w-7" />
                ) : (
                  <ShieldAlert className="h-7 w-7" />
                )}
              </div>
              <div>
                <FrontdeskLogo
                  showTagline={false}
                  markClassName="h-10 w-10"
                  nameClassName="text-base font-semibold text-foreground"
                />
                <h1 className="mt-4 text-3xl font-semibold text-foreground">
                  {lifecycle.title}
                </h1>
              </div>
            </div>

            <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">
              {lifecycle.description}
            </p>

            <div className="mt-8 grid gap-4 text-sm">
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Current Plan
                </p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {plan.label} - RM {plan.priceMyr} / month
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.contactLimit.toLocaleString()} contacts and{" "}
                  {plan.monthlyMessageLimit.toLocaleString()} sent messages per billing cycle.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Subscription Status
                </p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {SUBSCRIPTION_STATUS_LABELS[membership.subscription_status ?? "active"]}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Clinic type:{" "}
                  {membership.clinic_type
                    ? CLINIC_TYPE_LABELS[membership.clinic_type]
                    : "Not set"}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-border/60 bg-card p-8 shadow-2xl shadow-emerald-900/10 md:p-10">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                <MessageSquare className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-700">Next Step</p>
                <h2 className="text-2xl font-semibold text-foreground">
                  Contact support to unlock the workspace
                </h2>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <p className="text-sm font-medium text-foreground">What happens next</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Once payment is marked received, the clinic team will be sent to the WhatsApp QR connection step automatically.
                </p>
              </div>

              {supportWhatsapp ? (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href={buildSupportLink(supportWhatsapp)}
                    target="_blank"
                    className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
                  >
                    Contact Admin on WhatsApp
                  </Link>
                  <Link
                    href="/"
                    className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    Continue to CRM
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Add `SUPPORT_WHATSAPP_NUMBER` to show the clinic contact button here.
                  </div>
                  <Link
                    href="/"
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    Continue to CRM
                  </Link>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
