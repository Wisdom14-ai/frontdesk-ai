"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  BroadcastCampaignDetailPayload,
  BroadcastCampaignJobStatus,
} from "@/types";

interface CampaignDetailScreenProps {
  campaignId: string;
  initialDetail: BroadcastCampaignDetailPayload | null;
  schemaError: string | null;
}

type RecipientFilter = "all" | "sent" | "delivered" | "read" | "replied" | "clicked" | "failed" | "opted_out" | "pending";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getStatusClass(status: BroadcastCampaignJobStatus) {
  if (status === "sent")
    return "bg-[var(--status-bot-bg)] text-[var(--status-bot-text)]";
  if (status === "failed" || status === "cancelled")
    return "bg-[var(--danger-bg)] text-[var(--danger-text)]";
  if (status === "skipped") return "bg-[#FFF4E5] text-[#A35200]";
  if (status === "processing") return "bg-[#E8F1FB] text-[#185FA5]";
  return "bg-[var(--surface-subtle)] text-[var(--text-secondary)]";
}

export function CampaignDetailScreen({
  campaignId,
  initialDetail,
  schemaError,
}: CampaignDetailScreenProps) {
  const [detail, setDetail] = useState<BroadcastCampaignDetailPayload | null>(
    initialDetail
  );
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/analytics`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as BroadcastCampaignDetailPayload;
      setDetail(data);
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : "Refresh failed."
      );
    } finally {
      setRefreshing(false);
    }
  }

  // Auto-refresh every 15s while a campaign is running
  useEffect(() => {
    if (!detail) return;
    if (detail.campaign.status !== "running") return;
    const interval = setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.campaign.status]);

  const filteredRecipients = useMemo(() => {
    if (!detail) return [];
    if (filter === "all") return detail.recipients;
    return detail.recipients.filter((r) => {
      switch (filter) {
        case "sent":
          return r.status === "sent";
        case "delivered":
          return Boolean(r.delivered_at);
        case "read":
          return Boolean(r.read_at);
        case "replied":
          return r.reply_count > 0;
        case "clicked":
          return r.click_count > 0;
        case "failed":
          return r.status === "failed";
        case "opted_out":
          return Boolean(r.opted_out_at);
        case "pending":
          return r.status === "pending" || r.status === "processing";
        default:
          return true;
      }
    });
  }, [detail, filter]);

  if (schemaError) {
    return (
      <div className="p-6">
        <BackLink />
        <div className="mt-4 rounded-[10px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-[12px] text-[var(--danger-text)]">
          {schemaError}
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 text-[12px] text-[var(--text-muted)]">
        Loading campaign analytics…
      </div>
    );
  }

  const { campaign, funnel, recipients, links } = detail;

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)]">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-white px-4 py-3">
        <div className="min-w-0">
          <BackLink />
          <h1 className="mt-1 truncate text-[16px] font-semibold">
            {campaign.name}
          </h1>
          <p className="text-[11px] text-[var(--text-muted)]">
            {campaign.delivery_type === "scheduled" ? "Scheduled" : "Sent"} ·{" "}
            {formatDate(campaign.scheduled_for)} · status: {campaign.status.replace(/_/g, " ")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {refreshError ? (
        <div className="border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-[11px] text-[var(--danger-text)]">
          {refreshError}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto p-4">
        {/* Funnel rate cards */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <RateCard
            label="Recipients"
            value={funnel.total_recipients.toString()}
            sub="Total"
          />
          <RateCard
            label="Sent"
            value={funnel.sent.toString()}
            sub={`${formatPercent((funnel.sent / Math.max(funnel.total_recipients, 1)) * 100)} of total`}
          />
          <RateCard
            label="Delivered"
            value={funnel.delivered.toString()}
            sub={formatPercent(funnel.delivery_rate)}
            tone={funnel.delivery_rate >= 90 ? "good" : funnel.delivery_rate >= 70 ? "warn" : "bad"}
          />
          <RateCard
            label="Read"
            value={funnel.read.toString()}
            sub={formatPercent(funnel.read_rate)}
            tone={funnel.read_rate >= 50 ? "good" : "neutral"}
          />
          <RateCard
            label="Replied"
            value={funnel.replied.toString()}
            sub={formatPercent(funnel.reply_rate)}
            tone={funnel.reply_rate >= 10 ? "good" : "neutral"}
          />
          <RateCard
            label="Opt-outs"
            value={funnel.opted_out.toString()}
            sub={formatPercent(funnel.opt_out_rate)}
            tone={funnel.opt_out_rate <= 1 ? "good" : funnel.opt_out_rate <= 3 ? "warn" : "bad"}
          />
        </section>

        {/* Funnel visualization */}
        <section className="mt-6 rounded-[10px] border border-[var(--border-subtle)] bg-white p-4">
          <h2 className="text-[13px] font-semibold">Engagement funnel</h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Each bar shows how many recipients made it to that stage.
          </p>
          <div className="mt-4 space-y-2">
            <FunnelBar
              label="Recipients"
              count={funnel.total_recipients}
              max={funnel.total_recipients}
              color="bg-[#475569]"
            />
            <FunnelBar
              label="Sent"
              count={funnel.sent}
              max={funnel.total_recipients}
              color="bg-[#3B82F6]"
            />
            <FunnelBar
              label="Delivered"
              count={funnel.delivered}
              max={funnel.total_recipients}
              color="bg-[#0EA5E9]"
            />
            <FunnelBar
              label="Read"
              count={funnel.read}
              max={funnel.total_recipients}
              color="bg-[#10B981]"
            />
            <FunnelBar
              label="Replied"
              count={funnel.replied}
              max={funnel.total_recipients}
              color="bg-[#16A34A]"
            />
            {funnel.clicked > 0 ? (
              <FunnelBar
                label="Clicked link"
                count={funnel.clicked}
                max={funnel.total_recipients}
                color="bg-[#7C3AED]"
              />
            ) : null}
          </div>

          {(funnel.failed > 0 || funnel.opted_out > 0 || funnel.invalid > 0) && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {funnel.failed > 0 ? (
                <SmallStat label="Failed" value={funnel.failed} tone="bad" />
              ) : null}
              {funnel.invalid > 0 ? (
                <SmallStat
                  label="Invalid number"
                  value={funnel.invalid}
                  tone="bad"
                />
              ) : null}
              {funnel.skipped > 0 ? (
                <SmallStat label="Skipped" value={funnel.skipped} tone="warn" />
              ) : null}
              {funnel.opted_out > 0 ? (
                <SmallStat
                  label="Opted out"
                  value={funnel.opted_out}
                  tone="bad"
                />
              ) : null}
            </div>
          )}
        </section>

        {/* Campaign links */}
        {links.length > 0 ? (
          <section className="mt-6 rounded-[10px] border border-[var(--border-subtle)] bg-white p-4">
            <h2 className="text-[13px] font-semibold">Tracked links</h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              Click counts for shortened URLs included in this campaign.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Short code</th>
                    <th className="px-2 py-2 text-left font-medium">Target</th>
                    <th className="px-2 py-2 text-right font-medium">Total clicks</th>
                    <th className="px-2 py-2 text-right font-medium">Unique</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                      <td className="px-2 py-1.5 font-mono text-[10px]">/c/{link.short_code}</td>
                      <td className="px-2 py-1.5 max-w-[300px] truncate text-[var(--text-secondary)]">
                        <a href={link.target_url} target="_blank" rel="noreferrer" className="hover:underline">
                          {link.target_url}
                        </a>
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">{link.total_clicks}</td>
                      <td className="px-2 py-1.5 text-right">{link.unique_clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* Recipient table */}
        <section className="mt-6 rounded-[10px] border border-[var(--border-subtle)] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">
              Recipients ({recipients.length})
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "All"],
                  ["sent", "Sent"],
                  ["delivered", "Delivered"],
                  ["read", "Read"],
                  ["replied", "Replied"],
                  ["clicked", "Clicked"],
                  ["failed", "Failed"],
                  ["opted_out", "Opted out"],
                  ["pending", "Pending"],
                ] as Array<[RecipientFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                    filter === key
                      ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white"
                      : "border-[var(--border-subtle)] bg-white text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Contact</th>
                  <th className="px-2 py-2 text-left font-medium">Phone</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-2 py-2 text-left font-medium">Sent</th>
                  <th className="px-2 py-2 text-left font-medium">Delivered</th>
                  <th className="px-2 py-2 text-left font-medium">Read</th>
                  <th className="px-2 py-2 text-left font-medium">Replied</th>
                  <th className="px-2 py-2 text-right font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipients.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-2 py-6 text-center text-[var(--text-muted)]"
                    >
                      No recipients matching this filter.
                    </td>
                  </tr>
                ) : (
                  filteredRecipients.slice(0, 500).map((r) => (
                    <tr
                      key={r.job_id}
                      className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface-subtle)]"
                    >
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/contacts/${r.contact_id}`}
                          className="text-[var(--text-primary)] hover:underline"
                        >
                          {r.contact_name ?? "Unknown"}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
                        {r.contact_phone ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusClass(r.status)}`}
                        >
                          {r.status}
                        </span>
                        {r.opted_out_at ? (
                          <span className="ml-1 rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[10px] text-[var(--danger-text)]">
                            opted out
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
                        {formatDate(r.sent_at)}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
                        {formatDate(r.delivered_at)}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
                        {formatDate(r.read_at)}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
                        {formatDate(r.first_reply_at)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {r.click_count}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredRecipients.length > 500 ? (
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
              Showing first 500 of {filteredRecipients.length} matching recipients.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/campaigns"
      className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    >
      <ArrowLeft className="h-3 w-3" />
      Back to campaigns
    </Link>
  );
}

function RateCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "text-[#16A34A]"
      : tone === "warn"
        ? "text-[#A35200]"
        : tone === "bad"
          ? "text-[var(--danger-text)]"
          : "text-[var(--text-secondary)]";

  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-white p-3">
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums">{value}</p>
      <p className={`mt-0.5 text-[10px] tabular-nums ${toneClass}`}>{sub}</p>
    </div>
  );
}

function FunnelBar({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const percent = max > 0 ? Math.max(2, (count / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="tabular-nums text-[var(--text-muted)]">
          {count.toLocaleString()} ({((count / Math.max(max, 1)) * 100).toFixed(1)}%)
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SmallStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "bad"
      ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]"
      : tone === "warn"
        ? "border-[#FFE0B2] bg-[#FFF4E5] text-[#A35200]"
        : "border-[var(--border-subtle)] bg-white text-[var(--text-secondary)]";

  return (
    <div className={`rounded-[8px] border p-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
