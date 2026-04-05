"use client";

import { useAppStore } from "@/store";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MessageTimeline } from "./MessageTimeline";
import { ChatComposer } from "./ChatComposer";
import { LeadDetailsForm } from "./LeadDetailsForm";
import { AiControlPanel } from "./AiControlPanel";
import { LeadMemoryCard } from "./LeadMemoryCard";

export function ChatSheet() {
  const { sheetOpen, closeSheet, selectedLeadId, leads } = useAppStore();

  const activeLead = leads.find((l) => l.id === selectedLeadId);

  return (
    <Sheet open={sheetOpen} onOpenChange={(open) => !open && closeSheet()}>
      <SheetContent
        side="right"
        showCloseButton={true}
        className="!w-[95vw] !max-w-[1200px] !p-0 !gap-0 !flex !flex-row overflow-hidden"
      >
        {/* Accessible title (visually hidden) */}
        <SheetTitle className="sr-only">Chat with {activeLead?.full_name}</SheetTitle>

        {/* Left Zone: AI Control Panel */}
        <div className="hidden md:flex w-[220px] shrink-0 border-r border-border bg-muted/20 flex-col p-4 overflow-y-auto">
          <AiControlPanel lead={activeLead} />
        </div>

        {/* Center Zone: Message Timeline & Composer */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
            <div className="flex flex-col min-w-0">
              <h2 className="font-semibold text-base leading-tight truncate">
                {activeLead?.full_name || "Unknown Lead"}
              </h2>
              <span className="text-xs text-muted-foreground mt-0.5">
                {activeLead?.phone_e164}
              </span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <MessageTimeline leadId={selectedLeadId} />
          </div>

          {/* Composer */}
          <div className="p-4 border-t border-border bg-card shrink-0">
            <ChatComposer lead={activeLead} />
          </div>
        </div>

        {/* Right Zone: Lead Details Form — only on xl screens */}
        <div className="hidden xl:flex w-[320px] shrink-0 border-l border-border bg-card flex-col overflow-y-auto">
          <div className="flex flex-col gap-4 p-4">
            <LeadMemoryCard lead={activeLead} />
            <LeadDetailsForm lead={activeLead} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
