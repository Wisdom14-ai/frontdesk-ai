"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { notifyContactsChanged, notifyMessagesChanged, subscribeToContactsChanged } from "@/lib/crm-events";
import { mapContactRecordToLead } from "@/lib/crm-data";
import { useAppStore, type BoardColumn } from "@/store";
import type {
  AutomationRunNowSummary,
  AutomationSettingsPayload,
  BroadcastCampaignCreatePayload,
  BroadcastCampaignListPayload,
  BroadcastCampaignRunNowSummary,
  ClinicSettings,
  ContactLeadMemory,
  ContactLeadMemoryKey,
  ContactMemoryBackfillSummary,
  ContactMemoryRunSummary,
  CsvImportSummary,
  Lead,
  StaffMember,
  WhatsappConnectionState,
} from "@/types";

const CRM_POLL_INTERVAL_MS = 15_000;

const columnToStatus: Record<BoardColumn, string> = {
  "New Lead": "new_lead",
  "No Respond": "no_respond",
  "Booked Appointment": "booked_appointment",
  Attended: "attended_visit",
  "No Show": "no_show",
  Trash: "trash",
  Patient: "patient",
};

export { columnToStatus };

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

export function useContacts() {
  const setLeads = useAppStore((state) => state.setLeads);
  const setLoading = useAppStore((state) => state.setLoading);
  const hasLoadedRef = useRef(false);

  const fetchContacts = useCallback(async () => {
    const shouldToggleLoading = !hasLoadedRef.current;

    if (shouldToggleLoading) {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/contacts", {
        cache: "no-store",
      });
      const payload = await readJson<{ leads: Lead[] }>(response);
      setLeads(payload.leads);
    } catch (error) {
      console.error("Failed to load leads:", error);
      if (!hasLoadedRef.current) {
        setLeads([]);
      }
    } finally {
      hasLoadedRef.current = true;
      if (shouldToggleLoading) {
        setLoading(false);
      }
    }
  }, [setLeads, setLoading]);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchContacts();
      }
    }, CRM_POLL_INTERVAL_MS);

    const unsubscribeContactsChanged = subscribeToContactsChanged(() => {
      void fetchContacts();
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchContacts();
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        void fetchContacts();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      unsubscribeContactsChanged();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchContacts]);

  return { refetch: fetchContacts };
}

export async function sendMessage(contactId: string, message: string) {
  try {
    const response = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        message,
      }),
    });
    await readJson<{ success: true; sent: true }>(response);
    notifyMessagesChanged(contactId);
    notifyContactsChanged();
    return { success: true };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}

export async function updateContact(
  contactId: string,
  payload: {
    full_name?: string;
    treatment_interest?: string;
    source?: string;
    campaign_name?: string;
    status?: string;
    appointment_date?: string | null;
    appointment_time?: string | null;
    bot_mode?: "active" | "paused" | "handoff_required";
    automation_enabled?: boolean;
    marketing_opt_out?: boolean;
    marketing_opt_out_reason?: string | null;
    unread_count?: number;
    staff_note?: string | null;
    lead_memory_override?: Partial<ContactLeadMemory>;
    clear_lead_memory_override?: ContactLeadMemoryKey[];
  }
) {
  try {
    const response = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJson<{ contact: Record<string, unknown> }>(response);
    notifyContactsChanged();
    return { success: true, contact: mapContactRecordToLead(data.contact) };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}

export async function updateContactStatus(contactId: string, newColumn: BoardColumn) {
  const result = await updateContact(contactId, {
    status: columnToStatus[newColumn],
  });
  return result.success;
}

export async function createContact(data: {
  full_name: string;
  phone_e164: string;
  treatment_interest?: string;
  source?: string;
  campaign_name?: string;
}) {
  try {
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = await readJson<{ contact: Record<string, unknown> }>(response);
    notifyContactsChanged();
    return { data: mapContactRecordToLead(payload.contact) };
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function importContacts(leads: {
  full_name: string;
  phone_e164: string;
  treatment_interest?: string;
  source?: string;
  campaign_name?: string;
}[]) {
  try {
    const response = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leads }),
    });
    const payload = await readJson<{ summary: CsvImportSummary }>(response);
    notifyContactsChanged();
    return { summary: payload.summary };
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function logRevenue(contactId: string, amount: number, note?: string) {
  try {
    const response = await fetch("/api/revenue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, amount, note }),
    });
    await readJson<{ success: true }>(response);
    notifyContactsChanged();
    return { success: true };
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function logAuditEvent(
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Record<string, unknown>
) {
  try {
    const response = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, resourceType, resourceId, details }),
    });
    await readJson<{ success: true }>(response);
    return { success: true };
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function markAsRead(contactId: string) {
  const response = await fetch(`/api/contacts/${contactId}/read`, {
    method: "POST",
  });
  await readJson<{ success: true }>(response);
  notifyContactsChanged();
}

export function useClinic() {
  const [clinic, setClinic] = useState<ClinicSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClinic = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/clinic", {
        cache: "no-store",
      });
      const payload = await readJson<{ clinic: ClinicSettings }>(response);
      setClinic(payload.clinic);
    } catch {
      setClinic(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClinic();
  }, [fetchClinic]);

  return { clinic, loading, setClinic, fetchClinic };
}

export async function updateClinic(
  _clinicId: string,
  data: {
    name?: string;
    owner_name?: string;
    owner_phone?: string;
    clinic_prompt?: string;
  }
) {
  try {
    const response = await fetch("/api/clinic", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = await readJson<{ clinic: ClinicSettings }>(response);
    return { success: true, clinic: payload.clinic };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}

export async function fetchWhatsappConnection(includeQr = false) {
  try {
    const response = await fetch(
      `/api/clinic/whatsapp${includeQr ? "?includeQr=1" : ""}`,
      {
        cache: "no-store",
      }
    );
    const payload = await readJson<{
      connection: WhatsappConnectionState;
      platformConfigured: boolean;
    }>(response);
    return payload;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function startWhatsappConnection() {
  try {
    const response = await fetch("/api/clinic/whatsapp", {
      method: "POST",
    });
    const payload = await readJson<{
      connection: WhatsappConnectionState;
      platformConfigured: boolean;
    }>(response);
    return payload;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function disconnectWhatsappConnection() {
  try {
    const response = await fetch("/api/clinic/whatsapp", {
      method: "DELETE",
    });
    await readJson<{ success: true }>(response);
    return { success: true };
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function refreshContactMemory(contactId: string) {
  try {
    const response = await fetch(`/api/contacts/${contactId}/memory/refresh`, {
      method: "POST",
    });
    return await readJson<{ success: true }>(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function queueContactMemoryBackfill(
  path = "/api/contact-memory/backfill"
) {
  try {
    const response = await fetch(path, {
      method: "POST",
    });
    return await readJson<{ summary: ContactMemoryBackfillSummary }>(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function runContactMemoryNow(
  path = "/api/contact-memory/run-now"
) {
  try {
    const response = await fetch(path, {
      method: "POST",
    });
    return await readJson<ContactMemoryRunSummary>(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export function useStaff() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceRoleConfigured, setServiceRoleConfigured] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/staff", {
        cache: "no-store",
      });
      const payload = await readJson<{
        staff: StaffMember[];
        serviceRoleConfigured: boolean;
      }>(response);
      setStaff(payload.staff);
      setServiceRoleConfigured(payload.serviceRoleConfigured);
    } catch {
      setStaff([]);
      setServiceRoleConfigured(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  return { staff, loading, fetchStaff, setStaff, serviceRoleConfigured };
}

export function useAutomation(path = "/api/automation") {
  const [rules, setRules] = useState<AutomationSettingsPayload["rules"]>([]);
  const [health, setHealth] = useState<AutomationSettingsPayload["health"] | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAutomation = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(path, {
        cache: "no-store",
      });
      const payload = await readJson<AutomationSettingsPayload>(response);
      setRules(payload.rules);
      setHealth(payload.health);
    } catch (fetchError) {
      setRules([]);
      setHealth(null);
      setError(toErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void fetchAutomation();
  }, [fetchAutomation]);

  return {
    rules,
    health,
    loading,
    error,
    fetchAutomation,
    setRules,
    setHealth,
  };
}

export async function updateAutomationRule(data: {
  ruleKey: string;
  isEnabled: boolean;
  delayHours: number;
  templateBody: string;
}, path = "/api/automation") {
  try {
    const response = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await readJson<AutomationSettingsPayload>(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function runAutomationNow(path = "/api/automation/run-now") {
  try {
    const response = await fetch(path, {
      method: "POST",
    });
    return await readJson<AutomationRunNowSummary>(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export function useCampaigns(path = "/api/campaigns") {
  const [campaigns, setCampaigns] = useState<BroadcastCampaignListPayload["campaigns"]>([]);
  const [analytics, setAnalytics] =
    useState<BroadcastCampaignListPayload["analytics"] | null>(null);
  const [health, setHealth] =
    useState<BroadcastCampaignListPayload["health"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(path, {
        cache: "no-store",
      });
      const payload = await readJson<BroadcastCampaignListPayload>(response);
      setCampaigns(payload.campaigns);
      setAnalytics(payload.analytics);
      setHealth(payload.health);
    } catch (fetchError) {
      setCampaigns([]);
      setAnalytics(null);
      setHealth(null);
      setError(toErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  return {
    campaigns,
    analytics,
    health,
    loading,
    error,
    fetchCampaigns,
    setCampaigns,
  };
}

export async function createCampaign(
  data: BroadcastCampaignCreatePayload,
  path = "/api/campaigns"
) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await readJson<
      BroadcastCampaignListPayload & { summary: BroadcastCampaignRunNowSummary | null }
    >(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function cancelCampaign(campaignId: string) {
  try {
    const response = await fetch(`/api/campaigns/${campaignId}`, {
      method: "DELETE",
    });
    return await readJson<{ campaign: BroadcastCampaignListPayload["campaigns"][number] }>(
      response
    );
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function runCampaignsNow(path = "/api/campaigns/run-now") {
  try {
    const response = await fetch(path, {
      method: "POST",
    });
    return await readJson<BroadcastCampaignRunNowSummary>(response);
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function inviteStaffMember(data: {
  email: string;
  full_name: string;
  role: "admin" | "manager" | "receptionist";
}) {
  try {
    const response = await fetch("/api/staff/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = await readJson<{ success: true; user_id: string }>(response);
    return payload;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}

export async function updateStaffMember(
  staffId: string,
  payload: {
    action: "update_role" | "disable" | "activate" | "resend_invite";
    role?: "admin" | "manager" | "receptionist";
  }
) {
  try {
    const response = await fetch(`/api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await readJson<{ success: true }>(response);
    return { success: true };
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
}
