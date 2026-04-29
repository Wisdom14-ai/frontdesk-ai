"use client";

import { useAppStore } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Lead } from "@/types";
import { logAuditEvent, updateContact } from "@/lib/supabase/hooks";

export function AiControlPanel({ lead }: { lead?: Lead }) {
  const setLeads = useAppStore((state) => state.setLeads);
  const leads = useAppStore((state) => state.leads);

  if (!lead) return null;

  const toggleBotMode = async () => {
    const newMode = lead.bot_mode === "active" ? "paused" : "active";
    setLeads(leads.map((candidate) => candidate.id === lead.id ? { ...candidate, bot_mode: newMode } : candidate));

    const result = await updateContact(lead.id, { bot_mode: newMode });
    if (!result.success) {
      setLeads(leads);
      return;
    }

    await logAuditEvent("toggle_bot_mode", "contact", lead.id, { new_mode: newMode });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          AI Status
        </h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">Mode</span>
            <Badge 
              variant={lead.bot_mode === "active" ? "default" : lead.bot_mode === "handoff_required" ? "destructive" : "secondary"}
              className="px-2"
            >
              {lead.bot_mode.replace("_", " ").toUpperCase()}
            </Badge>
          </div>
          
          <button 
            onClick={toggleBotMode}
            className="text-xs font-semibold mt-2 py-2 px-3 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors text-center w-full"
          >
            {lead.bot_mode === "active" ? "Pause Agent" : "Resume Agent"}
          </button>

          <div className="mt-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-muted-foreground">
            Follow-ups: {lead.automation_enabled === false ? "Paused" : "Enabled"}
          </div>
          {lead.marketing_opt_out_at ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
              Messaging stopped: {lead.marketing_opt_out_reason || "opted out"}.
            </div>
          ) : null}
        </div>
      </div>

      {lead.bot_mode === "handoff_required" && lead.last_handoff_reason ? (
        <div className="border-t border-border/50 pt-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Handoff
          </h3>
          <div className="p-3 bg-card rounded-lg border border-border/40 text-sm text-muted-foreground">
            {lead.last_handoff_reason}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border/50 pt-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Latest Intent
        </h3>
        <div className="p-3 bg-card rounded-lg border border-border/40 text-sm">
          {lead.ai_last_intent ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{lead.ai_last_intent}</span>
              {lead.ai_last_confidence && (
                <span className="text-xs text-muted-foreground">Confidence: {Math.round(lead.ai_last_confidence * 100)}%</span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground italic">No intent detected yet.</span>
          )}
        </div>
      </div>
    </div>
  );
}
