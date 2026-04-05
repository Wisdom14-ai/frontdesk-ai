import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import {
  normalizeClinicType,
  normalizePaymentStatus,
  normalizePlanType,
  normalizeSubscriptionStatus,
  normalizeWhatsappStatus,
} from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import type {
  ClinicType,
  PaymentStatus,
  PlanType,
  StaffRole,
  StaffStatus,
  SubscriptionStatus,
  WhatsappStatus,
} from "@/types";

export interface MembershipContext {
  id: string;
  clinic_id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  clinic_name?: string | null;
  clinic_type?: ClinicType | null;
  plan_type?: PlanType | null;
  subscription_status?: SubscriptionStatus | null;
  payment_status?: PaymentStatus | null;
  whatsapp_status?: WhatsappStatus | null;
}

export interface MembershipBootstrapProfile {
  full_name: string;
  clinic_name: string;
  clinic_type: ClinicType;
  plan_type: PlanType;
}

export function normalizeStaffRole(value: unknown): StaffRole {
  if (value === "owner") {
    return "admin";
  }

  if (value === "admin" || value === "manager" || value === "receptionist") {
    return value;
  }

  return "receptionist";
}

export function normalizeStaffStatus(data: Record<string, unknown>): StaffStatus {
  if (typeof data.status === "string") {
    if (
      data.status === "active" ||
      data.status === "invited" ||
      data.status === "disabled"
    ) {
      return data.status;
    }
  }

  if (typeof data.is_active === "boolean") {
    return data.is_active ? "active" : "disabled";
  }

  return "active";
}

function normalizeMetadataValue(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function buildBootstrapProfile(user: User): MembershipBootstrapProfile {
  const metadata = user.user_metadata ?? {};
  const emailFallback = normalizeMetadataValue(user.email?.split("@")[0] ?? "");

  return {
    full_name:
      normalizeMetadataValue(metadata.full_name) ||
      normalizeMetadataValue(metadata.name) ||
      emailFallback,
    clinic_name: normalizeMetadataValue(metadata.clinic_name),
    clinic_type: normalizeClinicType(metadata.clinic_type),
    plan_type: normalizePlanType(metadata.plan_type),
  };
}

function mapMembership(data: Record<string, unknown>): MembershipContext {
  const clinicRow = data.clinics as
    | {
        name?: string | null;
        clinic_type?: ClinicType | null;
        plan_type?: PlanType | null;
        subscription_status?: SubscriptionStatus | null;
        payment_status?: PaymentStatus | null;
        whatsapp_status?: WhatsappStatus | null;
      }
    | null;

  return {
    id: data.id as string,
    clinic_id: data.clinic_id as string,
    full_name: data.full_name as string,
    email: data.email as string,
    role: normalizeStaffRole(data.role),
    status: normalizeStaffStatus(data),
    clinic_name: clinicRow?.name ?? null,
    clinic_type: clinicRow?.clinic_type
      ? normalizeClinicType(clinicRow.clinic_type)
      : null,
    plan_type: clinicRow?.plan_type
      ? normalizePlanType(clinicRow.plan_type)
      : null,
    subscription_status: clinicRow?.subscription_status
      ? normalizeSubscriptionStatus(clinicRow.subscription_status)
      : null,
    payment_status: clinicRow?.payment_status
      ? normalizePaymentStatus(clinicRow.payment_status)
      : null,
    whatsapp_status: clinicRow?.whatsapp_status
      ? normalizeWhatsappStatus(clinicRow.whatsapp_status)
      : null,
  };
}

async function fetchMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[auth] Failed to fetch membership row from users", {
      userId,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return null;
  }

  if (!data) {
    return null;
  }

  let clinicData: Record<string, unknown> | null = null;

  if (data.clinic_id) {
    const { data: clinicRow, error: clinicError } = await supabase
      .from("clinics")
      .select("name, clinic_type, plan_type, subscription_status, payment_status, whatsapp_status")
      .eq("id", data.clinic_id)
      .maybeSingle();

    if (clinicError) {
      console.warn("[auth] Failed to fetch clinic row for membership", {
        userId,
        clinicId: data.clinic_id,
        message: clinicError.message,
        details: clinicError.details,
        hint: clinicError.hint,
        code: clinicError.code,
      });
    }

    if (clinicRow) {
      clinicData = clinicRow as Record<string, unknown>;
    }
  }

  return mapMembership({
    ...(data as Record<string, unknown>),
    clinics: clinicData,
  });
}

async function activateMembership(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { error } = await supabase.rpc("activate_current_membership");
  return !error;
}

export async function bootstrapMembershipForCurrentUser(
  input: MembershipBootstrapProfile
) {
  const supabase = await createClient();
  const fullName = input.full_name.trim();
  const clinicName = input.clinic_name.trim();

  if (!fullName || !clinicName || !input.clinic_type || !input.plan_type) {
    return {
      success: false,
      error: "Full name, clinic name, clinic type, and plan are required.",
    };
  }

  const { error } = await supabase.rpc("bootstrap_current_user_membership", {
    p_full_name: fullName,
    p_clinic_name: clinicName,
    p_clinic_type: input.clinic_type,
    p_plan_type: input.plan_type,
  });

  if (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  return { success: true };
}

async function autoBootstrapMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: MembershipBootstrapProfile
) {
  if (!profile.clinic_name) {
    return false;
  }

  const { error } = await supabase.rpc("bootstrap_current_user_membership", {
    p_full_name: profile.full_name || null,
    p_clinic_name: profile.clinic_name,
    p_clinic_type: profile.clinic_type,
    p_plan_type: profile.plan_type,
  });

  if (error) {
    console.warn("[auth] Auto-bootstrap failed", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
  }

  return !error;
}

export async function getCurrentMembership(options?: { attemptBootstrap?: boolean }) {
  const attemptBootstrap = options?.attemptBootstrap ?? true;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      membership: null,
      bootstrapProfile: null,
      needsSetup: false,
    };
  }

  const bootstrapProfile = buildBootstrapProfile(user);
  let membership = await fetchMembership(supabase, user.id);

  if (membership?.status === "invited") {
    const activated = await activateMembership(supabase);
    if (activated) {
      membership = await fetchMembership(supabase, user.id);
    }
  }

  if (!membership && attemptBootstrap) {
    const bootstrapped = await autoBootstrapMembership(supabase, bootstrapProfile);
    if (bootstrapped) {
      membership = await fetchMembership(supabase, user.id);
    }
  }

  if (membership?.status === "invited") {
    const activated = await activateMembership(supabase);
    if (activated) {
      membership = await fetchMembership(supabase, user.id);
    }
  }

  return {
    supabase,
    user,
    membership,
    bootstrapProfile,
    needsSetup: !membership,
  };
}

export async function requireMembership() {
  const context = await getCurrentMembership();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.membership) {
    redirect("/setup");
  }

  return context as {
    supabase: Awaited<ReturnType<typeof createClient>>;
    user: NonNullable<typeof context.user>;
    membership: MembershipContext;
    bootstrapProfile: MembershipBootstrapProfile;
    needsSetup: false;
  };
}

export function canManageStaff(role: StaffRole) {
  return role === "admin" || role === "manager";
}

export async function getAgencyAdminState() {
  const context = await getCurrentMembership();

  if (!context.user) {
    return { ...context, isAgencyAdmin: false };
  }

  const { data, error } = await context.supabase
    .from("agency_admins")
    .select("id")
    .eq("id", context.user.id)
    .maybeSingle();

  return {
    ...context,
    isAgencyAdmin: !error && Boolean(data),
  };
}

export async function requireAgencyAdmin() {
  const context = await getAgencyAdminState();

  if (!context.user) {
    redirect("/login");
  }

  return context;
}
