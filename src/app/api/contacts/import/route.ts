import { NextResponse } from "next/server";

import { getClinicUsageSummary } from "@/lib/server/clinic";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { normalizePhoneNumber } from "@/lib/server/whatsapp";
import type { CsvLeadInput } from "@/types";

export async function POST(req: Request) {
  const { supabase, membership } = await requireMembership();

  // 3 imports per minute per clinic
  const rl = checkRateLimit(`import:${membership.clinic_id}`, { windowMs: 60_000, max: 3 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many import requests. Please wait before importing again." },
      { status: 429 }
    );
  }

  const { leads } = (await req.json()) as { leads?: CsvLeadInput[] };

  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ error: "No leads were provided for import." }, { status: 400 });
  }

  const normalized = new Map<string, CsvLeadInput>();
  let invalid = 0;

  for (const lead of leads) {
    if (!lead.full_name?.trim() || !lead.phone_e164?.trim()) {
      invalid += 1;
      continue;
    }

    const phone = normalizePhoneNumber(lead.phone_e164);
    if (!phone || normalized.has(phone)) {
      invalid += 1;
      continue;
    }

    normalized.set(phone, {
      ...lead,
      full_name: lead.full_name.trim(),
      phone_e164: phone,
      treatment_interest: lead.treatment_interest?.trim() || undefined,
      source: lead.source?.trim() || undefined,
      campaign_name: lead.campaign_name?.trim() || undefined,
    });
  }

  const writer = createAdminClient() ?? supabase;
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
  const uniquePhones = [...normalized.keys()];

  const { data: existingContacts } = await writer
    .from("contacts")
    .select("phone_e164")
    .eq("clinic_id", membership.clinic_id)
    .in("phone_e164", uniquePhones);

  const existingPhones = new Set((existingContacts ?? []).map((contact) => contact.phone_e164 as string));

  const rows = [...normalized.values()]
    .filter((lead) => !existingPhones.has(lead.phone_e164))
    .map((lead) => ({
      clinic_id: membership.clinic_id,
      full_name: lead.full_name,
      phone_e164: lead.phone_e164,
      treatment_interest: lead.treatment_interest || null,
      source: lead.source || null,
      campaign_name: lead.campaign_name || null,
      current_status: "new_lead",
      bot_mode: "active",
      automation_enabled: true,
    }));

  const availableSlots = Math.max(0, usage.contact_limit - usage.active_contacts);
  const rowsToInsert = rows.slice(0, availableSlots);
  const blocked = Math.max(0, rows.length - rowsToInsert.length);

  if (rowsToInsert.length > 0) {
    const { error } = await writer.from("contacts").insert(rowsToInsert);
    if (error) {
      return NextResponse.json({ error: "Failed to import leads." }, { status: 500 });
    }
  }

  return NextResponse.json({
    summary: {
      imported: rowsToInsert.length,
      deduped: existingPhones.size,
      invalid,
      blocked,
    },
  });
}
