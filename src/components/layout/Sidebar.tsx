"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Columns3,
  Megaphone,
  MessageSquare,
  Settings,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

import { FrontdeskMark } from "@/components/brand/FrontdeskLogo";

interface SidebarProps {
  userName: string;
  userRole: string;
  clinicName: string;
  showAdminLink?: boolean;
}

export function Sidebar({ userName, userRole, clinicName, showAdminLink = false }: SidebarProps) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(false);
  const canManageCampaigns = userRole === "admin" || userRole === "manager";
  const baseNavItems = [
    { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/board", icon: Columns3, label: "Pipeline" },
    { href: "/inbox", icon: MessageSquare, label: "Inbox" },
    ...(canManageCampaigns
      ? [{ href: "/campaigns", icon: Megaphone, label: "Campaigns" }]
      : []),
    { href: "/settings", icon: Settings, label: "Settings" },
  ];
  const navItems = showAdminLink
    ? [...baseNavItems, { href: "/admin", icon: Shield, label: "Super Admin" }]
    : baseNavItems;

  return (
    <aside
      className={`flex flex-col border-r border-border/40 bg-card transition-all duration-300 ${
        collapsed ? "w-[72px]" : "w-64"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-border/40 shrink-0">
        <FrontdeskMark className="h-9 w-9 shrink-0" />
        {!collapsed && (
          <div className="ml-3 overflow-hidden">
            <h1 className="font-semibold text-sm text-foreground truncate">
              {clinicName}
            </h1>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-xs font-semibold tracking-tight text-foreground/80">
                Frontdesk
              </span>
              <span className="inline-flex h-5 items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-emerald-700">
                AI
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${isActive ? "text-emerald-500" : ""}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-3 pb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* User profile */}
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{userName}</p>
              <p className="text-xs text-muted-foreground capitalize truncate">{userRole}</p>
            </div>
          )}
          {!collapsed && (
            <form action="/api/auth/sign-out" method="post">
              <button
                type="submit"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </aside>
  );
}
