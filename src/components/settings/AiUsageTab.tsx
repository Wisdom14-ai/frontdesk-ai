"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, RefreshCw, ShieldAlert } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface AiCapStatus {
  cycle_start: string | null;
  cycle_end: string | null;
  cost_usd_used: number | string;
  cap_usd: number | string;
  percentage_used: number | string;
  status: "active" | "warning" | "paused";
  paused_at: string | null;
  paused_reason: string | null;
}

const EMPTY_STATUS: AiCapStatus = {
  cycle_start: null,
  cycle_end: null,
  cost_usd_used: 0,
  cap_usd: 25,
  percentage_used: 0,
  status: "active",
  paused_at: null,
  paused_reason: null,
};

function toNumber(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function getDaysUntil(value: string | null) {
  if (!value) {
    return 0;
  }

  const diffMs = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function getProgressTone(status: AiCapStatus, percentage: number) {
  if (status.status === "paused" || percentage >= 100) {
    return {
      bar: "bg-red-500",
      badge: "border-red-200 bg-red-50 text-red-700",
      label: "Paused",
    };
  }

  if (percentage >= 80) {
    return {
      bar: "bg-amber-500",
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      label: "Warning",
    };
  }

  return {
    bar: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    label: "Active",
  };
}

export function AiUsageTab() {
  const [status, setStatus] = useState<AiCapStatus>(EMPTY_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/clinic/ai-cap-status", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load AI usage.");
      }

      setStatus((await response.json()) as AiCapStatus);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load AI usage.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  const usedUsd = toNumber(status.cost_usd_used);
  const capUsd = toNumber(status.cap_usd);
  const percentage = toNumber(status.percentage_used);
  const progressWidth = Math.min(100, Math.max(0, percentage));
  const daysUntilReset = useMemo(
    () => getDaysUntil(status.cycle_end),
    [status.cycle_end]
  );
  const tone = getProgressTone(status, percentage);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="rounded-[8px] border-[var(--border-default)] shadow-sm">
        <CardHeader className="border-b border-[var(--border-subtle)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--brand-gold-light)] text-[var(--brand-gold-dark)]">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-[15px]">AI Usage</CardTitle>
                <CardDescription className="mt-1 text-[12px]">
                  Current cycle: {formatUsd(usedUsd)} / {formatUsd(capUsd)} ({percentage.toFixed(1)}%)
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.badge}`}>
                {tone.label}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void loadStatus()}
                disabled={isLoading}
                aria-label="Refresh AI usage"
              >
                <RefreshCw className={isLoading ? "animate-spin" : ""} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          {error ? (
            <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </div>
          ) : null}

          <div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
              <div
                className={`h-full rounded-full transition-all ${tone.bar}`}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
                <p className="text-[11px] font-medium text-[var(--text-secondary)]">Used</p>
                <p className="mt-1 text-[18px] font-semibold text-[var(--text-primary)]">
                  {formatUsd(usedUsd)}
                </p>
              </div>
              <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
                <p className="text-[11px] font-medium text-[var(--text-secondary)]">Monthly cap</p>
                <p className="mt-1 text-[18px] font-semibold text-[var(--text-primary)]">
                  {formatUsd(capUsd)}
                </p>
              </div>
              <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
                <p className="text-[11px] font-medium text-[var(--text-secondary)]">Cycle resets in</p>
                <p className="mt-1 text-[18px] font-semibold text-[var(--text-primary)]">
                  {daysUntilReset} days
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span>{formatDate(status.cycle_start)}</span>
            <span>-</span>
            <span>{formatDate(status.cycle_end)} UTC</span>
          </div>

          {status.status === "paused" ? (
            <div className="flex gap-3 rounded-[8px] border border-red-200 bg-red-50 p-3 text-red-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-[12px] font-semibold">AI is paused for this clinic.</p>
                <p className="mt-1 text-[12px]">
                  Contact agency to upgrade or wait for next cycle.
                </p>
              </div>
            </div>
          ) : percentage >= 80 ? (
            <div className="flex gap-3 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-[12px]">
                AI usage is approaching the monthly cap.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
