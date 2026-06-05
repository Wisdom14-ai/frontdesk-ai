export type ContactNameReviewStatus = "trusted" | "missing" | "untrusted";

const GENERIC_CONTACT_NAME_KEYS = new Set([
  "beltharintelligence",
  "business",
  "businessaccount",
  "clinic",
  "contact",
  "customer",
  "lead",
  "me",
  "mybusiness",
  "null",
  "patient",
  "prospect",
  "undefined",
  "unknown",
  "unknownlead",
  "user",
  "whatsapp",
]);

function normalizePhoneNumber(input: string) {
  let digitsOnly = input.replace(/\D/g, "");
  if (!digitsOnly) {
    return "";
  }

  if (digitsOnly.startsWith("00")) {
    digitsOnly = digitsOnly.slice(2);
  }

  if (digitsOnly.startsWith("60")) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.startsWith("0")) {
    return `+60${digitsOnly.slice(1)}`;
  }

  return `+${digitsOnly}`;
}

function normalizeIdentity(value?: string | null) {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function isPhoneLikeName(input: { name: string; phone?: string | null }) {
  const nameDigits = input.name.replace(/\D/g, "");
  const phoneDigits = input.phone?.replace(/\D/g, "") ?? "";

  if (phoneDigits && nameDigits === phoneDigits) {
    return true;
  }

  const normalizedPhone = normalizePhoneNumber(input.phone ?? "");
  if (normalizedPhone && normalizePhoneNumber(input.name) === normalizedPhone) {
    return true;
  }

  return nameDigits.length >= 5 && !/\p{L}/u.test(input.name);
}

export function getContactNameReview(input: {
  fullName?: string | null;
  phone?: string | null;
}) {
  const name = input.fullName?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";

  if (!name) {
    return {
      status: "missing" as const,
      label: "Review name",
      reason: "Contact has no prospect name yet.",
    };
  }

  if (isPhoneLikeName({ name, phone: input.phone })) {
    return {
      status: "missing" as const,
      label: "Review name",
      reason: "Current name is only the phone number.",
    };
  }

  const nameKey = normalizeIdentity(name);
  if (nameKey && GENERIC_CONTACT_NAME_KEYS.has(nameKey)) {
    return {
      status: "untrusted" as const,
      label: "Review name",
      reason: "Current name looks like a placeholder or sender name.",
    };
  }

  if (/@s\.whatsapp\.net|@c\.us|@g\.us/i.test(name)) {
    return {
      status: "untrusted" as const,
      label: "Review name",
      reason: "Current name looks like a WhatsApp technical identifier.",
    };
  }

  return {
    status: "trusted" as const,
    label: "Name ok",
    reason: "Name looks usable for personalization.",
  };
}
