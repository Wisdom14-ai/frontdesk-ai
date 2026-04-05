import type {
  ClinicType,
  PaymentStatus,
  PlanType,
  SubscriptionStatus,
  WhatsappStatus,
  WorkspaceAccessState,
} from "@/types";

export const CLINIC_TYPE_LABELS: Record<ClinicType, string> = {
  dental: "Dental",
  aesthetic: "Aesthetic",
  gp: "GP",
  functional_medicine: "Functional Medicine",
  physio: "Physio",
};

export const PLAN_DEFINITIONS: Record<
  PlanType,
  {
    label: string;
    priceMyr: number;
    contactLimit: number;
    monthlyMessageLimit: number;
  }
> = {
  starter: {
    label: "Starter",
    priceMyr: 89,
    contactLimit: 700,
    monthlyMessageLimit: 2000,
  },
  pro: {
    label: "Pro",
    priceMyr: 150,
    contactLimit: 3000,
    monthlyMessageLimit: 10000,
  },
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  churned: "Churned",
};

export const WHATSAPP_STATUS_LABELS: Record<WhatsappStatus, string> = {
  not_connected: "Not Connected",
  pending_qr: "Awaiting QR Scan",
  connected: "Connected",
  disconnected: "Disconnected",
};

export function normalizeClinicType(value: unknown): ClinicType {
  switch (value) {
    case "aesthetic":
    case "gp":
    case "functional_medicine":
    case "physio":
    case "dental":
      return value;
    default:
      return "dental";
  }
}

export function normalizePlanType(value: unknown): PlanType {
  return value === "pro" ? "pro" : "starter";
}

export function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  switch (value) {
    case "paused":
    case "cancelled":
    case "churned":
    case "active":
      return value;
    default:
      return "active";
  }
}

export function normalizePaymentStatus(value: unknown): PaymentStatus {
  return value === "received" ? "received" : "pending";
}

export function normalizeWhatsappStatus(value: unknown): WhatsappStatus {
  switch (value) {
    case "pending_qr":
    case "connected":
    case "disconnected":
    case "not_connected":
      return value;
    default:
      return "not_connected";
  }
}

export function getPlanDefinition(planType: PlanType) {
  return PLAN_DEFINITIONS[planType];
}

export function getPlanLimits(
  planType: PlanType,
  overrides?: {
    contactLimit?: number | null;
    monthlyMessageLimit?: number | null;
  }
) {
  const plan = getPlanDefinition(planType);
  return {
    contactLimit: overrides?.contactLimit ?? plan.contactLimit,
    monthlyMessageLimit:
      overrides?.monthlyMessageLimit ?? plan.monthlyMessageLimit,
  };
}

export function getWorkspaceAccessState(input: {
  subscriptionStatus: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  whatsappStatus: WhatsappStatus;
}): WorkspaceAccessState {
  if (input.subscriptionStatus !== "active") {
    return "subscription_locked";
  }

  if (input.paymentStatus !== "received") {
    return "awaiting_payment";
  }

  if (input.whatsappStatus !== "connected") {
    return "connect_whatsapp";
  }

  return "ready";
}

export function isContactCountedTowardsLimit(status?: string | null) {
  return status !== "trash";
}

function getCycleAnchorDay(date: Date) {
  return date.getUTCDate();
}

function getCycleBoundary(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 0, 0, 0, 0));
}

export function getBillingCycleWindow(
  anchorDate: string | null | undefined,
  now = new Date()
) {
  if (!anchorDate) {
    return {
      start: null,
      end: null,
    };
  }

  const anchor = new Date(anchorDate);
  if (Number.isNaN(anchor.getTime())) {
    return {
      start: null,
      end: null,
    };
  }

  const anchorDay = getCycleAnchorDay(anchor);
  let start = getCycleBoundary(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    anchorDay
  );

  if (now.getTime() < start.getTime()) {
    start = getCycleBoundary(
      now.getUTCFullYear(),
      now.getUTCMonth() - 1,
      anchorDay
    );
  }

  const end = getCycleBoundary(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    anchorDay
  );

  return { start, end };
}

export function calculateUsagePct(used: number, limit: number) {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(100, (used / limit) * 100);
}

