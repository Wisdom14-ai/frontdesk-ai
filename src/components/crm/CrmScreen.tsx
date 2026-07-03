"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterBar, type CrmFilters } from "@/components/crm/FilterBar";
import { KanbanBoard } from "@/components/crm/KanbanBoard";
import { normalizeStatus } from "@/lib/frontdesk";
import { createClient } from "@/lib/supabase/client";
import type { AppContact, ContactStatus, StaffUser } from "@/types/app.types";

interface CrmScreenProps {
  clinicId: string;
}

const CONTACT_SELECT =
  "id, clinic_id, full_name, phone_e164, current_status, treatment_interest, treatment_category, source, campaign_name, appointment_date, appointment_time, bot_mode, automation_enabled, marketing_opt_out_at, reminder_sent_at, assigned_user_id, unread_count, last_inbound_at, last_outbound_at, staff_note, attendance_status, revenue_generated_myr, created_at, updated_at";

function mapContact(row: Record<string, unknown>): AppContact {
  return {
    id: row.id as string,
    clinic_id: row.clinic_id as string,
    full_name: (row.full_name as string | null) ?? "Unknown lead",
    phone_e164: (row.phone_e164 as string | null) ?? "",
    treatment_interest: (row.treatment_interest as string | null) ?? null,
    treatment_category: (row.treatment_category as string | null) ?? null,
    current_status: (row.current_status as string | null) ?? "new_lead",
    assigned_user_id: (row.assigned_user_id as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    campaign_name: (row.campaign_name as string | null) ?? null,
    unread_count: Number(row.unread_count ?? 0) || 0,
    bot_mode:
      row.bot_mode === "paused" || row.bot_mode === "handoff_required"
        ? row.bot_mode
        : "active",
    automation_enabled: row.automation_enabled !== false,
    marketing_opt_out_at: (row.marketing_opt_out_at as string | null) ?? null,
    last_inbound_at: (row.last_inbound_at as string | null) ?? null,
    last_outbound_at: (row.last_outbound_at as string | null) ?? null,
    appointment_date: (row.appointment_date as string | null) ?? null,
    appointment_time: (row.appointment_time as string | null) ?? null,
    reminder_sent_at: (row.reminder_sent_at as string | null) ?? null,
    staff_note: (row.staff_note as string | null) ?? null,
    attendance_status: (row.attendance_status as string | null) ?? null,
    revenue_generated_myr:
      row.revenue_generated_myr != null
        ? Number(row.revenue_generated_myr)
        : null,
    created_at: (row.created_at as string | null) ?? new Date().toISOString(),
    updated_at: (row.updated_at as string | null) ?? new Date().toISOString(),
  };
}

export function CrmScreen({ clinicId }: CrmScreenProps) {
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [filters, setFilters] = useState<CrmFilters>({
    staffId: "",
    treatment: "",
    source: "",
    search: "",
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const loadAllContacts = useCallback(async () => {
    const supabase = createClient();
    const pageSize = 1000;
    const rows: Array<Record<string, unknown>> = [];

    // The Kanban board needs every lead in the pipeline, not just the most
    // recent ones — a lead sitting untouched in "new_lead" for months must
    // still show up. A single page used to cap this at 300 and silently
    // undercount clinics past that. Page through the full table instead.
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error || !data) {
        break;
      }

      rows.push(...(data as Array<Record<string, unknown>>));

      if (data.length < pageSize) {
        break;
      }
    }

    return rows;
  }, [clinicId]);

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const [contactRows, staffResult] = await Promise.all([
      loadAllContacts(),
      supabase
        .from("users")
        .select("id, clinic_id, full_name, email, role, status, created_at")
        .eq("clinic_id", clinicId),
    ]);

    setContacts(contactRows.map(mapContact));

    if (!staffResult.error) {
      setStaff((staffResult.data ?? []) as StaffUser[]);
    }
  }, [clinicId, loadAllContacts]);

  useEffect(() => {
    void loadData();
    const supabase = createClient();
    const channel = supabase
      .channel(`crm-contacts:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          void loadData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clinicId, loadData]);

  const handleMove = useCallback(
    async (contactId: string, status: ContactStatus) => {
      const target = contacts.find((contact) => contact.id === contactId);
      // Nothing to do if the card is dropped back into its own column.
      if (!target || normalizeStatus(target.current_status) === status) {
        return;
      }

      // Moving into these stages can trigger an automated WhatsApp to the
      // patient (no-show recovery / post-visit recall). A drag is a single
      // gesture, so confirm to avoid accidentally messaging someone.
      const AUTOMATION_TRIGGER_STAGES: ReadonlySet<ContactStatus> = new Set([
        "attended",
        "no_show",
      ]);
      if (
        AUTOMATION_TRIGGER_STAGES.has(status) &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Move "${target.full_name}" to "${
            status === "no_show" ? "No Show" : "Attended"
          }"? This can trigger an automated WhatsApp follow-up to this contact.`
        )
      ) {
        return;
      }

      const previousStatus = target.current_status;

      // Optimistic: move the card immediately so the drag feels instant.
      setContacts((current) =>
        current.map((contact) =>
          contact.id === contactId ? { ...contact, current_status: status } : contact
        )
      );

      try {
        const response = await fetch(`/api/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_status: status }),
        });

        if (!response.ok) {
          throw new Error("Failed to update stage.");
        }
      } catch {
        // Revert on failure so the board never lies about the saved stage.
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId
              ? { ...contact, current_status: previousStatus }
              : contact
          )
        );
      }
    },
    [contacts]
  );

  const treatments = useMemo(
    () =>
      [...new Set(contacts.map((contact) => contact.treatment_interest).filter(Boolean) as string[])].sort(),
    [contacts]
  );

  const sources = useMemo(
    () => [...new Set(contacts.map((contact) => contact.source).filter(Boolean) as string[])].sort(),
    [contacts]
  );

  const filteredContacts = useMemo(() => {
    const search = debouncedSearch.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (filters.staffId && contact.assigned_user_id !== filters.staffId) return false;
      if (filters.treatment && contact.treatment_interest !== filters.treatment) return false;
      if (filters.source && contact.source !== filters.source) return false;
      if (search) {
        const haystack = `${contact.full_name} ${contact.phone_e164}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [contacts, debouncedSearch, filters]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-base)]">
      <FilterBar
        filters={filters}
        staff={staff}
        treatments={treatments}
        sources={sources}
        onChange={setFilters}
      />
      <KanbanBoard contacts={filteredContacts} onMove={handleMove} />
    </div>
  );
}
