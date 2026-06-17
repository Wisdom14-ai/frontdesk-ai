"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterBar, type CrmFilters } from "@/components/crm/FilterBar";
import { KanbanBoard } from "@/components/crm/KanbanBoard";
import { createClient } from "@/lib/supabase/client";
import type { AppContact, StaffUser } from "@/types/app.types";

interface CrmScreenProps {
  clinicId: string;
}

const CONTACT_SELECT =
  "id, clinic_id, full_name, phone_e164, current_status, treatment_interest, treatment_category, source, campaign_name, appointment_date, appointment_time, bot_mode, reminder_sent_at, assigned_user_id, unread_count, last_inbound_at, last_outbound_at, staff_note, attendance_status, revenue_generated_myr, created_at, updated_at";

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

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const [contactsResult, staffResult] = await Promise.all([
      supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        // Bound the result set. An unbounded fetch hangs for clinics with a
        // large contact volume, leaving the pipeline stuck empty. The inbox
        // uses the same 300-row bound.
        .limit(300),
      supabase
        .from("users")
        .select("id, clinic_id, full_name, email, role, status, created_at")
        .eq("clinic_id", clinicId),
    ]);

    if (!contactsResult.error) {
      setContacts(((contactsResult.data ?? []) as Array<Record<string, unknown>>).map(mapContact));
    }

    if (!staffResult.error) {
      setStaff((staffResult.data ?? []) as StaffUser[]);
    }
  }, [clinicId]);

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
      <KanbanBoard contacts={filteredContacts} />
    </div>
  );
}
