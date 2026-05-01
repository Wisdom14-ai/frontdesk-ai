"use client";

import { useEffect, useState } from "react";

import { CampaignRow } from "@/components/campaigns/CampaignRow";

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

interface CampaignListProps {
  clinicId: string;
  refreshKey: number;
}

export function CampaignList({ clinicId, refreshKey }: CampaignListProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState("");

  async function loadCampaigns() {
    const response = await fetch("/api/campaigns", { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Failed to load campaigns.");
      setCampaigns([]);
      return;
    }
    const payload = (await response.json()) as { campaigns: Campaign[] };
    setError("");
    setCampaigns(payload.campaigns ?? []);
  }

  useEffect(() => {
    void loadCampaigns();
  }, [refreshKey]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <h2 className="text-[13px] font-semibold">Campaigns</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto fd-scrollbar">
        {error ? (
          <div className="p-4 text-[11px] text-[var(--danger-text)]">{error}</div>
        ) : null}
        {!error && campaigns.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
            No campaigns
          </div>
        ) : null}
        {campaigns.map((campaign) => (
          <CampaignRow key={campaign.id} campaign={campaign} clinicId={clinicId} />
        ))}
      </div>
    </section>
  );
}
