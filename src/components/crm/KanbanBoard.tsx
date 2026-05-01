"use client";

import { KanbanColumn } from "@/components/crm/KanbanColumn";
import { PIPELINE_COLUMNS, normalizeStatus } from "@/lib/frontdesk";
import type { AppContact } from "@/types/app.types";

interface KanbanBoardProps {
  contacts: AppContact[];
}

export function KanbanBoard({ contacts }: KanbanBoardProps) {
  return (
    <div className="min-h-0 flex-1 overflow-x-auto p-3 fd-scrollbar">
      <div className="flex h-full min-w-max gap-3">
        {PIPELINE_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.value}
            title={column.label}
            status={column.value}
            color={column.color}
            contacts={contacts.filter(
              (contact) => normalizeStatus(contact.current_status) === column.value
            )}
          />
        ))}
      </div>
    </div>
  );
}
