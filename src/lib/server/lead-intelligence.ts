import "server-only";

export const CONTACT_PIPELINE_STATUSES = [
  "new_lead",
  "no_respond",
  "booked_appointment",
  "attended_visit",
  "no_show",
  "patient",
  "trash",
] as const;

export type ContactPipelineStatus = (typeof CONTACT_PIPELINE_STATUSES)[number];

export type LeadIntent =
  | "handoff_requested"
  | "booking_confirmed"
  | "booking_intent"
  | "price_inquiry"
  | "negative_reply"
  | "treatment_inquiry"
  | "general_inquiry";

const PIPELINE_STATUS_SET = new Set<string>(CONTACT_PIPELINE_STATUSES);
const CLOSING_PIPELINE_STATUS_SET = new Set<string>([
  "booked_appointment",
  "attended_visit",
  "no_show",
  "patient",
  "trash",
]);

const VALID_AUTO_TRANSITIONS: Record<ContactPipelineStatus, ContactPipelineStatus[]> = {
  new_lead: ["no_respond", "booked_appointment", "trash"],
  no_respond: ["new_lead", "booked_appointment", "trash"],
  booked_appointment: ["attended_visit", "no_show"],
  attended_visit: ["patient"],
  no_show: ["booked_appointment", "no_respond"],
  patient: ["booked_appointment"],
  trash: ["new_lead"],
};

const TREATMENT_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
  {
    label: "Teeth Whitening",
    patterns: [
      /\b(whiten|whitening|bleach|stain|yellow teeth|kuning|putih(?:kan)?|cerah(?:kan)?|gelap)\b/i,
    ],
  },
  {
    label: "Braces / Aligners",
    patterns: [
      /\b(braces?|bracket|wire|aligners?|invisalign|retainer|bengkok|senget|jarang|straighten)\b/i,
    ],
  },
  {
    label: "Dental Implant",
    patterns: [
      /\b(implant|missing tooth|hilang gigi|gigi hilang|tanam gigi)\b/i,
    ],
  },
  {
    label: "Denture",
    patterns: [
      /\b(dentures?|gigi palsu|partial denture|full denture|removable)\b/i,
    ],
  },
  {
    label: "Root Canal",
    patterns: [
      /\b(root canal|rawatan saraf|saraf gigi|nerve treatment|pulp)\b/i,
    ],
  },
  {
    label: "Extraction",
    patterns: [
      /\b(extract(?:ion)?|cabut|buang gigi|wisdom tooth|gigi bongsu)\b/i,
    ],
  },
  {
    label: "Crown / Veneer",
    patterns: [
      /\b(crowns?|veneers?|mahkota|porcelain|ceramic|patah|retak|chip(?:ped)?)\b/i,
    ],
  },
  {
    label: "Scaling",
    patterns: [
      /\b(scaling|cuci gigi|clean(?:ing)?|karang gigi|tartar|calculus|plaque|plak)\b/i,
    ],
  },
  {
    label: "Kids Dentistry",
    patterns: [
      /\b(kids?|children|child|kanak|anak|baby|pediatric|paeds?)\b/i,
    ],
  },
  {
    label: "Dental Checkup",
    patterns: [
      /\b(check(?:up)?|consult(?:ation)?|jumpa doktor|appointment|temujanji|janji temu|sakit gigi|toothache|gusi|gum)\b/i,
    ],
  },
];

const HANDOFF_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "urgent_or_emergency",
    pattern:
      /\b(emergency|urgent|bleeding|berdarah|accident|trauma|bengkak teruk|severe|teruk|serius|tak tahan sakit)\b/i,
  },
  {
    reason: "complaint_or_refund",
    pattern:
      /\b(marah|angry|complain(?:t)?|aduan|tak puas|tidak puas|unhappy|upset|refund|balik duit)\b/i,
  },
  {
    reason: "human_requested",
    pattern:
      /\b(human|real person|staff|manager|call me|telefon saya)\b|\b(speak|talk|chat|connect)\b.{0,30}\b(human|real person|staff|team|manager|doctor|doktor|someone)\b/i,
  },
  {
    reason: "insurance_or_panel",
    pattern:
      /\b(insurance|claim|panel|medicard|medical card|etiqa|aia|great eastern|prudential)\b/i,
  },
];

const BOOKING_CONFIRMED_PATTERNS = [
  /\b(confirm|confirmed|set|book(?:ed)?|booking|tempah|jadikan|proceed|on|jadi)\b.{0,50}\b(appointment|slot|temujanji|janji temu|date|tarikh|time|masa|pukul|datang|jumpa)\b/i,
  /\b(nak|mahu|want|boleh|can|please|pls)\b.{0,50}\b(book|booking|appointment|temujanji|janji temu|slot|datang|jumpa)\b/i,
  /\b(saya|i)\b.{0,30}\b(datang|come|hadir)\b.{0,50}\b(today|tomorrow|esok|isnin|selasa|rabu|khamis|jumaat|sabtu|ahad|\d{1,2}[\/.-]\d{1,2})\b/i,
];

const BOOKING_INTENT_PATTERNS = [
  /\b(available|free slot|slot kosong|slot available|bila boleh|when can|appointment|temujanji|janji temu)\b/i,
  /\b(date|tarikh|time|masa|pukul)\b.{0,30}\b(available|kosong|boleh|book|appointment)\b/i,
];

const PRICE_PATTERNS = [
  /\b(price|harga|berapa|cost|kos|fee|payment|bayar|installment|ansuran)\b/i,
];

const NEGATIVE_REPLY_PATTERNS = [
  /\b(stop|unsubscribe|wrong number|salah nombor|tak berminat|tidak berminat|not interested|jangan contact)\b/i,
];

function hasMeaningfulValue(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return Boolean(
    normalized &&
      normalized !== "unknown" &&
      normalized !== "no treatment set" &&
      normalized !== "n/a" &&
      normalized !== "-"
  );
}

export function isContactPipelineStatus(
  status?: string | null
): status is ContactPipelineStatus {
  return Boolean(status && PIPELINE_STATUS_SET.has(status));
}

export function isClosingPipelineStatus(status?: string | null) {
  return Boolean(status && CLOSING_PIPELINE_STATUS_SET.has(status));
}

// The CRM board and inbox panel speak a "display" vocabulary (appointment_set,
// attended, converted, ...) while the database, the bot, the automation engine,
// and the stats RPCs all store the canonical CONTACT_PIPELINE_STATUSES values.
// Persisting a display value (e.g. "converted") writes a status nothing else
// understands — and is rejected outright where the column is constrained, which
// makes a CRM drag silently revert. Normalize on write so the stored value is
// always canonical. Unknown/already-canonical values pass through untouched.
const DISPLAY_TO_CANONICAL_STATUS: Record<string, ContactPipelineStatus> = {
  contacted: "no_respond",
  appointment_set: "booked_appointment",
  attended: "attended_visit",
  converted: "patient",
};

export function toCanonicalContactStatus(status: string): string {
  if (PIPELINE_STATUS_SET.has(status)) return status;
  return DISPLAY_TO_CANONICAL_STATUS[status] ?? status;
}

export function shouldUpdateTreatmentInterest(
  currentTreatment?: string | null,
  detectedTreatment?: string | null
) {
  return Boolean(detectedTreatment && !hasMeaningfulValue(currentTreatment));
}

export function detectTreatmentInterest(message: string) {
  for (const treatment of TREATMENT_PATTERNS) {
    if (treatment.patterns.some((pattern) => pattern.test(message))) {
      return treatment.label;
    }
  }

  return null;
}

export function detectHandoffTrigger(message: string) {
  const trigger = HANDOFF_PATTERNS.find(({ pattern }) => pattern.test(message));
  return trigger?.reason ?? null;
}

export function inferLeadIntent(
  message: string,
  detectedTreatment?: string | null
): LeadIntent {
  if (detectHandoffTrigger(message)) {
    return "handoff_requested";
  }

  if (NEGATIVE_REPLY_PATTERNS.some((pattern) => pattern.test(message))) {
    return "negative_reply";
  }

  if (BOOKING_CONFIRMED_PATTERNS.some((pattern) => pattern.test(message))) {
    return "booking_confirmed";
  }

  if (BOOKING_INTENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "booking_intent";
  }

  if (PRICE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "price_inquiry";
  }

  if (detectedTreatment) {
    return "treatment_inquiry";
  }

  return "general_inquiry";
}

function canAutoTransition(
  currentStatus: string | null | undefined,
  targetStatus: ContactPipelineStatus
) {
  if (!isContactPipelineStatus(currentStatus)) {
    return targetStatus === "booked_appointment" || targetStatus === "trash";
  }

  return VALID_AUTO_TRANSITIONS[currentStatus]?.includes(targetStatus) ?? false;
}

export function inferNextPipelineStatus(input: {
  currentStatus?: string | null;
  inboundMessage: string;
  aiIntent?: string | null;
  aiPipelineStatus?: string | null;
}) {
  const currentStatus = input.currentStatus ?? "new_lead";

  if (input.aiPipelineStatus && isContactPipelineStatus(input.aiPipelineStatus)) {
    if (
      input.aiPipelineStatus !== currentStatus &&
      canAutoTransition(currentStatus, input.aiPipelineStatus)
    ) {
      return input.aiPipelineStatus;
    }

    return null;
  }

  if (isClosingPipelineStatus(currentStatus)) {
    return null;
  }

  const detectedTreatment = detectTreatmentInterest(input.inboundMessage);
  const inferredIntent =
    (input.aiIntent as LeadIntent | null) ??
    inferLeadIntent(input.inboundMessage, detectedTreatment);

  if (
    inferredIntent === "booking_confirmed" &&
    canAutoTransition(currentStatus, "booked_appointment")
  ) {
    return "booked_appointment" satisfies ContactPipelineStatus;
  }

  return null;
}
