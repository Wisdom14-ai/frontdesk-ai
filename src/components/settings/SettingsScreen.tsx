"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AutomationsTab } from "@/components/settings/AutomationsTab";
import { ClinicInfoTab } from "@/components/settings/ClinicInfoTab";
import { SettingsNav, type SettingsTab } from "@/components/settings/SettingsNav";
import { TeamTab } from "@/components/settings/TeamTab";
import { TemplatesTab } from "@/components/settings/TemplatesTab";
import { WhatsAppTab } from "@/components/settings/WhatsAppTab";

interface ClinicDetails {
  id: string;
  name: string;
  clinic_type: string;
  plan_type: string;
  whatsapp_status: string;
  whatsapp_number?: string | null;
  whatsapp_connected_at?: string | null;
  webhook_secret?: string | null;
  n8n_webhook_url?: string | null;
  evolution_instance_name?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  clinic_prompt?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
}

const VALID_TABS = new Set(["whatsapp", "clinic", "team", "templates", "automations"]);

export function SettingsScreen() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab") ?? "whatsapp";
  const activeTab = (VALID_TABS.has(tabParam) ? tabParam : "whatsapp") as SettingsTab;
  const [clinic, setClinic] = useState<ClinicDetails | null>(null);

  async function loadClinic() {
    const response = await fetch("/api/clinic", { cache: "no-store" });
    if (!response.ok) {
      setClinic(null);
      return;
    }
    const payload = (await response.json()) as { clinic: ClinicDetails };
    setClinic(payload.clinic);
  }

  useEffect(() => {
    void loadClinic();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--surface-base)]">
      <SettingsNav activeTab={activeTab} />
      <div className="min-w-0 flex-1 overflow-y-auto p-4 fd-scrollbar">
        {activeTab === "whatsapp" ? (
          <WhatsAppTab clinic={clinic} onReload={() => void loadClinic()} />
        ) : null}
        {activeTab === "clinic" ? (
          <ClinicInfoTab clinic={clinic} onReload={() => void loadClinic()} />
        ) : null}
        {activeTab === "team" ? <TeamTab /> : null}
        {activeTab === "templates" ? <TemplatesTab /> : null}
        {activeTab === "automations" ? <AutomationsTab /> : null}
      </div>
    </div>
  );
}
