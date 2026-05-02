import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";

function parseLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(50, Math.max(1, Math.round(parsed)));
}

export async function GET(req: Request) {
  const { supabase, membership } = await requireMembership();
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread_only") === "true";
  const limit = parseLimit(url.searchParams.get("limit"));

  let query = supabase
    .from("clinic_notifications")
    .select(
      "id, clinic_id, severity, category, title, body, metadata, read_at, dismissed_at, created_at"
    )
    .eq("clinic_id", membership.clinic_id)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("[clinic-notifications-api] Failed to load notifications.", {
      clinicId: membership.clinic_id,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });

    return NextResponse.json(
      { error: "Failed to load notifications." },
      { status: 500 }
    );
  }

  return NextResponse.json({ notifications: data ?? [] });
}
