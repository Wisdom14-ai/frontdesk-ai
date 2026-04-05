"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Bot,
  Clock3,
  Loader2,
  Play,
  ShieldCheck,
  TimerReset,
  TriangleAlert,
} from "lucide-react";

import {
  queueContactMemoryBackfill,
  runContactMemoryNow,
} from "@/lib/supabase/hooks";
import type { ContactMemoryHealthSummary } from "@/types";

interface AdminLeadMemoryControlCardProps {
  clinicId: string;
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "No activity yet";
  }

  return new Date(value).toLocaleString("en-MY");
}

function formatRelativeTimestamp(value?: string | null) {
  if (!value) {
    return "No runner activity yet";
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function AdminLeadMemoryControlCard({
  clinicId,
}: AdminLeadMemoryControlCardProps) {
  const [health, setHealth] = useState<ContactMemoryHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const leadMemoryBasePath = `/api/admin/clinics/${clinicId}/lead-memory`;

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const payload = await readJson<{ health: ContactMemoryHealthSummary }>(
        await fetch(leadMemoryBasePath, {
          cache: "no-store",
        })
      );
      setHealth(payload.health);
    } catch (loadError) {
      setHealth(null);
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [leadMemoryBasePath]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const handleBackfill = async () => {
    setBackfilling(true);
    setMessage("");

    const result = await queueContactMemoryBackfill(
      `${leadMemoryBasePath}/backfill`
    );

    if ("error" in result) {
      setMessage(result.error || "Failed to queue lead memory backfill.");
    } else {
      setMessage(
        `Queued ${result.summary.queued} lead memory job(s). Skipped ${result.summary.skipped}.`
      );
      await loadHealth();
    }

    setBackfilling(false);
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    setMessage("");

    const result = await runContactMemoryNow(`${leadMemoryBasePath}/run-now`);

    if ("error" in result) {
      setMessage(result.error || "Failed to run due lead memory jobs.");
    } else {
      setMessage(
        `Runner checked ${result.jobs_scanned} lead memory job(s), completed ${result.jobs_completed}, failed ${result.jobs_failed}, and deferred ${result.jobs_skipped}.`
      );
      await loadHealth();
    }

    setRunningNow(false);
  };

  return (
    <section className="rounded-2xl border border-border/40 bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border/40 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <Bot className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Super Admin Lead Memory Drafting</h2>
            <p className="text-sm text-muted-foreground">
              Lead memory is generated directly by the app and monitored centrally for this clinic.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {message ? (
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {health?.schema_warning ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            {health.schema_warning}
          </div>
        ) : null}

        {health && !health.provider_configured ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            {health.provider_configuration_error ??
              "Set OPENAI_API_KEY and LEAD_MEMORY_MODEL to generate lead memory."}
          </div>
        ) : null}

        {health && !health.runner_secret_configured ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            Configure `CONTACT_MEMORY_RUNNER_SECRET`, `AUTOMATION_RUNNER_SECRET`, or `CRON_SECRET` before exposing the public runner endpoint.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TimerReset className="h-4 w-4 text-sky-500" />
              Pending jobs
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {loading ? "..." : health?.pending_jobs ?? 0}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4 text-amber-500" />
              Overdue now
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {loading ? "..." : health?.overdue_jobs ?? 0}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="h-4 w-4 text-rose-500" />
              Failed jobs
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {loading ? "..." : health?.failed_jobs ?? 0}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4 text-emerald-500" />
              Last generated memory
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {loading
                ? "Loading..."
                : formatTimestamp(health?.latest_generated_at)}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4 text-emerald-500" />
              Last runner activity
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {loading
                ? "Loading..."
                : formatRelativeTimestamp(
                    health?.last_run?.completed_at ?? health?.last_run?.started_at
                  )}
            </p>
            {health?.last_run ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {health.last_run.trigger_source === "manual" ? "Manual" : "Scheduler"} run,
                completed {health.last_run.jobs_completed}, skipped {health.last_run.jobs_skipped},
                failed {health.last_run.jobs_failed}.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Lead memory jobs are queued after message activity and contact updates.
          </div>
          <p className="mt-2">
            A managed cron should call
            <span className="mx-1 font-medium text-foreground">/api/contact-memory/run-due</span>
            using either
            <span className="mx-1 font-medium text-foreground">Authorization: Bearer &lt;CRON_SECRET&gt;</span>
            or
            <span className="mx-1 font-medium text-foreground">x-runner-secret</span>
            to process the queue.
          </p>
        </div>

        {health?.latest_error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            Latest issue ({health.latest_error.status ?? "unknown"}):
            <span className="ml-1 font-medium">{health.latest_error.message}</span>
            <div className="mt-2 text-xs text-rose-700/80">
              Updated {formatTimestamp(health.latest_error.updated_at)}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRunNow}
            disabled={runningNow}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {runningNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Due Jobs Now
          </button>

          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-amber-500 px-6 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
          >
            {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Queue Backfill"}
          </button>

          <button
            onClick={() => void loadHealth()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Status"}
          </button>
        </div>
      </div>
    </section>
  );
}
