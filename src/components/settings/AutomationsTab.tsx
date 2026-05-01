"use client";

import { useEffect, useState } from "react";

import type { MessageTemplate } from "@/types/app.types";

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

  async function loadData() {
    const [automationResponse, templatesResponse] = await Promise.all([
      fetch("/api/automation", { cache: "no-store" }),
      fetch("/api/templates", { cache: "no-store" }),
    ]);

    if (automationResponse.ok) {
      const payload = (await automationResponse.json()) as { rules: AutomationRule[] };
      setRules(payload.rules);
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

  return (
    <section className="max-w-[640px] space-y-2">
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
