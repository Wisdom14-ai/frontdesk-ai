import { NextResponse } from "next/server";

import { CLINIC_BASE_SELECT, getClinicUsageSummary, mapClinicSettings } from "@/lib/server/clinic";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { getSupportWhatsappNumber } from "@/lib/server/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { supabase, membership } = await requireMembership();
  const canManageWorkspace = canManageStaff(membership.role);

  const { data, error } = await supabase
    .from("clinics")
    .select(CLINIC_BASE_SELECT)
    .eq("id", membership.clinic_id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to load clinic settings." },
      { status: 500 }
    );
  }

  const clinic = data as unknown as Record<string, unknown>;

  const usage = await getClinicUsageSummary(supabase, {
    id: clinic.id as string,
    plan_type: (clinic.plan_type as "starter" | "pro") ?? "starter",
    payment_received_at: (clinic.payment_received_at as string | null) ?? null,
    billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
    created_at: (clinic.created_at as string | null) ?? null,
    contact_limit_override: (clinic.contact_limit_override as number | null) ?? null,
    monthly_message_limit_override:
      (clinic.monthly_message_limit_override as number | null) ?? null,
  });

  return NextResponse.json({
    clinic: mapClinicSettings(
      clinic,
      usage,
      getSupportWhatsappNumber(),
      canManageWorkspace
    ),
  });
}

export async function PATCH(req: Request) {
  const { supabase, membership } = await requireMembership();
  const body = (await req.json()) as {
    name?: string;
    owner_name?: string;
    owner_phone?: string;
    clinic_prompt?: string;
  };

  const updates: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.clinic_prompt === "string") {
    updates.clinic_prompt = body.clinic_prompt.trim() || null;
  }

  if (canManageStaff(membership.role)) {
    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if ("owner_name" in body) {
      updates.owner_name = body.owner_name?.trim() || null;
    }
    if ("owner_phone" in body) {
      updates.owner_phone = body.owner_phone?.trim() || null;
    }
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No clinic changes were provided." },
      { status: 400 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  const { data, error } = await writer
    .from("clinics")
    .update(updates)
    .eq("id", membership.clinic_id)
    .select(CLINIC_BASE_SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update clinic details." },
      { status: 500 }
    );
  }

  const clinic = data as unknown as Record<string, unknown>;

  const usage = await getClinicUsageSummary(writer, {
    id: clinic.id as string,
    plan_type: (clinic.plan_type as "starter" | "pro") ?? "starter",
    payment_received_at: (clinic.payment_received_at as string | null) ?? null,
    billing_cycle_anchor: (clinic.billing_cycle_anchor as string | null) ?? null,
    created_at: (clinic.created_at as string | null) ?? null,
    contact_limit_override: (clinic.contact_limit_override as number | null) ?? null,
    monthly_message_limit_override:
      (clinic.monthly_message_limit_override as number | null) ?? null,
  });

  return NextResponse.json({
    clinic: mapClinicSettings(
      clinic,
      usage,
      getSupportWhatsappNumber(),
      canManageStaff(membership.role)
    ),
  });
}
