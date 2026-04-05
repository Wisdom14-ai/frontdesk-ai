import type {
  BroadcastSegmentField,
  BroadcastSegmentFieldOptionGroup,
  BroadcastSegmentFilter,
} from "@/types";

export const EMPTY_SEGMENT_VALUE = "__none__";
export const UNASSIGNED_SEGMENT_VALUE = "__unassigned__";

export interface BroadcastFilterRecord {
  current_status?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  treatment_interest?: string | null;
  assigned_user_id?: string | null;
  bot_mode?: string | null;
  automation_enabled?: boolean | null;
  unread_count?: number | null;
  appointment_date?: string | null;
}

export const CONTACT_STATUS_OPTIONS = [
  { value: "new_lead", label: "New Lead" },
  { value: "no_respond", label: "No Respond" },
  { value: "booked_appointment", label: "Booked Appointment" },
  { value: "attended_visit", label: "Attended" },
  { value: "no_show", label: "No Show" },
  { value: "patient", label: "Patient" },
  { value: "trash", label: "Trash" },
] as const;

export const BOT_MODE_OPTIONS = [
  { value: "active", label: "Agent Active" },
  { value: "paused", label: "Paused" },
  { value: "handoff_required", label: "Handoff Required" },
] as const;

export const AUTOMATION_STATE_OPTIONS = [
  { value: "enabled", label: "Automation Enabled" },
  { value: "disabled", label: "Automation Disabled" },
] as const;

export const UNREAD_STATE_OPTIONS = [
  { value: "unread", label: "Unread Only" },
  { value: "read", label: "Read Only" },
] as const;

export const APPOINTMENT_STATE_OPTIONS = [
  { value: "has_appointment", label: "Has Appointment" },
  { value: "no_appointment", label: "No Appointment" },
] as const;

export const BROADCAST_SEGMENT_FIELD_DEFINITIONS: Array<{
  field: BroadcastSegmentField;
  label: string;
  description: string;
}> = [
  {
    field: "status",
    label: "Pipeline Status",
    description: "Target leads by their CRM stage.",
  },
  {
    field: "source",
    label: "Lead Source",
    description: "Target Facebook, referral, Google, and other sources.",
  },
  {
    field: "campaign_name",
    label: "Campaign",
    description: "Reuse the campaign names already stored on leads.",
  },
  {
    field: "treatment_interest",
    label: "Treatment Interest",
    description: "Group by braces, whitening, skin treatment, and more.",
  },
  {
    field: "assigned_user_id",
    label: "Assigned Staff",
    description: "Target leads owned by a specific staff member.",
  },
  {
    field: "bot_mode",
    label: "Bot Mode",
    description: "Target active, paused, or handoff-required leads.",
  },
  {
    field: "automation_enabled",
    label: "Automation State",
    description: "Split between automation-enabled and disabled leads.",
  },
  {
    field: "unread_state",
    label: "Unread State",
    description: "Broadcast only to read or unread conversations.",
  },
  {
    field: "appointment_state",
    label: "Appointment State",
    description: "Target contacts with or without an appointment.",
  },
] as const;

const STATUS_LABEL_MAP = new Map<string, string>(
  CONTACT_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const BOARD_STATUS_TO_RAW = new Map<string, string>([
  ["New Lead", "new_lead"],
  ["No Respond", "no_respond"],
  ["Booked Appointment", "booked_appointment"],
  ["Attended", "attended_visit"],
  ["No Show", "no_show"],
  ["Patient", "patient"],
  ["Trash", "trash"],
]);

export function getBroadcastSegmentFieldLabel(field: BroadcastSegmentField) {
  return (
    BROADCAST_SEGMENT_FIELD_DEFINITIONS.find((definition) => definition.field === field)
      ?.label ?? field
  );
}

export function toRawContactStatus(value?: string | null) {
  if (!value) {
    return "";
  }

  return BOARD_STATUS_TO_RAW.get(value) ?? value;
}

export function getContactStatusLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }

  return STATUS_LABEL_MAP.get(value) ?? value;
}

export function normalizeDynamicSegmentValue(value?: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : EMPTY_SEGMENT_VALUE;
}

export function getDynamicSegmentLabel(
  value: string,
  emptyLabel: string
) {
  return value === EMPTY_SEGMENT_VALUE ? emptyLabel : value;
}

export function buildBroadcastTemplateMessage(input: {
  template: string;
  contactName?: string | null;
  treatmentInterest?: string | null;
}) {
  const rendered = input.template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key) => {
      switch (key) {
        case "contact_name":
          return input.contactName?.trim() || "there";
        case "treatment_interest":
          return input.treatmentInterest?.trim() || "your treatment";
        default:
          return "";
      }
    }
  );

  return rendered.replace(/\s+/g, " ").trim();
}

export function doesRecordMatchBroadcastFilters(
  record: BroadcastFilterRecord,
  filters: BroadcastSegmentFilter[]
) {
  return filters.every((filter) => {
    if (!Array.isArray(filter.values) || filter.values.length === 0) {
      return true;
    }

    switch (filter.field) {
      case "status":
        return filter.values.includes(record.current_status ?? "");
      case "source":
        return filter.values.includes(normalizeDynamicSegmentValue(record.source));
      case "campaign_name":
        return filter.values.includes(
          normalizeDynamicSegmentValue(record.campaign_name)
        );
      case "treatment_interest":
        return filter.values.includes(
          normalizeDynamicSegmentValue(record.treatment_interest)
        );
      case "assigned_user_id":
        return filter.values.includes(
          record.assigned_user_id?.trim() || UNASSIGNED_SEGMENT_VALUE
        );
      case "bot_mode":
        return filter.values.includes(record.bot_mode ?? "");
      case "automation_enabled":
        return filter.values.includes(
          record.automation_enabled === false ? "disabled" : "enabled"
        );
      case "unread_state":
        return filter.values.includes(
          (record.unread_count ?? 0) > 0 ? "unread" : "read"
        );
      case "appointment_state":
        return filter.values.includes(
          record.appointment_date ? "has_appointment" : "no_appointment"
        );
      default:
        return true;
    }
  });
}

export function buildCampaignFieldGroups(
  groups: BroadcastSegmentFieldOptionGroup[]
) {
  const groupMap = new Map(groups.map((group) => [group.field, group]));

  return BROADCAST_SEGMENT_FIELD_DEFINITIONS.map((definition) => ({
    field: definition.field,
    label: definition.label,
    description: definition.description,
    options: groupMap.get(definition.field)?.options ?? [],
  }));
}
