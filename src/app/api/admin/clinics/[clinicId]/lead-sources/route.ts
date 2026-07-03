import { NextResponse } from "next/server";

import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { clinicId } = await context.params;

  const { data, error } = await admin
    .from("lead_sources")
    .select("id, clinic_id, label, match_phrase, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load lead sources." }, { status: 500 });
  }

  return NextResponse.json({ sources: data ?? [] });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { clinicId } = await context.params;
  const { label, match_phrase } = (await req.json()) as {
    label?: string;
    match_phrase?: string;
  };

  if (!label?.trim() || !match_phrase?.trim()) {
    return NextResponse.json(
      { error: "A label and match phrase are both required." },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("lead_sources")
    .insert({
      clinic_id: clinicId,
      label: label.trim(),
      match_phrase: match_phrase.trim(),
    })
    .select("id, clinic_id, label, match_phrase, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to save the lead source." }, { status: 500 });
  }

  return NextResponse.json({ source: data });
}
