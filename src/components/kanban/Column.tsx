"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Lead } from "@/types";
import { BoardColumn as ColumnType } from "@/store";
import { LeadCard } from "./LeadCard";

interface ColumnProps {
  column: {
    id: ColumnType;
    title: string;
  };
  leads: Lead[];
}

export function Column({ column, leads }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: "Column",
      column,
    },
  });

  return (
    <div className="flex flex-col flex-1 w-[320px] min-w-[320px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground/80">{column.title}</h3>
        <span className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
          {leads.length}
        </span>
      </div>
      
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto overflow-x-hidden space-y-3 p-2 -mx-2 rounded-xl transition-colors ${
          isOver ? "bg-muted/50 border border-border/50 border-dashed" : "border border-transparent"
        }`}
      >
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>
        
        {leads.length === 0 && (
          <div className="h-full min-h-[150px] rounded-xl border border-dashed border-border/60 flex items-center justify-center text-sm text-muted-foreground/60">
            Drop leads here
          </div>
        )}
      </div>
    </div>
  );
}
