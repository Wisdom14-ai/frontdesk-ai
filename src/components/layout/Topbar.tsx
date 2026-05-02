"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/NotificationBell";

interface TopbarProps {
  title?: string;
  badge?: string;
  actions?: ReactNode;
}

const ROUTE_TITLES: Array<{ prefix: string; title: string; badge?: string }> = [
  { prefix: "/inbox", title: "Inbox", badge: "WhatsApp" },
  { prefix: "/crm", title: "CRM", badge: "Pipeline" },
  { prefix: "/campaigns", title: "Blast", badge: "Campaigns" },
  { prefix: "/analytics", title: "Stats", badge: "Clinic performance" },
  { prefix: "/settings", title: "Setup", badge: "Workspace" },
];

export function Topbar({ title, badge, actions }: TopbarProps) {
  const pathname = usePathname() ?? "/inbox";
  const route = ROUTE_TITLES.find((item) => pathname.startsWith(item.prefix));

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
          {title ?? route?.title ?? "Inbox"}
        </h1>
        {(badge ?? route?.badge) ? (
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
            {badge ?? route?.badge}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
        {actions}
      </div>
    </div>
  );
}
