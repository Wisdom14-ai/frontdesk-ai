import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    read?: boolean;
    dismissed?: boolean;
  };
  const updates: Record<string, string | null> = {};
  const nowIso = new Date().toISOString();

  if (typeof body.read === "boolean") {
    updates.read_at = body.read ? nowIso : null;
  }

  if (typeof body.dismissed === "boolean") {
    updates.dismissed_at = body.dismissed ? nowIso : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Set read or dismissed to update a notification." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("clinic_notifications")
    .update(updates)
    .eq("id", id)
    .eq("clinic_id", membership.clinic_id)
    .select(
      "id, clinic_id, severity, category, title, body, metadata, read_at, dismissed_at, created_at"
    )
    .maybeSingle();

  if (error) {
    console.warn("[clinic-notifications-api] Failed to update notification.", {
      clinicId: membership.clinic_id,
      notificationId: id,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });

    return NextResponse.json(
      { error: "Failed to update notification." },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({ notification: data });
}
