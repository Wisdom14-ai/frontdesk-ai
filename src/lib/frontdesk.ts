import type { AppContact, ContactStatus } from "@/types/app.types";

export const PIPELINE_COLUMNS: Array<{
  value: ContactStatus;
  label: string;
  color: string;
}> = [
  { value: "new_lead", label: "New lead", color: "#E24B4A" },
  { value: "contacted", label: "Contacted", color: "#3B8BD4" },
  { value: "appointment_set", label: "Appt set", color: "#EF9F27" },
  { value: "attended", label: "Attended", color: "#639922" },
  { value: "no_show", label: "No show", color: "#B4B2A9" },
  { value: "converted", label: "Converted", color: "#BA7517" },
];

export const STATUS_LABELS: Record<string, string> = {
  new_lead: "New",
  contacted: "Contacted",
  appointment_set: "Appt set",
  attended: "Attended",
  no_show: "No show",
  converted: "Converted",
  no_respond: "Contacted",
  booked_appointment: "Appt set",
  attended_visit: "Attended",
  patient: "Converted",
  trash: "No show",
};

export function normalizeStatus(value?: string | null): ContactStatus {
  switch (value) {
    case "contacted":
    case "no_respond":
      return "contacted";
    case "appointment_set":
    case "booked_appointment":
      return "appointment_set";
    case "attended":
    case "attended_visit":
      return "attended";
    case "converted":
    case "patient":
      return "converted";
    case "no_show":
    case "trash":
      return "no_show";
    default:
      return "new_lead";
  }
}

export function getStatusLabel(value?: string | null) {
  return STATUS_LABELS[value ?? ""] ?? "New";
}

export function getInitials(name?: string | null) {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "FD";
  }

  return parts.map((part) => part[0]?.toUpperCase()).join("");
}

export function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) {
    return "";
  }

  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("en-MY", { month: "short", day: "numeric" });
}

export function formatDateTime(date?: string | null, time?: string | null) {
  if (!date) {
    return "";
  }

  const label = new Date(`${date}T${time ?? "00:00"}`);
  if (Number.isNaN(label.getTime())) {
    return date;
  }

  const day = label.toLocaleDateString("en-MY", {
    month: "short",
    day: "numeric",
  });
  const hour = time
    ? label.toLocaleTimeString("en-MY", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return [day, hour].filter(Boolean).join(", ");
}

// "Today" / "Yesterday" / "12 June 2026" divider label for a message
// timestamp, like the date separators in WhatsApp threads.
export function formatDayLabel(value?: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const now = new Date();
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86400000
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString("en-MY", { weekday: "long" });
  }

  return date.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "long",
    year: now.getFullYear() === date.getFullYear() ? undefined : "numeric",
  });
}

// Most recent activity on a conversation, regardless of who sent it — the
// timestamp WhatsApp uses to order chats. Takes the max of every available
// timestamp so an outbound reply bumps the chat to the top just like an
// inbound message does.
export function getLastActivityAt(contact: AppContact): number {
  const candidates = [
    contact.last_message_at,
    contact.last_inbound_at,
    contact.last_outbound_at,
    contact.updated_at,
    contact.created_at,
  ];

  let latest = 0;
  for (const value of candidates) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
    }
  }

  return latest;
}

export function sortConversations(contacts: AppContact[]) {
  return [...contacts].sort(
    (left, right) => getLastActivityAt(right) - getLastActivityAt(left)
  );
}
