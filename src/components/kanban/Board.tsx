"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useAppStore, BoardColumn as ColumnType } from "@/store";
import { useContacts, updateContactStatus } from "@/lib/supabase/hooks";
import { Lead } from "@/types";
import { Column } from "./Column";
import { LeadCard } from "./LeadCard";
import { RevenueDialog } from "./RevenueDialog";
import { AddLeadDialog } from "./AddLeadDialog";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLUMNS: { id: ColumnType; title: string }[] = [
  { id: "New Lead", title: "New Lead" },
  { id: "No Respond", title: "No Respond" },
  { id: "Booked Appointment", title: "Booked Appointment" },
  { id: "Attended", title: "Attended" },
  { id: "No Show", title: "No Show" },
  { id: "Patient", title: "Patient" },
  { id: "Trash", title: "Trash" },
];

export function Board() {
  const leads = useAppStore((state) => state.leads);
  const loading = useAppStore((state) => state.loading);
  const openRevenueDialog = useAppStore((state) => state.openRevenueDialog);
  const updateLeadStatus = useAppStore((state) => state.updateLeadStatus);
  const openAddLeadDialog = useAppStore((state) => state.openAddLeadDialog);
  
  // Hook fetches contacts from Supabase + subscribes to realtime
  useContacts();

  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragStart = (event: DragStartEvent) => {
    const lead = leads.find((l) => l.id === event.active.id);
    if (lead) setActiveLead(lead);
  };

  const onDragOver = () => {
    // Placeholder for reordering within columns (MVP: not needed)
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id;

    if (activeId === overId) return;

    const dragLead = leads.find((l) => l.id === activeId);
    if (!dragLead) return;

    const isOverAColumn = COLUMNS.some((col) => col.id === overId);
    let targetColumn: ColumnType = dragLead.status;

    if (isOverAColumn) {
      targetColumn = overId as ColumnType;
    } else {
      const overLead = leads.find((l) => l.id === overId);
      if (overLead) {
        targetColumn = overLead.status;
      }
    }

    if (dragLead.status !== targetColumn) {
      if (targetColumn === "Attended") {
        openRevenueDialog(dragLead.id);
        return;
      }

      // Optimistic update
      updateLeadStatus(activeId, targetColumn);
      // Persist to Supabase
      const success = await updateContactStatus(activeId, targetColumn);
      if (!success) {
        // Revert on failure
        updateLeadStatus(activeId, dragLead.status);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 w-full gap-4 overflow-x-auto p-4 pb-12">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              column={col}
              leads={leads.filter((l) => l.status === col.id)}
            />
          ))}

          {typeof window !== "undefined" && createPortal(
            <DragOverlay>
              {activeLead && <LeadCard lead={activeLead} />}
            </DragOverlay>,
            document.body
          )}
        </DndContext>

        {/* Floating Add Lead Button */}
        <Button
          onClick={openAddLeadDialog}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-xl bg-emerald-500 hover:bg-emerald-600 text-white p-0 z-50"
        >
          <Plus className="w-6 h-6" />
        </Button>
      </div>

      <RevenueDialog />
      <AddLeadDialog />
    </>
  );
}
