import Link from "next/link";
import { AlertTriangle, Bot, CalendarClock, Send } from "lucide-react";

import { getAiActivitySummary, type AiFeedItem } from "@/lib/server/ai-activity";
import { requireMembership } from "@/lib/server/auth";
import { describeBotSkipReason } from "@/lib/server/bot-skip-observability";
import { getClinicBotLiveState } from "@/lib/server/clinic-live-status";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function BotOfflineBanner({
  admin,
  clinicId,
}: {
  admin: SupabaseAdminClient;
  clinicId: string;
}) {
  const state = await getClinicBotLiveState(admin, clinicId);
  if (state.live) {
    return null;
  }

  const skipDetail = describeBotSkipReason(state.lastBotSkipReason);

  return (
    <div className="mb-4 rounded-[8px] border border-red-300 bg-red-50 p-3">
      <div className="flex items-center gap-2 text-red-700">
        <AlertTriangle className="h-4 w-4" strokeWidth={2} />
        <span className="text-[13px] font-semibold">
          Your AI assistant is not replying to new messages
        </span>
      </div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-8 text-[11px] text-red-700">
        {state.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {skipDetail ? (
        <p className="mt-1.5 pl-8 text-[11px] text-red-600">{skipDetail}</p>
      ) : null}
      <p className="mt-1.5 pl-8 text-[11px] text-red-600">
        Contact your Frontdesk admin to get the assistant back online.
      </p>
    </div>
  );
}

function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function feedBadge(kind: AiFeedItem["kind"]) {
  if (kind === "reply") {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">AI reply</span>;
  }
  if (kind === "follow_up") {
    return <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Follow-up</span>;
  }
  if (kind === "error") {
    return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Issue</span>;
  }
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Handoff</span>;
}

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export default async function DashboardPage() {
  const { membership } = await requireMembership();
  const admin = createAdminClient();

  if (!admin) {
    return (
      <div className="p-6 text-[12px] text-[var(--text-secondary)]">
        Dashboard requires the Supabase service role to be configured.
      </div>
    );
  }

  const summary = await getAiActivitySummary(admin, membership.clinic_id);
  const capPct = summary.cap ? Math.min(100, Math.round(summary.cap.percentageUsed)) : null;

  const stats = [
    {
      label: "AI replies · 7 days",
      value: summary.aiRepliesLast7d,
      icon: Bot,
    },
    {
      label: "Follow-ups sent · 7 days",
      value: summary.followUpsSentLast7d,
      icon: Send,
    },
    {
      label: "Follow-ups scheduled",
      value: summary.pendingFollowUps,
      icon: CalendarClock,
    },
    {
      label: "Waiting for a human",
      value: summary.handoffCount,
      icon: AlertTriangle,
      highlight: summary.handoffCount > 0,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-5 fd-scrollbar">
      <BotOfflineBanner admin={admin} clinicId={membership.clinic_id} />

      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-[var(--text-primary)]">AI activity</h1>
          <p className="text-[11px] text-[var(--text-muted)]">
            What your assistant has been doing, and where it needs you.
          </p>
        </div>
        {summary.cap ? (
          <div className="w-[220px]">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>AI spend this cycle</span>
              <span className={summary.cap.isPaused ? "font-semibold text-red-600" : ""}>
                ${summary.cap.currentCostUsd.toFixed(2)} / ${summary.cap.capUsd.toFixed(0)}
                {summary.cap.isPaused ? " · paused" : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
              <div
                className={`h-full rounded-full ${capPct !== null && capPct >= 80 ? "bg-red-500" : "bg-[var(--brand-gold)]"}`}
                style={{ width: `${capPct ?? 0}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-[8px] border p-3 ${
              stat.highlight
                ? "border-amber-300 bg-amber-50"
                : "border-[var(--border-subtle)] bg-[var(--surface-raised)]"
            }`}
          >
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <stat.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span className="text-[10px] font-semibold uppercase">{stat.label}</span>
            </div>
            <div className="mt-1 text-[22px] font-semibold text-[var(--text-primary)]">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Needs attention */}
        <section className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3">
          <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">
            Needs your attention
          </h2>
          {summary.handoffContacts.length === 0 ? (
            <p className="mt-3 text-[11px] text-[var(--text-muted)]">
              Nothing waiting — the assistant is handling everything.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {summary.handoffContacts.map((contact) => (
                <li
                  key={contact.id}
                  className="rounded-[6px] border border-[var(--border-subtle)] p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/inbox?contact_id=${contact.id}`}
                      className="truncate text-[12px] font-medium text-[var(--text-primary)] hover:underline"
                    >
                      {contact.full_name}
                    </Link>
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                      {formatRelative(contact.updated_at)}
                    </span>
                  </div>
                  {contact.last_handoff_reason ? (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                      {contact.last_handoff_reason}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex gap-2">
                    <a
                      href={waLink(contact.phone_e164)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-[5px] bg-[#25D366] px-2 py-1 text-[10px] font-medium text-white hover:opacity-90"
                    >
                      Reply in WhatsApp
                    </a>
                    <Link
                      href={`/inbox?contact_id=${contact.id}`}
                      className="rounded-[5px] border border-[var(--border-default)] px-2 py-1 text-[10px] font-medium hover:bg-[var(--surface-subtle)]"
                    >
                      Open thread
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* AI activity feed */}
        <section className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3">
          <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">
            Latest AI activity
          </h2>
          {summary.feed.length === 0 ? (
            <p className="mt-3 text-[11px] text-[var(--text-muted)]">
              No AI activity yet. It will show up here as soon as the assistant replies to a lead.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {summary.feed.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-[6px] p-1.5 hover:bg-[var(--surface-subtle)]"
                >
                  <div className="mt-0.5 shrink-0">{feedBadge(item.kind)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      {item.contactId ? (
                        <Link
                          href={`/inbox?contact_id=${item.contactId}`}
                          className="truncate text-[11px] font-medium text-[var(--text-primary)] hover:underline"
                        >
                          {item.contactName}
                        </Link>
                      ) : (
                        <span className="truncate text-[11px] font-medium">{item.contactName}</span>
                      )}
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {formatRelative(item.at)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                      {item.detail}
                      {item.confidence !== null
                        ? ` · ${Math.round(item.confidence * 100)}% confident`
                        : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
