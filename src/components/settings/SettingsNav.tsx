"use client";

import Link from "next/link";

export type SettingsTab = "whatsapp" | "clinic" | "team" | "templates" | "automations";

interface SettingsNavProps {
  activeTab: SettingsTab;
}

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "clinic", label: "Clinic info" },
  { value: "team", label: "Team" },
  { value: "templates", label: "Templates" },
  { value: "automations", label: "Automations" },
];

export function SettingsNav({ activeTab }: SettingsNavProps) {
  return (
    <aside className="w-[140px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2">
      <nav className="space-y-1">
        {SETTINGS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/settings?tab=${tab.value}`}
            className={[
              "block rounded-[6px] border px-2.5 py-2 text-[11px] font-medium transition-colors",
              activeTab === tab.value
                ? "border-[var(--brand-gold-border)] bg-[var(--brand-gold-light)] text-[var(--brand-gold-dark)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
