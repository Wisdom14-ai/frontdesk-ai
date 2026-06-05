import type {
  ContactLeadMemory,
  ContactLeadMemoryKey,
  LeadNameConfidence,
  LeadQuality,
} from "@/types";

export const CONTACT_LEAD_MEMORY_KEYS = [
  "confirmed_name",
  "name_confidence",
  "preferred_language",
  "lead_intent",
  "urgency",
  "lead_summary",
  "conversation_summary",
  "lead_quality",
  "lead_quality_reason",
  "last_outcome",
  "next_action",
  "follow_up_angle",
  "objections",
] as const satisfies ContactLeadMemoryKey[];

export const LEAD_QUALITY_VALUES = [
  "unknown",
  "cold",
  "warm",
  "hot",
] as const satisfies LeadQuality[];

export const LEAD_NAME_CONFIDENCE_VALUES = [
  "unknown",
  "low",
  "medium",
  "high",
] as const satisfies LeadNameConfidence[];

export const EMPTY_CONTACT_LEAD_MEMORY: ContactLeadMemory = {
  confirmed_name: "",
  name_confidence: "unknown",
  preferred_language: "",
  lead_intent: "",
  urgency: "",
  lead_summary: "",
  conversation_summary: "",
  lead_quality: "unknown",
  lead_quality_reason: "",
  last_outcome: "",
  next_action: "",
  follow_up_angle: "",
  objections: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeLeadQuality(value: unknown): LeadQuality {
  if (
    typeof value === "string" &&
    (LEAD_QUALITY_VALUES as readonly string[]).includes(value)
  ) {
    return value as LeadQuality;
  }

  return "unknown";
}

export function normalizeLeadNameConfidence(
  value: unknown
): LeadNameConfidence {
  if (
    typeof value === "string" &&
    (LEAD_NAME_CONFIDENCE_VALUES as readonly string[]).includes(value)
  ) {
    return value as LeadNameConfidence;
  }

  return "unknown";
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeContactLeadMemory(value: unknown): ContactLeadMemory {
  if (!isRecord(value)) {
    return { ...EMPTY_CONTACT_LEAD_MEMORY };
  }

  return {
    confirmed_name: normalizeOptionalString(value.confirmed_name),
    name_confidence: normalizeLeadNameConfidence(value.name_confidence),
    preferred_language: normalizeOptionalString(value.preferred_language),
    lead_intent: normalizeOptionalString(value.lead_intent),
    urgency: normalizeOptionalString(value.urgency),
    lead_summary: normalizeOptionalString(value.lead_summary),
    conversation_summary: normalizeOptionalString(value.conversation_summary),
    lead_quality: normalizeLeadQuality(value.lead_quality),
    lead_quality_reason: normalizeOptionalString(value.lead_quality_reason),
    last_outcome: normalizeOptionalString(value.last_outcome),
    next_action: normalizeOptionalString(value.next_action),
    follow_up_angle: normalizeOptionalString(value.follow_up_angle),
    objections: normalizeOptionalString(value.objections),
  };
}

export function normalizeContactLeadMemoryOverride(
  value: unknown
): Partial<ContactLeadMemory> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Partial<ContactLeadMemory> = {};

  for (const key of CONTACT_LEAD_MEMORY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }

    if (key === "lead_quality") {
      normalized.lead_quality = normalizeLeadQuality(value.lead_quality);
      continue;
    }

    if (key === "name_confidence") {
      normalized.name_confidence = normalizeLeadNameConfidence(
        value.name_confidence
      );
      continue;
    }

    const nextValue = normalizeOptionalString(value[key]);
    (normalized as Record<
      string,
      string | LeadQuality | LeadNameConfidence
    >)[key] = nextValue;
  }

  return normalized;
}

export function mergeContactLeadMemory(
  autoMemory: unknown,
  overrideMemory: unknown
): ContactLeadMemory {
  const normalizedAuto = normalizeContactLeadMemory(autoMemory);
  const normalizedOverride = normalizeContactLeadMemoryOverride(overrideMemory);

  return {
    ...normalizedAuto,
    ...normalizedOverride,
  };
}

export function clearContactLeadMemoryOverride(
  overrideMemory: unknown,
  keys: ContactLeadMemoryKey[]
) {
  const normalizedOverride = normalizeContactLeadMemoryOverride(overrideMemory);

  for (const key of keys) {
    delete normalizedOverride[key];
  }

  return normalizedOverride;
}

export function getLeadMemoryPreview(memory: ContactLeadMemory) {
  return (
    memory.lead_summary ||
    memory.conversation_summary ||
    memory.next_action ||
    ""
  );
}

export function hasLeadMemoryOverride(
  overrideMemory: Partial<ContactLeadMemory> | undefined,
  key: ContactLeadMemoryKey
) {
  return Boolean(
    overrideMemory &&
      Object.prototype.hasOwnProperty.call(overrideMemory, key)
  );
}
