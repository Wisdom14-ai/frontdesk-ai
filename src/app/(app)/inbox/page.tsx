"use client";

import { getLeadMemoryPreview } from "@/lib/contact-memory";
import { useAppStore } from "@/store";
import { useContacts, markAsRead } from "@/lib/supabase/hooks";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageTimeline } from "@/components/chat/MessageTimeline";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { AiControlPanel } from "@/components/chat/AiControlPanel";
import { LeadMemoryCard } from "@/components/chat/LeadMemoryCard";
import { LeadDetailsForm } from "@/components/chat/LeadDetailsForm";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function InboxPage() {
  const leads = useAppStore((state) => state.leads);
  const loading = useAppStore((state) => state.loading);
  useContacts();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  const handleSelectLead = async (leadId: string) => {
    setSelectedLeadId(leadId);
    try {
      await markAsRead(leadId);
    } catch (e) {
      console.error("Failed to mark contact as read:", e);
    }
  };

  const filteredLeads = leads
    .filter((l) =>
      l.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.phone_e164.includes(searchQuery)
    )
    .sort((a, b) => {
      const dateA = new Date(a.updated_at).getTime();
      const dateB = new Date(b.updated_at).getTime();
      return dateB - dateA; // Sort by newest first
    });

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Inbox List */}
      <div className="w-80 flex flex-col border-r border-border bg-card">
        <div className="p-4 border-b border-border shrink-0">
          <h1 className="text-xl font-bold mb-4">Inbox</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search chats..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col">
            {loading ? (
              <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading conversations...
              </div>
            ) : null}
            {filteredLeads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => handleSelectLead(lead.id)}
                className={`p-4 flex flex-col gap-1 border-b border-border text-left hover:bg-muted/50 transition-colors ${
                  selectedLeadId === lead.id ? "bg-muted" : ""
                }`}
              >
                <div className="flex justify-between items-center w-full">
                  <span className="font-semibold text-sm truncate">{lead.full_name}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                    {formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate w-full">
                  {lead.phone_e164}
                </div>
                {getLeadMemoryPreview(lead.lead_memory) ? (
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {getLeadMemoryPreview(lead.lead_memory)}
                  </div>
                ) : null}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full">
                      {lead.status}
                    </span>
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {lead.lead_memory.lead_quality}
                    </span>
                  </div>
                  {lead.unread_count > 0 && (
                    <span className="bg-primary text-primary-foreground text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold">
                      {lead.unread_count}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {!loading && filteredLeads.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No conversations found.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
        {selectedLead ? (
          <>
            <div className="p-4 bg-card border-b border-border shrink-0 flex items-center justify-between shadow-sm z-10">
              <div>
                <h2 className="font-bold text-lg">{selectedLead.full_name}</h2>
                <p className="text-sm text-muted-foreground">{selectedLead.phone_e164}</p>
              </div>
            </div>
            
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col h-full">
                <div className="flex-1 overflow-y-auto p-4 mb-32 md:mb-24 lg:mb-20">
                  <MessageTimeline leadId={selectedLead.id} />
                </div>
                
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-card border-t border-border/50 shadow-[0_-4px_24px_-10px_rgba(0,0,0,0.1)] lg:right-80 z-20">
                  <ChatComposer lead={selectedLead} />
                </div>
              </div>

              {/* CRM Right Sidebar */}
              <div className="w-80 hidden lg:flex flex-col border-l border-border bg-card shrink-0 shadow-[-4px_0_24px_-10px_rgba(0,0,0,0.05)] z-30">
                <div className="flex-1 overflow-y-auto">
                  <div className="p-5 flex flex-col auto-rows-max gap-6 h-full">
                    <AiControlPanel lead={selectedLead} />
                    <LeadMemoryCard lead={selectedLead} />
                    <LeadDetailsForm lead={selectedLead} />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a conversation to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
