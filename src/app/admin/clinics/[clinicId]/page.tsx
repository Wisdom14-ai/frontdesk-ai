import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getClinicDrilldown,
  type ConversionWindow,
  type AiUsageWindow,
} from "@/lib/server/admin-analytics";
import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetCapBlockedContacts, resetAiCapPause } from "./actions";

export const dynamic = "force-dynamic";

function usd(n: number) {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function ConversionTable({
  window,
  revenueTracked,
}: {
  window: ConversionWindow;
  revenueTracked: boolean;
}) {
  const rows = [window.bot_touched, window.human_only];
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground">
        <tr className="text-left">
          <th className="py-2 font-medium">Cohort</th>
          <th className="py-2 text-right font-medium">Contacts</th>
          <th className="py-2 text-right font-medium">Converted</th>
          <th className="py-2 text-right font-medium">Rate</th>
          {revenueTracked ? (
            <th className="py-2 text-right font-medium">Revenue (MYR)</th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.label} className="border-t border-border">
            <td className="py-2">{c.label}</td>
            <td className="py-2 text-right tabular-nums">{c.contacts}</td>
            <td className="py-2 text-right tabular-nums">{c.converted}</td>
            <td className="py-2 text-right tabular-nums">
              {pct(c.conversion_pct)}
            </td>
            {revenueTracked ? (
              <td className="py-2 text-right tabular-nums">
                {c.revenue_myr.toLocaleString()}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AiUsageTable({ window }: { window: AiUsageWindow }) {
  if (window.by_operation.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No AI calls in this window.</p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground">
        <tr className="text-left">
          <th className="py-2 font-medium">Operation</th>
          <th className="py-2 text-right font-medium">Calls</th>
          <th className="py-2 text-right font-medium">Err</th>
          <th className="py-2 text-right font-medium">Blocked</th>
          <th className="py-2 text-right font-medium">Cost</th>
          <th className="py-2 text-right font-medium">Avg ms</th>
        </tr>
      </thead>
      <tbody>
        {window.by_operation.map((o) => (
          <tr key={o.operation_type} className="border-t border-border">
            <td className="py-2">{o.operation_type}</td>
            <td className="py-2 text-right tabular-nums">{o.calls}</td>
            <td className="py-2 text-right tabular-nums">{o.errors}</td>
            <td className="py-2 text-right tabular-nums">{o.blocked}</td>
            <td className="py-2 text-right tabular-nums">{usd(o.cost_usd)}</td>
            <td className="py-2 text-right tabular-nums">
              {o.avg_latency_ms ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AdminClinicPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const state = await getAgencyAdminState();
  if (!state.user) {
    redirect("/login");
  }
  if (!state.isAgencyAdmin) {
    redirect("/settings");
  }

  const { clinicId } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Super admin</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          <code>SUPABASE_SERVICE_ROLE_KEY</code> is not configured, so
          analytics cannot be loaded.
        </p>
      </main>
    );
  }

  const data = await getClinicDrilldown(admin, clinicId);
  if (!data) {
    notFound();
  }

  const { clinic, usage, conversion, ai_usage, pipeline, cap_blocked_contacts } = data;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All clinics
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{clinic.name}</h1>
          <Badge variant="outline">{clinic.plan_type ?? "—"}</Badge>
          <Badge variant="outline">{clinic.clinic_type ?? "—"}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {clinic.owner_name ? `${clinic.owner_name} · ` : ""}
          {clinic.owner_phone ?? ""}
          {clinic.created_at
            ? ` · joined ${new Date(clinic.created_at).toLocaleDateString()}`
            : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">
            sub: {clinic.subscription_status ?? "?"}
          </Badge>
          <Badge variant="secondary">pay: {clinic.payment_status ?? "?"}</Badge>
          <Badge variant="secondary">
            wa: {clinic.whatsapp_status ?? "?"}
          </Badge>
          <Badge variant="secondary">{data.staff_count} staff</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage vs limits</CardTitle>
          <CardDescription>Current billing cycle</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat
            label="Active contacts"
            value={`${usage.active_contacts} / ${usage.contact_limit}`}
            sub={pct(usage.contact_utilization_pct)}
          />
          <Stat
            label="Outbound msgs (cycle)"
            value={`${usage.monthly_outbound_messages} / ${usage.monthly_message_limit}`}
            sub={pct(usage.monthly_message_utilization_pct)}
          />
          <Stat
            label="Cycle window"
            value={
              usage.billing_cycle_start
                ? new Date(usage.billing_cycle_start).toLocaleDateString()
                : "—"
            }
            sub={
              usage.billing_cycle_end
                ? `→ ${new Date(usage.billing_cycle_end).toLocaleDateString()}`
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chatbot conversion impact</CardTitle>
          <CardDescription>
            Contacts that ever received a bot message vs human-only, and how
            many reached booked / attended / patient. Revenue is attributed
            from each contact&apos;s recorded value.
            {!data.revenue_tracked
              ? " Revenue tracking is not enabled for this clinic."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">All time</h3>
            <ConversionTable
              window={conversion.all_time}
              revenueTracked={data.revenue_tracked}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">
              New contacts · last 30 days
            </h3>
            <ConversionTable
              window={conversion.last_30d}
              revenueTracked={data.revenue_tracked}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI usage &amp; cost</CardTitle>
          <CardDescription>
            By operation type. Compare all-time vs the last 30 days to spot
            cost or error trends.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">All time</h3>
              <span className="text-sm text-muted-foreground">
                {usd(ai_usage.all_time.total_cost_usd)} ·{" "}
                {ai_usage.all_time.total_calls} calls
              </span>
            </div>
            <AiUsageTable window={ai_usage.all_time} />
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">Last 30 days</h3>
              <span className="text-sm text-muted-foreground">
                {usd(ai_usage.last_30d.total_cost_usd)} ·{" "}
                {ai_usage.last_30d.total_calls} calls
              </span>
            </div>
            <AiUsageTable window={ai_usage.last_30d} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline snapshot</CardTitle>
          <CardDescription>
            Non-trash contacts by current status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pipeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pipeline.map((p) => (
                <Badge key={p.status} variant="outline">
                  {p.status}: {p.count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI health</CardTitle>
          <CardDescription>
            AI pause state and contacts whose bot was blocked by the monthly cap.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <span>
              AI paused:{" "}
              <span className={clinic.ai_paused_at ? "font-semibold text-destructive" : "text-muted-foreground"}>
                {clinic.ai_paused_at
                  ? `Yes — ${clinic.ai_paused_reason ?? "unknown reason"} (since ${new Date(clinic.ai_paused_at).toLocaleDateString()})`
                  : "No"}
              </span>
            </span>
            <span>
              Cap-blocked contacts:{" "}
              <span className={cap_blocked_contacts > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                {cap_blocked_contacts}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <form
              action={async () => {
                "use server";
                await resetAiCapPause(clinic.id);
              }}
            >
              <button
                type="submit"
                className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Reset AI cap pause
              </button>
            </form>

            {cap_blocked_contacts > 0 && (
              <form
                action={async () => {
                  "use server";
                  await resetCapBlockedContacts(clinic.id);
                }}
              >
                <button
                  type="submit"
                  className="rounded-md bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors"
                >
                  Resume bot for {cap_blocked_contacts} blocked contact{cap_blocked_contacts !== 1 ? "s" : ""}
                </button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
