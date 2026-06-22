import type { AppContact, ContactStatus } from "@/types/app.types";

export const PIPELINE_COLUMNS: Array<{
  value: ContactStatus;
  label: string;
  color: string;
}> = [
  { value: "new_lead", label: "New Lead", color: "#B4B2A9" },
  { value: "contacted", label: "Responded", color: "#3B8BD4" },
  { value: "appointment_set", label: "Appointment Set", color: "#BA7517" },
  { value: "attended", label: "Attended", color: "#639922" },
  { value: "no_show", label: "No Show", color: "#E24B4A" },
  { value: "converted", label: "Patient", color: "#059669" },
];

export const STATUS_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  contacted: "Responded",
  appointment_set: "Appointment Set",
  attended: "Attended",
  no_show: "No Show",
  converted: "Patient",
  no_respond: "Responded",
  booked_appointment: "Appointment Set",
  attended_visit: "Attended",
  patient: "Patient",
  trash: "No Show",
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

// Most recent MESSAGE on a conversation, regardless of who sent it — the
// timestamp WhatsApp Web uses to order chats. An inbound or outbound message
// bumps the chat to the top; nothing else does.
//
// Deliberately excludes `updated_at`: that column bumps on any contact change
// (status move, bot toggle, assignment, staff note, AI memory refresh,
// automation sync…), which would yank conversations around out of message
// order — the exact "disturbed sequence" we want to avoid. `created_at` is
// kept only as a fallback so a brand-new contact with no messages yet still
// sorts sensibly by when it was added.
export function getLastActivityAt(contact: AppContact): number {
  const messageTimestamps = [
    contact.last_message_at,
    contact.last_inbound_at,
    contact.last_outbound_at,
  ];

  let latest = 0;
  for (const value of messageTimestamps) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
    }
  }

  // No messages on this contact yet — fall back to creation time so it still
  // has a stable position instead of sinking to the bottom at epoch 0.
  if (latest === 0 && contact.created_at) {
    const created = new Date(contact.created_at).getTime();
    if (!Number.isNaN(created)) {
      latest = created;
    }
  }

  return latest;
}

export function sortConversations(contacts: AppContact[]) {
  return [...contacts].sort(
    (left, right) => getLastActivityAt(right) - getLastActivityAt(left)
  );
}
