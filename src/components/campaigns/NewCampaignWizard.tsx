"use client";

import { useEffect, useMemo, useState } from "react";

import { StepMessage, type MessageState } from "@/components/campaigns/StepMessage";
import { StepSchedule, type ScheduleState } from "@/components/campaigns/StepSchedule";
import { StepSegment, type SegmentState } from "@/components/campaigns/StepSegment";
import { normalizeStatus } from "@/lib/frontdesk";
import { createClient } from "@/lib/supabase/client";
import type { AppContact, MessageTemplate } from "@/types/app.types";

interface NewCampaignWizardProps {
  clinicId: string;
  onLaunched: () => void;
}

const CONTACT_SELECT =
  "id, clinic_id, full_name, phone_e164, treatment_interest, current_status, source, created_at";

function mapContact(row: Record<string, unknown>): AppContact {
  return {
    id: row.id as string,
    clinic_id: row.clinic_id as string,
    full_name: (row.full_name as string | null) ?? "Unknown lead",
    phone_e164: (row.phone_e164 as string | null) ?? "",
    treatment_interest: (row.treatment_interest as string | null) ?? null,
    current_status: (row.current_status as string | null) ?? "new_lead",
    assigned_user_id: null,
    source: (row.source as string | null) ?? null,
    campaign_name: (row.campaign_name as string | null) ?? null,
    treatment_category: (row.treatment_category as string | null) ?? null,
    unread_count: 0,
    bot_mode: "active",
    last_inbound_at: null,
    last_outbound_at: null,
    appointment_date: null,
    appointment_time: null,
    reminder_sent_at: null,
    staff_note: null,
    attendance_status: null,
    revenue_generated_myr: null,
    created_at: (row.created_at as string | null) ?? new Date().toISOString(),
    updated_at: (row.created_at as string | null) ?? new Date().toISOString(),
  };
}

export function NewCampaignWizard({ clinicId, onLaunched }: NewCampaignWizardProps) {
  const [step, setStep] = useState(1);
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [segment, setSegment] = useState<SegmentState>({
    statuses: [],
    treatments: [],
    sources: [],
    dateAdded: "30d",
  });
  const [message, setMessage] = useState<MessageState>({
    name: "",
    body: "",
    templateId: "",
  });
  const [schedule, setSchedule] = useState<ScheduleState>({
    sendNow: true,
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    dailySendCap: 100,
    stopOnInvalidNumber: true,
  });
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      const [contactsResult, templatesResponse] = await Promise.all([
        supabase
          .from("contacts")
          .select(CONTACT_SELECT)
          .eq("clinic_id", clinicId)
          .order("created_at", { ascending: false }),
        fetch("/api/templates", { cache: "no-store" }),
      ]);

      if (!contactsResult.error) {
        setContacts(((contactsResult.data ?? []) as Array<Record<string, unknown>>).map(mapContact));
      }

      if (templatesResponse.ok) {
        const payload = (await templatesResponse.json()) as { templates: MessageTemplate[] };
        setTemplates(payload.templates);
      }
    }

    void loadData();
  }, [clinicId]);

  const treatments = useMemo(
    () =>
      [...new Set(contacts.map((contact) => contact.treatment_interest).filter(Boolean) as string[])].sort(),
    [contacts]
  );
  const sources = useMemo(
    () => [...new Set(contacts.map((contact) => contact.source).filter(Boolean) as string[])].sort(),
    [contacts]
  );

  const matchingContacts = useMemo(() => {
    const now = Date.now();
    const ageLimitMs =
      segment.dateAdded === "7d"
        ? 7 * 86400000
        : segment.dateAdded === "30d"
          ? 30 * 86400000
          : segment.dateAdded === "90d"
            ? 90 * 86400000
            : null;

    return contacts.filter((contact) => {
      if (
        segment.statuses.length > 0 &&
        !segment.statuses.includes(normalizeStatus(contact.current_status))
      ) {
        return false;
      }
      if (
        segment.treatments.length > 0 &&
        (!contact.treatment_interest || !segment.treatments.includes(contact.treatment_interest))
      ) {
        return false;
      }
      if (
        segment.sources.length > 0 &&
        (!contact.source || !segment.sources.includes(contact.source))
      ) {
        return false;
      }
      if (ageLimitMs !== null) {
        const createdAt = new Date(contact.created_at).getTime();
        if (Number.isNaN(createdAt) || now - createdAt > ageLimitMs) return false;
      }
      return true;
    });
  }, [contacts, segment]);

  async function launchCampaign() {
    setLaunching(true);
    setError("");

    const scheduledFor = schedule.sendNow
      ? null
      : new Date(`${schedule.date}T${schedule.time}`).toISOString();

    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: message.name.trim(),
        delivery_type: schedule.sendNow ? "send_now" : "scheduled",
        message_template: message.body.trim(),
        segment_filters: [],
        manual_recipients: matchingContacts.map((contact) => ({
          phone_e164: contact.phone_e164,
          full_name: contact.full_name,
          treatment_interest: contact.treatment_interest ?? undefined,
        })),
        scheduled_for: scheduledFor,
        daily_send_cap: schedule.dailySendCap,
        stop_on_invalid_number: schedule.stopOnInvalidNumber,
      }),
    });

    setLaunching(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Failed to launch campaign.");
      return;
    }

    setStep(1);
    setMessage({ name: "", body: "", templateId: "" });
    onLaunched();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-white">
      <div className="border-b border-[var(--border-subtle)] px-3 py-3">
        <div className="flex items-center justify-center gap-2 text-[11px]">
          {[1, 2, 3].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <span
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold",
                  item < step
                    ? "border-[var(--brand-gold)] bg-[var(--brand-gold)] text-white"
                    : item === step
                      ? "border-[var(--brand-gold)] bg-white text-[var(--brand-gold-dark)]"
                      : "border-[var(--border-default)] bg-[var(--surface-subtle)] text-[var(--text-muted)]",
                ].join(" ")}
              >
                {item}
              </span>
              <span className="text-[var(--text-secondary)]">
                {item === 1 ? "Segment" : item === 2 ? "Message" : "Schedule"}
              </span>
              {item < 3 ? <span className="text-[var(--border-strong)]">----</span> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 fd-scrollbar">
        {error ? (
          <div className="mb-3 rounded-[6px] bg-[var(--danger-bg)] px-3 py-2 text-[11px] text-[var(--danger-text)]">
            {error}
          </div>
        ) : null}
        {step === 1 ? (
          <StepSegment
            segment={segment}
            treatments={treatments}
            sources={sources}
            previewCount={matchingContacts.length}
            onChange={setSegment}
            onNext={() => setStep(2)}
          />
        ) : null}
        {step === 2 ? (
          <StepMessage
            message={message}
            templates={templates}
            onChange={setMessage}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        ) : null}
        {step === 3 ? (
          <StepSchedule
            schedule={schedule}
            launching={launching}
            onChange={setSchedule}
            onBack={() => setStep(2)}
            onLaunch={() => void launchCampaign()}
          />
        ) : null}
      </div>
    </section>
  );
}
