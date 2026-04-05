"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Bot,
  Clock3,
  Loader2,
  Play,
  Save,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  TriangleAlert,
} from "lucide-react";

import {
  runAutomationNow,
  updateAutomationRule,
  useAutomation,
} from "@/lib/supabase/hooks";

type RuleDraft = {
  is_enabled: boolean;
  delay_hours: number;
  template_body: string;
};

const tokenHelp = [
  "{{contact_name}}",
  "{{clinic_name}}",
  "{{appointment_time}}",
  "{{appointment_time_phrase}}",
];

function getDelayLabel(jobType: string) {
  return jobType === "same_day_reminder"
    ? "Hours before appointment"
    : "Delay after trigger (hours)";
}

function getLastRunLabel(timestamp?: string | null) {
  if (!timestamp) {
    return "No runner activity yet";
  }

  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

function getMessageTone(type: "info" | "success" | "error") {
  switch (type) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
    case "error":
      return "border-rose-500/20 bg-rose-500/10 text-rose-700";
    case "info":
    default:
      return "border-border/60 bg-muted/30 text-muted-foreground";
  }
}

interface AutomationControlCenterProps {
  apiBasePath?: string;
  runNowPath?: string;
  title?: string;
  description?: string;
}

export function AutomationControlCenter({
  apiBasePath = "/api/automation",
  runNowPath = "/api/automation/run-now",
  title = "Automation Control Center",
  description = "Edit follow-up timing, message templates, runner health, and manual execution.",
}: AutomationControlCenterProps) {
  const { rules, health, loading, error, fetchAutomation } = useAutomation(apiBasePath);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [savingRuleKey, setSavingRuleKey] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "info" | "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        rules.map((rule) => [
          rule.rule_key,
          {
            is_enabled: rule.is_enabled,
            delay_hours: rule.delay_hours,
            template_body: rule.template_body,
          },
        ])
      )
    );
  }, [rules]);

  const handleSaveRule = async (ruleKey: string) => {
    const draft = drafts[ruleKey];
    if (!draft) {
      return;
    }

    setSavingRuleKey(ruleKey);
    setFeedback(null);

    const result = await updateAutomationRule(
      {
        ruleKey,
        isEnabled: draft.is_enabled,
        delayHours: draft.delay_hours,
        templateBody: draft.template_body,
      },
      apiBasePath
    );

    if ("error" in result) {
      setFeedback({ type: "error", message: result.error || "Failed to save rule." });
    } else {
      setFeedback({
        type: "success",
        message:
          "Automation rule saved. Delay changes affect newly scheduled jobs and future reschedules.",
      });
      await fetchAutomation();
    }

    setSavingRuleKey(null);
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    setFeedback(null);

    const result = await runAutomationNow(runNowPath);

    if ("error" in result) {
      setFeedback({
        type: "error",
        message: result.error || "Failed to run due automations.",
      });
    } else {
      setFeedback({
        type: "success",
        message: `Runner checked ${result.jobs_scanned} due jobs and sent ${result.jobs_sent} messages.`,
      });
      await fetchAutomation();
    }

    setRunningNow(false);
  };

  return (
    <section className="rounded-2xl border border-border/40 bg-card overflow-hidden">
      <div className="border-b border-border/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <Bot className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>

          <button
            onClick={handleRunNow}
            disabled={
              runningNow ||
              !health?.can_manage_automation ||
              !health?.service_role_configured
            }
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
          >
            {runningNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Due Jobs Now
          </button>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {feedback ? (
          <div className={`rounded-xl border px-4 py-3 text-sm ${getMessageTone(feedback.type)}`}>
            {feedback.message}
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

        {health && !health.service_role_configured ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            `SUPABASE_SERVICE_ROLE_KEY` is required for manual runs and reliable scheduled automation processing.
          </div>
        ) : null}

        {health && !health.runner_secret_configured ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            Configure `AUTOMATION_RUNNER_SECRET` or `CRON_SECRET` before exposing the public runner endpoint.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              Last runner activity
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {loading
                ? "Loading..."
                : getLastRunLabel(
                    health?.last_run?.completed_at ?? health?.last_run?.started_at
                  )}
            </p>
            {health?.last_run ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {health.last_run.trigger_source === "manual" ? "Manual" : "Scheduler"} run,
                sent {health.last_run.jobs_sent}, skipped {health.last_run.jobs_skipped},
                failed {health.last_run.jobs_failed}.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Available template variables:
            {tokenHelp.map((token) => (
              <code
                key={token}
                className="rounded bg-background px-2 py-1 text-xs text-foreground"
              >
                {token}
              </code>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The manual run button only processes jobs that are already due. Delay changes do not move existing pending jobs.
          </p>
        </div>

        <div className="space-y-4">
          {rules.map((rule) => {
            const draft = drafts[rule.rule_key] ?? {
              is_enabled: rule.is_enabled,
              delay_hours: rule.delay_hours,
              template_body: rule.template_body,
            };

            return (
              <div
                key={rule.rule_key}
                className="rounded-2xl border border-border/60 bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{rule.name}</h3>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      {rule.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground">
                    {draft.is_enabled ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                    )}
                    {draft.is_enabled ? "Enabled" : "Disabled"}
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
                  <div className="space-y-4">
                    <label className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.is_enabled}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [rule.rule_key]: {
                              ...draft,
                              is_enabled: event.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 rounded border-border accent-emerald-500"
                      />
                      Enabled
                    </label>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {getDelayLabel(rule.job_type)}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft.delay_hours}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [rule.rule_key]: {
                              ...draft,
                              delay_hours: Number(event.target.value || 0),
                            },
                          }))
                        }
                        className="h-11 w-full rounded-lg border border-border bg-background px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      Message template
                    </label>
                    <textarea
                      rows={5}
                      value={draft.template_body}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [rule.rule_key]: {
                            ...draft,
                            template_body: event.target.value,
                          },
                        }))
                      }
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => void handleSaveRule(rule.rule_key)}
                    disabled={
                      savingRuleKey === rule.rule_key ||
                      !health?.can_manage_automation
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
                  >
                    {savingRuleKey === rule.rule_key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Rule
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
