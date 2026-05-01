"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Inbox, Megaphone, Settings, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

interface SidebarProps {
  clinicId: string;
  unreadCount: number;
  whatsappStatus: string | null;
}

const NAV_ITEMS = [
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/crm", icon: Workflow, label: "CRM" },
  { href: "/campaigns", icon: Megaphone, label: "Blast" },
  { href: "/analytics", icon: BarChart3, label: "Stats" },
  { href: "/settings", icon: Settings, label: "Setup" },
];

export function Sidebar({ clinicId, unreadCount, whatsappStatus }: SidebarProps) {
  const pathname = usePathname() ?? "/inbox";
  const router = useRouter();
  const [currentUnreadCount, setCurrentUnreadCount] = useState(unreadCount);

  useEffect(() => {
    const supabase = createClient();

    async function refreshUnreadCount() {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .gt("unread_count", 0);

      setCurrentUnreadCount(count ?? 0);
    }

    const channel = supabase
      .channel(`sidebar-contacts:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          void refreshUnreadCount();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clinicId]);

  const isWhatsappConnected = whatsappStatus === "connected";

  return (
    <aside className="flex h-screen w-[64px] shrink-0 flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]">
      <div className="flex h-[56px] w-full items-center justify-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--brand-gold)] text-[15px] font-semibold text-white">
          F
        </div>
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1 pt-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/inbox"
              ? pathname === "/inbox"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              title={item.label}
              className={[
                "relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-[6px] text-[10px] font-medium transition-colors",
                isActive
                  ? "border border-[var(--brand-gold-border)] bg-[var(--brand-gold-light)] text-[var(--brand-gold-dark)]"
                  : "border border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              <span className="leading-none">{item.label}</span>
              {item.href === "/inbox" && currentUnreadCount > 0 ? (
                <span className="absolute right-[7px] top-[6px] h-2 w-2 rounded-full bg-[var(--danger)]" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        title={isWhatsappConnected ? "WhatsApp connected" : "Reconnect WhatsApp"}
        onClick={() => router.push("/settings?tab=whatsapp")}
        className="mb-3 flex h-11 w-11 flex-col items-center justify-center gap-1 rounded-[6px] text-[10px] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"
      >
        <span
          className={[
            "h-2 w-2 rounded-full",
            isWhatsappConnected
              ? "bg-[var(--wa-connected)]"
              : "wa-pulse bg-[var(--wa-disconnected)]",
          ].join(" ")}
        />
        <span className="leading-none">WA</span>
      </button>
    </aside>
  );
}
