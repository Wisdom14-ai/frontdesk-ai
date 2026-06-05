import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  calculateUsagePct,
  getBillingCycleWindow,
  getPlanLimits,
  getWorkspaceAccessState,
  normalizeClinicType,
  normalizePaymentStatus,
  normalizePlanType,
  normalizeSubscriptionStatus,
  normalizeWhatsappStatus,
} from "@/lib/plans";
import type {
  ClinicSettings,
  ClinicUsageSummary,
  PaymentStatus,
  PlanType,
  SubscriptionStatus,
  WhatsappStatus,
  WorkspaceAccessState,
} from "@/types";

export const CLINIC_BASE_SELECT = [
  "id",
  "name",
  "clinic_type",
  "plan_type",
  "subscription_status",
  "payment_status",
  "payment_received_at",
  "billing_cycle_anchor",
  "whatsapp_status",
  "whatsapp_number",
  "whatsapp_qr_code",
  "whatsapp_pairing_code",
  "whatsapp_connected_at",
  "whatsapp_last_synced_at",
  "onboarding_completed_at",
  "owner_name",
  "owner_phone",
  "clinic_prompt",
  "internal_notes",
  "manual_monthly_cost_myr",
  "contact_limit_override",
  "monthly_message_limit_override",
  "evolution_api_url",
  "evolution_api_key",
  "evolution_instance_name",
  "n8n_webhook_url",
  "webhook_secret",
  "created_at",
  "updated_at",
].join(", ");

interface ClinicLimitRow {
  id: string;
  plan_type: PlanType;
  payment_received_at?: string | null;
  billing_cycle_anchor?: string | null;
  created_at?: string | null;
  contact_limit_override?: number | null;
  monthly_message_limit_override?: number | null;
}

export interface ClinicWorkspaceState {
  planType: PlanType;
  subscriptionStatus: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  whatsappStatus: WhatsappStatus;
  accessState: WorkspaceAccessState;
}

export function mapClinicWorkspaceState(clinic: Record<string, unknown>): ClinicWorkspaceState {
  const planType = normalizePlanType(clinic.plan_type);
  const subscriptionStatus = normalizeSubscriptionStatus(clinic.subscription_status);
  const paymentStatus = normalizePaymentStatus(clinic.payment_status);
  const whatsappStatus = normalizeWhatsappStatus(clinic.whatsapp_status);

  return {
    planType,
    subscriptionStatus,
    paymentStatus,
    whatsappStatus,
    accessState: getWorkspaceAccessState({
      subscriptionStatus,
      paymentStatus,
      whatsappStatus,
    }),
  };
}

export function buildOnboardingFields(input: {
  paymentStatus: PaymentStatus;
  whatsappStatus: WhatsappStatus;
  currentOnboardingCompletedAt?: string | null;
  nowIso?: string;
}) {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const shouldBeOnboarded =
    input.paymentStatus === "received" && input.whatsappStatus === "connected";

  if (shouldBeOnboarded) {
    return {
      onboarding_completed_at: input.currentOnboardingCompletedAt ?? nowIso,
    };
  }

  return {
    onboarding_completed_at: null,
  };
}

export async function getClinicUsageSummary(
  client: SupabaseClient,
  clinic: ClinicLimitRow
): Promise<ClinicUsageSummary> {
  const limits = getPlanLimits(clinic.plan_type, {
    contactLimit: clinic.contact_limit_override,
    monthlyMessageLimit: clinic.monthly_message_limit_override,
  });

  const billingCycleWindow = getBillingCycleWindow(
    clinic.billing_cycle_anchor ?? clinic.payment_received_at ?? clinic.created_at
  );

  const [{ count: activeContactCount }, { count: outboundMessageCount }] =
    await Promise.all([
      client
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinic.id)
        .neq("current_status", "trash"),
      billingCycleWindow.start && billingCycleWindow.end
        ? client
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinic.id)
            .eq("direction", "outbound")
            .gte("created_at", billingCycleWindow.start.toISOString())
            .lt("created_at", billingCycleWindow.end.toISOString())
        : client
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinic.id)
            .eq("direction", "outbound"),
    ]);

  const activeContacts = activeContactCount ?? 0;
  const monthlyOutboundMessages = outboundMessageCount ?? 0;

  return {
    active_contacts: activeContacts,
    contact_limit: limits.contactLimit,
    contact_limit_reached: activeContacts >= limits.contactLimit,
    contact_utilization_pct: calculateUsagePct(activeContacts, limits.contactLimit),
    monthly_outbound_messages: monthlyOutboundMessages,
    monthly_message_limit: limits.monthlyMessageLimit,
    monthly_message_limit_reached:
      monthlyOutboundMessages >= limits.monthlyMessageLimit,
    monthly_message_utilization_pct: calculateUsagePct(
      monthlyOutboundMessages,
      limits.monthlyMessageLimit
    ),
    billing_cycle_start: billingCycleWindow.start?.toISOString() ?? null,
    billing_cycle_end: billingCycleWindow.end?.toISOString() ?? null,
  };
}

export function mapClinicSettings(
  clinic: Record<string, unknown>,
  usage: ClinicUsageSummary,
  supportWhatsappNumber?: string | null,
  canManageWorkspace?: boolean
): ClinicSettings {
  const includeSensitiveSettings = canManageWorkspace ?? false;

  return {
    id: clinic.id as string,
    name: clinic.name as string,
    clinic_type: normalizeClinicType(clinic.clinic_type),
    plan_type: normalizePlanType(clinic.plan_type),
    subscription_status: normalizeSubscriptionStatus(clinic.subscription_status),
    payment_status: normalizePaymentStatus(clinic.payment_status),
    whatsapp_status: normalizeWhatsappStatus(clinic.whatsapp_status),
    whatsapp_number: (clinic.whatsapp_number as string | null) ?? "",
    owner_name: (clinic.owner_name as string | null) ?? null,
    owner_phone: (clinic.owner_phone as string | null) ?? null,
    clinic_prompt: includeSensitiveSettings
      ? (clinic.clinic_prompt as string | null) ?? null
      : null,
    payment_received_at: (clinic.payment_received_at as string | null) ?? null,
    billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
    whatsapp_connected_at:
      (clinic.whatsapp_connected_at as string | null) ?? null,
    onboarding_completed_at:
      (clinic.onboarding_completed_at as string | null) ?? null,
    support_whatsapp_number: supportWhatsappNumber ?? null,
    can_manage_workspace: canManageWorkspace ?? false,
    evolution_api_url: includeSensitiveSettings
      ? (clinic.evolution_api_url as string | null) ?? null
      : null,
    evolution_api_key: includeSensitiveSettings
      ? (clinic.evolution_api_key as string | null) ?? null
      : null,
    evolution_instance_name: includeSensitiveSettings
      ? (clinic.evolution_instance_name as string | null) ?? null
      : null,
    n8n_webhook_url: includeSensitiveSettings
      ? (clinic.n8n_webhook_url as string | null) ?? null
      : null,
    webhook_secret: includeSensitiveSettings
      ? (clinic.webhook_secret as string | null) ?? null
      : null,
    usage,
  };
}

export function getClinicLifecycleMessage(
  accessState: WorkspaceAccessState,
  subscriptionStatus: SubscriptionStatus
) {
  if (accessState === "awaiting_payment") {
    return {
      title: "Awaiting activation",
      description:
        "Your clinic workspace is created, but payment still needs to be marked as received before access is unlocked.",
    };
  }

  if (accessState === "connect_whatsapp") {
    return {
      title: "Connect WhatsApp to continue",
      description:
        "Your payment is active. Scan the QR code with the clinic phone to unlock the workspace.",
    };
  }

  switch (subscriptionStatus) {
    case "paused":
      return {
        title: "Workspace paused",
        description:
          "Your subscription is paused. Contact support to reactivate this clinic workspace.",
      };
    case "cancelled":
      return {
        title: "Subscription cancelled",
        description:
          "This clinic subscription has been cancelled. Contact support if you want to restore access.",
      };
    case "churned":
      return {
        title: "Workspace closed",
        description:
          "This clinic account has been marked as churned and no longer has CRM access.",
      };
    default:
      return {
        title: "Workspace ready",
        description: "This clinic can access the CRM.",
      };
  }
}
