"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getLeadMemoryPreview } from "@/lib/contact-memory";
import { Lead } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Bot, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAppStore } from "@/store";

interface LeadCardProps {
  lead: Lead;
}

export function LeadCard({ lead }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: {
      type: "Lead",
      lead,
    },
  });
  
  const openSheet = useAppStore((state) => state.openSheet);

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="opacity-50 border-2 border-primary/50 border-dashed rounded-2xl h-[180px] w-full"
      />
    );
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => openSheet(lead.id)}
      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow rounded-2xl border-border/50 bg-card hover:border-primary/50"
    >
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
        <div className="font-semibold text-sm truncate">{lead.full_name}</div>
        {lead.unread_count > 0 && (
          <Badge variant="destructive" className="h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
            {lead.unread_count}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0 pb-3">
        <div className="text-xs text-muted-foreground mb-2">{lead.phone_e164}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-normal text-xs bg-secondary/50 text-secondary-foreground">
            {lead.treatment_interest || "No treatment set"}
          </Badge>
          <Badge variant="outline" className="text-[10px] uppercase">
            {lead.lead_memory.lead_quality}
          </Badge>
        </div>
        {getLeadMemoryPreview(lead.lead_memory) ? (
          <div className="mt-3 text-xs leading-5 text-muted-foreground line-clamp-3">
            {getLeadMemoryPreview(lead.lead_memory)}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-between items-center text-muted-foreground">
        <div className="flex items-center text-xs gap-1">
          <Clock className="w-3 h-3" />
          <span>{formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true })}</span>
        </div>
        <div className="flex items-center gap-2">
          {lead.bot_mode === "active" ? (
             <Bot className="w-4 h-4 text-primary" />
          ) : lead.bot_mode === "handoff_required" ? (
             <User className="w-4 h-4 text-destructive animate-pulse" />
          ) : (
             <User className="w-4 h-4 text-muted-foreground" />
          )}
          {lead.assigned_user_id && <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[10px] text-accent font-medium border border-accent/20">A</div>}
        </div>
      </CardFooter>
    </Card>
  );
}
