"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { CampaignList } from "@/components/campaigns/CampaignList";
import { NewCampaignWizard } from "@/components/campaigns/NewCampaignWizard";
import { TemplateList } from "@/components/campaigns/TemplateList";

interface CampaignsScreenProps {
  clinicId: string;
}

type CampaignTab = "campaigns" | "templates" | "new";

export function CampaignsScreen({ clinicId }: CampaignsScreenProps) {
  const [tab, setTab] = useState<CampaignTab>("campaigns");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-base)]">
      <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3">
        <div className="flex rounded-[6px] border border-[var(--border-default)] bg-white p-0.5">
          {[
            ["campaigns", "Campaigns"],
            ["templates", "Templates"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as CampaignTab)}
              className={[
                "h-7 rounded-[5px] px-3 text-[11px] font-medium",
                tab === value
                  ? "bg-[var(--brand-gold-light)] text-[var(--brand-gold-dark)]"
                  : "text-[var(--text-secondary)]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTab("new")}
          className="flex h-7 items-center gap-1 rounded-[6px] bg-[var(--brand-gold)] px-2.5 text-[11px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New campaign
        </button>
      </div>
      <div className="min-h-0 flex-1 p-3">
        {tab === "campaigns" ? (
          <CampaignList clinicId={clinicId} refreshKey={refreshKey} />
        ) : null}
        {tab === "templates" ? <TemplateList /> : null}
        {tab === "new" ? (
          <NewCampaignWizard
            clinicId={clinicId}
            onLaunched={() => {
              setRefreshKey((value) => value + 1);
              setTab("campaigns");
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
