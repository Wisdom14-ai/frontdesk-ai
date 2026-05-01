"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

interface Campaign {
  id: string;
  name: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  scheduled_for: string;
  created_at: string;
}

interface CampaignJob {
  id: string;
  status: string;
  contact_id: string;
  sent_at: string | null;
  last_error: string | null;
}

interface CampaignRowProps {
  campaign: Campaign;
  clinicId: string;
}

function getStatusClass(status: string) {
  if (status === "running") return "bg-[var(--status-bot-bg)] text-[var(--status-bot-text)]";
  if (status === "scheduled") return "bg-[#E8F1FB] text-[#185FA5]";
  if (status === "halted" || status === "cancelled") return "bg-[var(--danger-bg)] text-[var(--danger-text)]";
  return "bg-[var(--surface-subtle)] text-[var(--text-secondary)]";
}

export function CampaignRow({ campaign, clinicId }: CampaignRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [jobs, setJobs] = useState<CampaignJob[]>([]);

  async function toggleExpanded() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || jobs.length > 0) {
      return;
    }

    const supabase = createClient();
    const { data } = await supabase
      .from("broadcast_campaign_jobs")
      .select("id, status, contact_id, sent_at, last_error")
      .eq("clinic_id", clinicId)
      .eq("campaign_id", campaign.id)
      .order("scheduled_for", { ascending: true });

    setJobs((data ?? []) as CampaignJob[]);
  }

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0">
      <button
        type="button"
        onClick={() => void toggleExpanded()}
        className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-subtle)]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[12px] font-medium">{campaign.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusClass(campaign.status)}`}>
              {campaign.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Sent to {campaign.total_recipients} contacts ·{" "}
            {new Date(campaign.scheduled_for ?? campaign.created_at).toLocaleDateString("en-MY")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-right text-[11px] text-[var(--text-muted)]">
            {campaign.sent_count} sent / {campaign.failed_count} failed
          </span>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-[6px] opacity-0 group-hover:opacity-100"
            title="Duplicate"
          >
            <Copy className="h-3.5 w-3.5" />
          </span>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2">
          {jobs.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)]">No recipient jobs yet</p>
          ) : (
            <div className="grid gap-1">
              {jobs.slice(0, 40).map((job) => (
                <div
                  key={job.id}
                  className="grid grid-cols-[1fr_90px] gap-2 rounded-[6px] bg-white px-2 py-1 text-[10px]"
                >
                  <span className="truncate text-[var(--text-secondary)]">
                    {job.contact_id}
                  </span>
                  <span className="text-right font-medium">{job.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
