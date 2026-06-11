"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatThread } from "@/components/inbox/ChatThread";
import { ContactPanel } from "@/components/inbox/ContactPanel";
import { ConversationList } from "@/components/inbox/ConversationList";
import { useToast } from "@/components/ui/Toaster";
import { createClient } from "@/lib/supabase/client";
import type { AppContact, AppMessage, MessageTemplate, StaffUser } from "@/types/app.types";

type FilterValue = "all" | "unread" | "bot" | "human";

interface InboxScreenProps {
  clinicId: string;
  initialContactId?: string | null;
}

const CONTACT_SELECT =
  "id, clinic_id, full_name, phone_e164, treatment_interest, treatment_category, current_status, assigned_user_id, source, campaign_name, unread_count, bot_mode, last_inbound_at, last_outbound_at, appointment_date, appointment_time, reminder_sent_at, staff_note, attendance_status, revenue_generated_myr, automation_enabled, ai_last_intent, ai_last_confidence, last_handoff_reason, next_follow_up_at, lead_memory_auto, lead_memory_override, created_at, updated_at";

const MESSAGE_SELECT =
  "id, clinic_id, contact_id, provider_message_id, direction, sender_type, content, ai_generated, created_at";

function mapContact(row: Record<string, unknown>, staffById: Map<string, string>, preview?: AppMessage): AppContact {
  const assignedUserId = (row.assigned_user_id as string | null) ?? null;

  return {
    id: row.id as string,
    clinic_id: row.clinic_id as string,
    full_name: (row.full_name as string | null) ?? "Unknown lead",
    phone_e164: (row.phone_e164 as string | null) ?? "",
    treatment_interest: (row.treatment_interest as string | null) ?? null,
    current_status: (row.current_status as string | null) ?? "new_lead",
    assigned_user_id: assignedUserId,
    source: (row.source as string | null) ?? null,
    campaign_name: (row.campaign_name as string | null) ?? null,
    treatment_category: (row.treatment_category as string | null) ?? null,
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
    automation_enabled: row.automation_enabled !== false,
    ai_last_intent: (row.ai_last_intent as string | null) ?? null,
    ai_last_confidence:
      row.ai_last_confidence != null ? Number(row.ai_last_confidence) : null,
    last_handoff_reason: (row.last_handoff_reason as string | null) ?? null,
    next_follow_up_at: (row.next_follow_up_at as string | null) ?? null,
    lead_memory_auto:
      (row.lead_memory_auto as Record<string, unknown> | null) ?? null,
    lead_memory_override:
      (row.lead_memory_override as Record<string, unknown> | null) ?? null,
    created_at: (row.created_at as string | null) ?? new Date().toISOString(),
    updated_at: (row.updated_at as string | null) ?? new Date().toISOString(),
    last_message_preview: preview?.content ?? "",
    last_message_at: preview?.created_at ?? null,
    assigned_user_name: assignedUserId ? staffById.get(assignedUserId) ?? null : null,
  };
}

function mapMessage(row: Record<string, unknown>): AppMessage {
  return {
    id: row.id as string,
    clinic_id: (row.clinic_id as string | undefined) ?? undefined,
    contact_id: row.contact_id as string,
    provider_message_id: (row.provider_message_id as string | null) ?? null,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    sender_type:
      row.sender_type === "bot" ||
      row.sender_type === "human" ||
      row.sender_type === "system"
        ? row.sender_type
        : "lead",
    content: (row.content as string | null) ?? "",
    ai_generated: (row.ai_generated as boolean | null) ?? false,
    created_at: (row.created_at as string | null) ?? new Date().toISOString(),
  };
}

export function InboxScreen({ clinicId, initialContactId }: InboxScreenProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    initialContactId ?? null
  );
  const [filter, setFilter] = useState<FilterValue>("all");
  const [contactsLoading, setContactsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) ?? null,
    [contacts, selectedContactId]
  );

  const loadTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("message_templates")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("show_as_quick_reply", true)
      .order("created_at", { ascending: false });

    if (error) {
      setTemplates([]);
      return;
    }

    setTemplates((data ?? []) as MessageTemplate[]);
  }, [clinicId]);

  const loadContacts = useCallback(async () => {
    const supabase = createClient();
    setContactsLoading(true);

    const [contactsResult, messagesResult, staffResult] = await Promise.all([
      supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("clinic_id", clinicId)
        .order("last_inbound_at", { ascending: false, nullsFirst: false })
        .limit(300),
      supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("users")
        .select("id, clinic_id, full_name, email, role, status, created_at")
        .eq("clinic_id", clinicId),
    ]);

    const staffRows = ((staffResult.data ?? []) as StaffUser[]) ?? [];
    const staffById = new Map(staffRows.map((member) => [member.id, member.full_name]));
    const previewByContact = new Map<string, AppMessage>();

    for (const row of (messagesResult.data ?? []) as Array<Record<string, unknown>>) {
      const message = mapMessage(row);
      if (!previewByContact.has(message.contact_id)) {
        previewByContact.set(message.contact_id, message);
      }
    }

    if (!contactsResult.error) {
      setContacts(
        ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) =>
          mapContact(row, staffById, previewByContact.get(row.id as string))
        )
      );
    }

    setStaff(staffRows);
    setContactsLoading(false);
  }, [clinicId]);

  const loadMessages = useCallback(async (contactId: string) => {
    const supabase = createClient();
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true });

    if (!error) {
      setMessages(((data ?? []) as Array<Record<string, unknown>>).map(mapMessage));
    }

    setMessagesLoading(false);
  }, [clinicId]);

  const patchContact = useCallback(
    async (contactId: string, updates: Partial<AppContact>) => {
      setContacts((current) =>
        current.map((contact) =>
          contact.id === contactId
            ? { ...contact, ...updates, updated_at: new Date().toISOString() }
            : contact
        )
      );

      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        toast("error", payload.error || "Failed to update contact. Changes were reverted.");
        await loadContacts();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        contact?: Record<string, unknown>;
      };

      if (payload.contact) {
        const staffById = new Map(staff.map((member) => [member.id, member.full_name]));
        setContacts((current) =>
          current.map((contact) =>
            contact.id === contactId
              ? {
                  ...contact,
                  ...mapContact(
                    {
                      ...contact,
                      ...payload.contact,
                    },
                    staffById,
                    contact.last_message_preview
                      ? {
                          id: "preview",
                          clinic_id: clinicId,
                          contact_id: contact.id,
                          content: contact.last_message_preview,
                          direction: "inbound",
                          sender_type: "lead",
                          created_at: contact.last_message_at ?? contact.updated_at,
                        }
                      : undefined
                  ),
                }
              : contact
          )
        );
      }
    },
    [clinicId, loadContacts, staff, toast]
  );

  const selectContact = useCallback(
    (contact: AppContact) => {
      setSelectedContactId(contact.id);
      router.replace(`/inbox?contact_id=${contact.id}`, { scroll: false });

      if (contact.unread_count > 0) {
        void patchContact(contact.id, { unread_count: 0 });
      }
    },
    [patchContact, router]
  );

  async function sendMessage(content: string) {
    if (!selectedContact) {
      return;
    }

    const nowIso = new Date().toISOString();
    const tempMessage: AppMessage = {
      id: `temp-${Date.now()}`,
      clinic_id: clinicId,
      contact_id: selectedContact.id,
      direction: "outbound",
      sender_type: "human",
      content,
      ai_generated: false,
      created_at: nowIso,
    };

    setSending(true);
    setMessages((current) => [...current, tempMessage]);
    setContacts((current) =>
      current.map((contact) =>
        contact.id === selectedContact.id
          ? {
              ...contact,
              bot_mode: "paused",
              last_outbound_at: nowIso,
              last_message_preview: content,
              last_message_at: nowIso,
            }
          : contact
      )
    );

    const response = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: selectedContact.id,
        message: content,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      toast("error", payload.error || "Message failed to send.");
      setMessages((current) => current.filter((message) => message.id !== tempMessage.id));
    } else {
      await loadMessages(selectedContact.id);
      await loadContacts();
    }

    setSending(false);
  }

  useEffect(() => {
    void loadContacts();
    void loadTemplates();
  }, [loadContacts, loadTemplates]);

  useEffect(() => {
    const supabase = createClient();
    const contactsChannel = supabase
      .channel(`inbox-contacts:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          void loadContacts();
        }
      )
      .subscribe();

    const messagesChannel = supabase
      .channel(`inbox-message-list:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          void loadContacts();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(contactsChannel);
      void supabase.removeChannel(messagesChannel);
    };
  }, [clinicId, loadContacts]);

  useEffect(() => {
    if (!selectedContactId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedContactId);
    const supabase = createClient();
    const channel = supabase
      .channel(`messages:${selectedContactId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `contact_id=eq.${selectedContactId}`,
        },
        (payload) => {
          const message = mapMessage(payload.new as Record<string, unknown>);
          setMessages((current) =>
            current.some((row) => row.id === message.id) ? current : [...current, message]
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMessages, selectedContactId]);

  useEffect(() => {
    if (contacts.length === 0) {
      return;
    }

    if (selectedContactId && contacts.some((contact) => contact.id === selectedContactId)) {
      return;
    }

    const preferred =
      (initialContactId && contacts.find((contact) => contact.id === initialContactId)) ??
      contacts.find((contact) => contact.unread_count > 0) ??
      contacts[0];

    if (preferred) {
      selectContact(preferred);
    }
  }, [contacts, initialContactId, selectContact, selectedContactId]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ConversationList
        contacts={contacts}
        selectedContactId={selectedContactId}
        filter={filter}
        onFilterChange={setFilter}
        onSelect={selectContact}
        loading={contactsLoading}
      />
      <ChatThread
        contact={selectedContact}
        messages={messages}
        templates={templates}
        sending={sending || messagesLoading}
        onPatchContact={patchContact}
        onSendMessage={sendMessage}
      />
      <ContactPanel
        contact={selectedContact}
        staff={staff}
        onPatchContact={patchContact}
      />
    </div>
  );
}
