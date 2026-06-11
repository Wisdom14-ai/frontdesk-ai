import { NextResponse } from "next/server";

import {
  CLINIC_BASE_SELECT,
  CLINIC_SELECT_WITH_KNOWLEDGE,
  getClinicUsageSummary,
  isMissingClinicKnowledgeColumnError,
  mapClinicSettings,
} from "@/lib/server/clinic";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { getSupportWhatsappNumber } from "@/lib/server/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { supabase, membership } = await requireMembership();
  const canManageWorkspace = canManageStaff(membership.role);

  let { data, error } = await supabase
    .from("clinics")
    .select(CLINIC_SELECT_WITH_KNOWLEDGE)
    .eq("id", membership.clinic_id)
    .single();

  if (error && isMissingClinicKnowledgeColumnError(error)) {
    ({ data, error } = await supabase
      .from("clinics")
      .select(CLINIC_BASE_SELECT)
      .eq("id", membership.clinic_id)
      .single());
  }

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

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "Only managers and admins can update clinic settings." },
      { status: 403 }
    );
  }

  const body = (await req.json()) as {
    name?: string;
    clinic_type?: string;
    owner_name?: string;
    owner_phone?: string;
    clinic_prompt?: string;
    clinic_knowledge?: string;
    evolution_api_url?: string;
    evolution_api_key?: string;
    evolution_instance_name?: string;
    n8n_webhook_url?: string;
  };

  const updates: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.clinic_prompt === "string") {
    updates.clinic_prompt = body.clinic_prompt.trim() || null;
  }

  if (typeof body.clinic_knowledge === "string") {
    updates.clinic_knowledge = body.clinic_knowledge.trim() || null;
  }

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body.clinic_type === "string" && body.clinic_type.trim()) {
    updates.clinic_type = body.clinic_type.trim();
  }
  if ("owner_name" in body) {
    updates.owner_name = body.owner_name?.trim() || null;
  }
  if ("owner_phone" in body) {
    updates.owner_phone = body.owner_phone?.trim() || null;
  }
  if ("evolution_api_url" in body) {
    updates.evolution_api_url = body.evolution_api_url?.trim() || null;
  }
  if ("evolution_api_key" in body) {
    updates.evolution_api_key = body.evolution_api_key?.trim() || null;
  }
  if ("evolution_instance_name" in body) {
    updates.evolution_instance_name = body.evolution_instance_name?.trim() || null;
  }
  if ("n8n_webhook_url" in body) {
    updates.n8n_webhook_url = body.n8n_webhook_url?.trim() || null;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No clinic changes were provided." },
      { status: 400 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  let { data, error } = await writer
    .from("clinics")
    .update(updates)
    .eq("id", membership.clinic_id)
    .select(CLINIC_SELECT_WITH_KNOWLEDGE)
    .single();

  if (error && isMissingClinicKnowledgeColumnError(error)) {
    // clinic_knowledge column not migrated yet — save the other fields.
    const { clinic_knowledge: omittedKnowledge, ...fallbackUpdates } = updates;
    void omittedKnowledge;
    ({ data, error } = await writer
      .from("clinics")
      .update(fallbackUpdates)
      .eq("id", membership.clinic_id)
      .select(CLINIC_BASE_SELECT)
      .single());
  }

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
