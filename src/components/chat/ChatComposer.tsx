"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Zap, Hand, Loader2 } from "lucide-react";
import { Lead } from "@/types";
import { useAppStore } from "@/store";
import { logAuditEvent, sendMessage, updateContact } from "@/lib/supabase/hooks";

const PRICING_TEMPLATE = "Hi! Our typical consultation is RM 50. For a specific procedure quote, could you share a bit more about what you're looking for, or would you prefer to come in for an assessment?";
const LOCATION_TEMPLATE = "We are located at 123 Health Ave, Medical Suite #4. You can find us on Waze/Google Maps. Parking is available in the building basement!";

export function ChatComposer({ lead }: { lead?: Lead }) {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const setLeads = useAppStore((state) => state.setLeads);
  const leads = useAppStore((state) => state.leads);

  if (!lead) return null;

  const handleTakeover = async () => {
    setLeads(leads.map((candidate) => candidate.id === lead.id ? { ...candidate, bot_mode: "paused" } : candidate));

    const result = await updateContact(lead.id, { bot_mode: "paused" });
    if (!result.success) {
      setLeads(leads);
      return;
    }

    await logAuditEvent("bot_takeover", "contact", lead.id, { reason: "manual_takeover" });
  };

  const handleSend = async () => {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    setSendError("");

    const result = await sendMessage(lead.id, text.trim());

    if (result.success) {
      setText("");
    } else {
      setSendError(result.error || "Failed to send message.");
    }

    setIsSending(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {lead.bot_mode === "active" && (
         <div className="flex items-center justify-between px-2 py-1.5 bg-primary/5 border border-primary/10 rounded-lg mb-1">
           <span className="text-xs text-primary/80 flex items-center gap-1"><Zap className="w-3 h-3" /> Agent is active and may reply automatically.</span>
           <button 
             onClick={handleTakeover}
             className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
           >
             <Hand className="w-3 h-3" /> Takeover
           </button>
         </div>
      )}

      {lead.bot_mode === "handoff_required" && (
        <div className="flex items-center px-2 py-1.5 bg-destructive/10 border border-destructive/20 rounded-lg mb-1">
           <span className="text-xs text-destructive font-medium flex items-center gap-1"><Hand className="w-3 h-3" /> Handoff requested. Agent is paused.</span>
        </div>
      )}

      {sendError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {sendError}
        </div>
      )}

      <div className="relative">
        <Textarea 
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          className="min-h-[80px] pr-12 resize-none rounded-xl"
        />
        <Button 
          size="icon" 
          onClick={handleSend}
          className="absolute right-2 bottom-2 rounded-lg h-8 w-8"
          disabled={!text.trim() || isSending}
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      
      <div className="flex items-center gap-2 mt-1">
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs rounded-full"
          onClick={() => setText(prev => prev ? prev + "\n" + PRICING_TEMPLATE : PRICING_TEMPLATE)}
        >
          Template: Pricing
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs rounded-full"
          onClick={() => setText(prev => prev ? prev + "\n" + LOCATION_TEMPLATE : LOCATION_TEMPLATE)}
        >
          Template: Location
        </Button>
      </div>
    </div>
  );
}
