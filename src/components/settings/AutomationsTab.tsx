"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import type { MessageTemplate } from "@/types/app.types";
import type {
  AutomationApprovalDraft,
  AutomationHealthSummary,
} from "@/types";

interface AutomationRule {
  rule_key: string;
  name: string;
  description: string;
  delay_hours: number;
  template_body: string;
  is_enabled: boolean;
}

const RULE_COPY: Record<string, { title: string; description: string }> = {
  same_day_reminder: {
    title: "Same-day appointment reminder",
    description: "Sent 2 hours before appointment time",
  },
  no_reply_follow_up: {
    title: "No-reply follow up",
    description: "Triggered after 24h of no response",
  },
  monthly_nurture: {
    title: "Monthly nurture",
    description: "Sent to contacts inactive for 30 days",
  },
};

export function AutomationsTab() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [health, setHealth] = useState<AutomationHealthSummary | null>(null);
  const [approvals, setApprovals] = useState<AutomationApprovalDraft[]>([]);
  const [updatingApprovalId, setUpdatingApprovalId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  async function loadData() {
    const [automationResponse, templatesResponse] = await Promise.all([
      fetch("/api/automation", { cache: "no-store" }),
      fetch("/api/templates", { cache: "no-store" }),
    ]);

    if (automationResponse.ok) {
      const payload = (await automationResponse.json()) as {
        rules: AutomationRule[];
        health?: AutomationHealthSummary;
        approvals?: AutomationApprovalDraft[];
      };
      setRules(payload.rules);
      setHealth(payload.health ?? null);
      setApprovals(payload.approvals ?? []);
    }
    if (templatesResponse.ok) {
      const payload = (await templatesResponse.json()) as { templates: MessageTemplate[] };
      setTemplates(payload.templates);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function updateRule(rule: AutomationRule, updates: Partial<AutomationRule>) {
    const nextRule = { ...rule, ...updates };
    setRules((current) =>
      current.map((item) => (item.rule_key === rule.rule_key ? nextRule : item))
    );
    await fetch("/api/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleKey: nextRule.rule_key,
        isEnabled: nextRule.is_enabled,
        delayHours: nextRule.delay_hours,
        templateBody: nextRule.template_body,
      }),
    });
  }

  async function updateApproval(jobId: string, action: "approve" | "reject") {
    setUpdatingApprovalId(jobId);
    setFeedback("");

    const response = await fetch("/api/automation/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setFeedback(payload.error || "Failed to update approval draft.");
      setUpdatingApprovalId(null);
      return;
    }

    setFeedback(action === "approve" ? "Draft approved and sent." : "Draft rejected.");
    await loadData();
    setUpdatingApprovalId(null);
  }

  return (
    <section className="max-w-[760px] space-y-4">
      <div className="rounded-[8px] border border-[var(--border-subtle)] bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">Follow-up approvals</h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              {approvals.length > 0
                ? `${approvals.length} risky follow-up draft${approvals.length === 1 ? "" : "s"} waiting.`
                : "No risky follow-up drafts waiting."}
            </p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
            {health?.approval_jobs ?? approvals.length}
          </span>
        </div>

        {feedback ? (
          <div className="mt-3 rounded-[6px] bg-[var(--surface-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
            {feedback}
          </div>
        ) : null}

        {approvals.length > 0 ? (
          <div className="mt-3 space-y-2">
            {approvals.map((approval) => (
              <div
                key={approval.id}
                className="rounded-[8px] border border-[var(--border-subtle)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium">
                      {approval.contact_name || approval.phone_e164 || "Unknown contact"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      {approval.rule_key ?? approval.job_type}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void updateApproval(approval.id, "reject")}
                      disabled={updatingApprovalId === approval.id}
                      className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border-default)] px-2 text-[11px] font-medium disabled:opacity-60"
                    >
                      {updatingApprovalId === approval.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateApproval(approval.id, "approve")}
                      disabled={updatingApprovalId === approval.id}
                      className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-emerald-600 px-2 text-[11px] font-medium text-white disabled:opacity-60"
                    >
                      {updatingApprovalId === approval.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Approve
                    </button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap rounded-[6px] bg-[var(--surface-subtle)] p-2 text-[11px] leading-5 text-[var(--text-primary)]">
                  {approval.draft_message}
                </p>
                {approval.reasons.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {approval.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {rules.map((rule) => {
        const copy = RULE_COPY[rule.rule_key] ?? {
          title: rule.name,
          description: rule.description,
        };
        return (
          <div
            key={rule.rule_key}
            className="grid grid-cols-[auto_1fr_190px] items-center gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-white p-3"
          >
            <button
              type="button"
              onClick={() => void updateRule(rule, { is_enabled: !rule.is_enabled })}
              className={[
                "relative h-4 w-7 rounded-full",
                rule.is_enabled ? "bg-[var(--wa-connected)]" : "bg-[var(--border-strong)]",
              ].join(" ")}
              aria-label={rule.is_enabled ? "Disable automation" : "Enable automation"}
            >
              <span
                className={[
                  "absolute top-[2px] h-3 w-3 rounded-full bg-white transition-transform",
                  rule.is_enabled ? "translate-x-[13px]" : "translate-x-[2px]",
                ].join(" ")}
              />
            </button>
            <div>
              <div className="text-[12px] font-medium">{copy.title}</div>
              <div className="text-[10px] text-[var(--text-muted)]">{copy.description}</div>
            </div>
            <select
              value={templates.find((template) => template.body === rule.template_body)?.id ?? ""}
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) {
                  void updateRule(rule, { template_body: template.body });
                }
              }}
              className="h-8 rounded-[6px] border border-[var(--border-default)] bg-white px-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
            >
              <option value="">Template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </section>
  );
}
