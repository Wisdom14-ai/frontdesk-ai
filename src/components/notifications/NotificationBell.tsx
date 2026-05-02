"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ClinicNotification {
  id: string;
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getSeverityClass(severity: ClinicNotification["severity"]) {
  if (severity === "critical") {
    return "bg-red-500";
  }

  if (severity === "warning") {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}

async function fetchNotifications(input?: { unreadOnly?: boolean; limit?: number }) {
  const params = new URLSearchParams();

  if (input?.unreadOnly) {
    params.set("unread_only", "true");
  }

  params.set("limit", String(input?.limit ?? 10));

  const response = await fetch(`/api/clinic/notifications?${params}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to load notifications.");
  }

  return ((await response.json()) as { notifications: ClinicNotification[] })
    .notifications;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<ClinicNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    setIsLoading(true);
    setError(null);

    try {
      const [recent, unread] = await Promise.all([
        fetchNotifications({ limit: 10 }),
        fetchNotifications({ unreadOnly: true, limit: 50 }),
      ]);

      setNotifications(recent);
      setUnreadCount(unread.length);
      return recent;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load notifications.");
      return [];
    } finally {
      setIsLoading(false);
    }
  }

  async function markUnreadAsRead(rows: ClinicNotification[]) {
    const unreadRows = rows.filter((notification) => !notification.read_at);

    if (unreadRows.length === 0) {
      return;
    }

    const nowIso = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        notification.read_at
          ? notification
          : { ...notification, read_at: nowIso }
      )
    );
    setUnreadCount(0);

    await Promise.all(
      unreadRows.map((notification) =>
        fetch(`/api/clinic/notifications/${notification.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: true }),
        }).catch(() => null)
      )
    );
  }

  async function openPanel() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen) {
      const recent = await load();
      await markUnreadAsRead(recent);
    }
  }

  async function dismissNotification(notificationId: string) {
    const target = notifications.find((notification) => notification.id === notificationId);

    setNotifications((current) =>
      current.filter((notification) => notification.id !== notificationId)
    );

    if (target && !target.read_at) {
      setUnreadCount((current) => Math.max(0, current - 1));
    }

    const response = await fetch(`/api/clinic/notifications/${notificationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed: true, read: true }),
    });

    if (!response.ok) {
      void load();
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void openPanel()}
        aria-label="Open notifications"
        className="relative text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {isOpen ? (
        <div className="absolute right-0 top-9 z-50 w-[340px] overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[var(--brand-gold-dark)]" />
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                Notifications
              </span>
            </div>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
            ) : null}
          </div>

          <div className="max-h-[360px] overflow-y-auto fd-scrollbar">
            {error ? (
              <div className="px-3 py-4 text-[12px] text-red-700">{error}</div>
            ) : null}

            {!error && notifications.length === 0 && !isLoading ? (
              <div className="px-3 py-8 text-center text-[12px] text-[var(--text-secondary)]">
                No notifications
              </div>
            ) : null}

            {notifications.map((notification) => (
              <div
                key={notification.id}
                className="border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${getSeverityClass(notification.severity)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                        {notification.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => void dismissNotification(notification.id)}
                        className="rounded-[4px] p-1 text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                        aria-label="Dismiss notification"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                      {notification.body}
                    </p>
                    <p className="mt-2 text-[10px] font-medium text-[var(--text-muted)]">
                      {formatNotificationTime(notification.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
