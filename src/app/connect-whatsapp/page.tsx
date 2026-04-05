import Link from "next/link";
import { MessageSquare, Smartphone } from "lucide-react";
import { redirect } from "next/navigation";

import { FrontdeskLogo } from "@/components/brand/FrontdeskLogo";
import { ClinicWhatsappConnectionCard } from "@/components/whatsapp/ClinicWhatsappConnectionCard";
import { getWorkspaceAccessState } from "@/lib/plans";
import { requireMembership } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function ConnectWhatsappPage() {
  const { membership } = await requireMembership();
  const accessState = getWorkspaceAccessState({
    subscriptionStatus: membership.subscription_status ?? "active",
    paymentStatus: membership.payment_status ?? "pending",
    whatsappStatus: membership.whatsapp_status ?? "not_connected",
  });

  if (accessState === "ready") {
    redirect("/");
  }

  if (accessState === "awaiting_payment" || accessState === "subscription_locked") {
    redirect("/activate");
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_32%),linear-gradient(135deg,_var(--background),_oklch(0.975_0.01_210))] px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 rounded-[2rem] border border-white/40 bg-white/60 p-8 shadow-xl shadow-emerald-900/5 backdrop-blur md:p-10">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
              <Smartphone className="h-7 w-7" />
            </div>
            <div className="max-w-2xl">
              <FrontdeskLogo
                showTagline={false}
                markClassName="h-10 w-10"
                nameClassName="text-base font-semibold text-foreground"
              />
              <h1 className="mt-4 text-3xl font-semibold text-foreground">
                Connect the clinic WhatsApp
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Scan the QR code with the clinic phone. As soon as the connection opens, the CRM will unlock automatically.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 text-sm md:grid-cols-3">
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <p className="font-medium text-foreground">1. Open WhatsApp</p>
              <p className="mt-2 text-muted-foreground">
                Use the clinic phone that will own this shared inbox.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <p className="font-medium text-foreground">2. Scan QR</p>
              <p className="mt-2 text-muted-foreground">
                Go to Linked Devices in WhatsApp and scan the code shown below.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <p className="font-medium text-foreground">3. Start using the CRM</p>
              <p className="mt-2 text-muted-foreground">
                Once connected, messages and automation can start flowing immediately.
              </p>
            </div>
          </div>
        </div>

        <ClinicWhatsappConnectionCard
          title="WhatsApp QR Connection"
          description="No API keys or backend setup are needed from the clinic. This page only handles the QR scan."
          redirectOnConnected="/"
        />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
          >
            Continue to CRM
          </Link>
          <p className="text-sm text-muted-foreground">
            You can reconnect the clinic phone later from this page or from Settings.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-border/60 bg-card/80 p-5 text-sm text-muted-foreground shadow-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <MessageSquare className="h-4 w-4 text-emerald-600" />
            Why this is the only setup step
          </div>
          <p className="mt-2 leading-6">
            The platform credentials, automation backend, and routing are all managed centrally. Clinics only need to connect their WhatsApp number.
          </p>
        </div>
      </div>
    </div>
  );
}
