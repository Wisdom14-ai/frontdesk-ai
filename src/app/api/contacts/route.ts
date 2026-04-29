import { NextResponse } from "next/server";

import {
  CONTACT_LIST_SELECT,
  LEGACY_CONTACT_LIST_SELECT,
  isCrmSchemaMismatchError,
  mapContactRecordToLead,
} from "@/lib/crm-data";
import { getClinicUsageSummary } from "@/lib/server/clinic";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";
import { normalizePhoneNumber } from "@/lib/server/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, membership } = await requireMembership();

  let { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_LIST_SELECT)
    .eq("clinic_id", membership.clinic_id)
    .order("updated_at", { ascending: false });

  if (error && isCrmSchemaMismatchError(error)) {
    const fallback = await supabase
      .from("contacts")
      .select(LEGACY_CONTACT_LIST_SELECT)
      .eq("clinic_id", membership.clinic_id)
      .order("updated_at", { ascending: false });

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json(
      {
        error: isCrmSchemaMismatchError(error)
          ? "Apply the latest supabase-schema.sql to load the CRM data model."
          : "Failed to load leads.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    leads: (data ?? []).map((contact) =>
      mapContactRecordToLead(contact as unknown as Record<string, unknown>)
    ),
  });
}

export async function POST(req: Request) {
  const { supabase, membership } = await requireMembership();
  const body = (await req.json()) as {
    full_name?: string;
    phone_e164?: string;
    treatment_interest?: string;
    source?: string;
    campaign_name?: string;
  };

  if (!body.full_name?.trim() || !body.phone_e164?.trim()) {
    return NextResponse.json({ error: "Name and phone number are required." }, { status: 400 });
  }

  const phone = normalizePhoneNumber(body.phone_e164);
  const writer = createAdminClient() ?? supabase;

  const { data: existing } = await writer
    .from("contacts")
    .select("id")
    .eq("clinic_id", membership.clinic_id)
    .eq("phone_e164", phone)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "A lead with this phone number already exists.", existing: true }, { status: 409 });
  }

  const { data: clinic } = await writer
    .from("clinics")
    .select(
      "id, plan_type, payment_received_at, billing_cycle_anchor, created_at, contact_limit_override, monthly_message_limit_override"
    )
    .eq("id", membership.clinic_id)
    .single();

  if (!clinic) {
    return NextResponse.json({ error: "Clinic settings could not be loaded." }, { status: 500 });
  }

  const clinicRow = clinic as unknown as Record<string, unknown>;

  const usage = await getClinicUsageSummary(writer, {
    id: clinicRow.id as string,
    plan_type: ((clinicRow.plan_type as "starter" | "pro") ?? "starter"),
    payment_received_at: (clinicRow.payment_received_at as string | null) ?? null,
    billing_cycle_anchor: (clinicRow.billing_cycle_anchor as string | null) ?? null,
    created_at: (clinicRow.created_at as string | null) ?? null,
    contact_limit_override: (clinicRow.contact_limit_override as number | null) ?? null,
    monthly_message_limit_override:
      (clinicRow.monthly_message_limit_override as number | null) ?? null,
  });

  if (usage.contact_limit_reached) {
    return NextResponse.json(
      {
        error:
          "This clinic has reached its contact limit. Archive or upgrade before adding new leads.",
      },
      { status: 403 }
    );
  }

  const { data, error } = await writer
    .from("contacts")
    .insert({
      clinic_id: membership.clinic_id,
      full_name: body.full_name.trim(),
      phone_e164: phone,
      treatment_interest: body.treatment_interest?.trim() || null,
      source: body.source?.trim() || null,
      campaign_name: body.campaign_name?.trim() || null,
      current_status: "new_lead",
      bot_mode: "active",
      automation_enabled: true,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create lead." }, { status: 500 });
  }

  return NextResponse.json({ contact: data });
}
