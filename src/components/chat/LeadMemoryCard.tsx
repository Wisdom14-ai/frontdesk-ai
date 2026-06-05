"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RotateCw, Sparkles } from "lucide-react";

import {
  CONTACT_LEAD_MEMORY_KEYS,
  EMPTY_CONTACT_LEAD_MEMORY,
  hasLeadMemoryOverride,
} from "@/lib/contact-memory";
import {
  refreshContactMemory,
  updateContact,
} from "@/lib/supabase/hooks";
import { useAppStore } from "@/store";
import type { ContactLeadMemory, ContactLeadMemoryKey, Lead } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const leadQualityLabels = {
  unknown: "Unknown",
  cold: "Cold",
  warm: "Warm",
  hot: "Hot",
} as const;

const leadQualityBadgeClassNames = {
  unknown: "bg-slate-100 text-slate-700 border-slate-200",
  cold: "bg-sky-100 text-sky-700 border-sky-200",
  warm: "bg-amber-100 text-amber-700 border-amber-200",
  hot: "bg-rose-100 text-rose-700 border-rose-200",
} as const;

function isMultilineField(key: ContactLeadMemoryKey) {
  return (
    key === "lead_summary" ||
    key === "conversation_summary" ||
    key === "follow_up_angle" ||
    key === "objections"
  );
}

function getFieldLabel(key: ContactLeadMemoryKey) {
  switch (key) {
    case "confirmed_name":
      return "Confirmed Name";
    case "name_confidence":
      return "Name Confidence";
    case "preferred_language":
      return "Preferred Language";
    case "lead_intent":
      return "Lead Intent";
    case "urgency":
      return "Urgency";
    case "lead_summary":
      return "Lead Summary";
    case "conversation_summary":
      return "Conversation Summary";
    case "lead_quality":
      return "Lead Quality";
    case "lead_quality_reason":
      return "Quality Reason";
    case "last_outcome":
      return "Last Outcome";
    case "next_action":
      return "Next Action";
    case "follow_up_angle":
      return "Follow-up Angle";
    case "objections":
      return "Objections";
    default:
      return key;
  }
}

export function LeadMemoryCard({ lead }: { lead?: Lead }) {
  const setLeads = useAppStore((state) => state.setLeads);
  const leads = useAppStore((state) => state.leads);

  const [memoryDraft, setMemoryDraft] = useState(EMPTY_CONTACT_LEAD_MEMORY);
  const [staffNote, setStaffNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!lead) {
      setMemoryDraft(EMPTY_CONTACT_LEAD_MEMORY);
      setStaffNote("");
      return;
    }

    setMemoryDraft(lead.lead_memory);
    setStaffNote(lead.staff_note ?? "");
    setMessage("");
  }, [lead]);

  if (!lead) {
    return null;
  }

  const autoMemory = lead.lead_memory_auto ?? lead.lead_memory;
  const overrideMemory = lead.lead_memory_override ?? {};
  const currentStaffNote = lead.staff_note ?? "";

  const handleFieldReset = async (key: ContactLeadMemoryKey) => {
    setMessage("");
    const result = await updateContact(lead.id, {
      clear_lead_memory_override: [key],
    });

    if (!result.success || !result.contact) {
      setMessage(result.error || "Failed to restore AI draft.");
      return;
    }

    setLeads(
      leads.map((candidate) =>
        candidate.id === lead.id ? result.contact! : candidate
      )
    );
    setMessage(`${getFieldLabel(key)} restored to AI draft.`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage("");

    const result = await refreshContactMemory(lead.id);
    if ("error" in result) {
      setMessage(result.error || "Failed to queue lead memory refresh.");
    } else {
      setMessage("Lead memory refresh queued.");
    }

    setRefreshing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");

    const leadMemoryOverride: Partial<ContactLeadMemory> = {};
    const clearLeadMemoryOverride: ContactLeadMemoryKey[] = [];

    for (const key of CONTACT_LEAD_MEMORY_KEYS) {
      const nextValue = memoryDraft[key];
      const autoValue = autoMemory[key];
      const isOverridden = hasLeadMemoryOverride(overrideMemory, key);
      const overrideValue = overrideMemory[key];

      if (nextValue === autoValue) {
        if (isOverridden) {
          clearLeadMemoryOverride.push(key);
        }
        continue;
      }

      if (!isOverridden || overrideValue !== nextValue) {
        if (key === "lead_quality") {
          leadMemoryOverride.lead_quality =
            nextValue as ContactLeadMemory["lead_quality"];
        } else if (key === "name_confidence") {
          leadMemoryOverride.name_confidence =
            nextValue as ContactLeadMemory["name_confidence"];
        } else {
          leadMemoryOverride[key] = nextValue as ContactLeadMemory[typeof key];
        }
      }
    }

    const payload: Parameters<typeof updateContact>[1] = {};
    if (Object.keys(leadMemoryOverride).length > 0) {
      payload.lead_memory_override = leadMemoryOverride;
    }
    if (clearLeadMemoryOverride.length > 0) {
      payload.clear_lead_memory_override = clearLeadMemoryOverride;
    }
    if (staffNote !== currentStaffNote) {
      payload.staff_note = staffNote || null;
    }

    if (Object.keys(payload).length === 0) {
      setMessage("No lead memory changes to save.");
      setSaving(false);
      return;
    }

    const result = await updateContact(lead.id, payload);

    if (!result.success || !result.contact) {
      setMessage(result.error || "Failed to save lead memory.");
      setSaving(false);
      return;
    }

    setLeads(
      leads.map((candidate) =>
        candidate.id === lead.id ? result.contact! : candidate
      )
    );
    setMessage("Lead memory saved.");
    setSaving(false);
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Lead Memory</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            AI draft plus staff overrides for context handoff and follow-up.
          </p>
        </div>
        <Badge
          variant="outline"
          className={leadQualityBadgeClassNames[lead.lead_memory.lead_quality]}
        >
          {leadQualityLabels[lead.lead_memory.lead_quality]}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          Last draft:{" "}
          {lead.lead_memory_last_generated_at
            ? formatDistanceToNow(new Date(lead.lead_memory_last_generated_at), {
                addSuffix: true,
              })
            : "Not generated yet"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-full px-3 text-xs"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCw className="h-3.5 w-3.5" />
          )}
          Refresh AI Draft
        </Button>
      </div>

      {lead.lead_memory_last_error ? (
        <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {lead.lead_memory_last_error}
        </div>
      ) : null}

      {message ? (
        <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {CONTACT_LEAD_MEMORY_KEYS.map((key) => {
          const isOverridden = hasLeadMemoryOverride(overrideMemory, key);

          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`lead-memory-${lead.id}-${key}`}>
                  {getFieldLabel(key)}
                </Label>
                {isOverridden ? (
                  <button
                    type="button"
                    onClick={() => void handleFieldReset(key)}
                    className="text-[11px] font-medium text-amber-600 hover:underline"
                  >
                    Use AI draft
                  </button>
                ) : null}
              </div>

              {key === "lead_quality" ? (
                <select
                  id={`lead-memory-${lead.id}-${key}`}
                  value={memoryDraft[key]}
                  onChange={(event) =>
                    setMemoryDraft((current) => ({
                      ...current,
                      [key]: event.target.value as typeof current.lead_quality,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="unknown">Unknown</option>
                  <option value="cold">Cold</option>
                  <option value="warm">Warm</option>
                  <option value="hot">Hot</option>
                </select>
              ) : key === "name_confidence" ? (
                <select
                  id={`lead-memory-${lead.id}-${key}`}
                  value={memoryDraft[key]}
                  onChange={(event) =>
                    setMemoryDraft((current) => ({
                      ...current,
                      [key]: event.target.value as typeof current.name_confidence,
                    }))
                  }
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="unknown">Unknown</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              ) : isMultilineField(key) ? (
                <Textarea
                  id={`lead-memory-${lead.id}-${key}`}
                  value={memoryDraft[key]}
                  onChange={(event) =>
                    setMemoryDraft((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  rows={3}
                  className="resize-none"
                />
              ) : (
                <Input
                  id={`lead-memory-${lead.id}-${key}`}
                  value={memoryDraft[key]}
                  onChange={(event) =>
                    setMemoryDraft((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              )}
            </div>
          );
        })}

        <div className="space-y-1.5">
          <Label htmlFor={`staff-note-${lead.id}`}>Staff Note</Label>
          <Textarea
            id={`staff-note-${lead.id}`}
            rows={3}
            value={staffNote}
            onChange={(event) => setStaffNote(event.target.value)}
            placeholder="Internal note for the team."
            className="resize-none"
          />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          className="w-full gap-2"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          {saving ? "Saving..." : "Save Lead Memory"}
        </Button>
      </div>
    </div>
  );
}
