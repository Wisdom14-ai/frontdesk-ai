import { NextResponse } from "next/server";

import { insertAdminAuditLog } from "@/lib/server/admin-audit";
import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for super admin actions." },
      { status: 503 }
    );
  }

  const { clinicId } = await context.params;
  const nowIso = new Date().toISOString();
  const { data: clinic, error: updateError } = await admin
    .from("clinics")
    .update({
      ai_paused_at: null,
      ai_paused_reason: null,
      ai_warning_sent_at: null,
      updated_at: nowIso,
    })
    .eq("id", clinicId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to reset clinic AI cap state." },
      { status: 500 }
    );
  }

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  const { error: notificationError } = await admin
    .from("clinic_notifications")
    .insert({
      clinic_id: clinicId,
      severity: "info",
      category: "ai_cap_reset",
      title: "AI pause reset",
      body: "An agency admin reset your clinic's AI pause state.",
      metadata: {
        reset_by_user_id: auth.user.id,
      },
    });

  if (notificationError) {
    console.warn("[admin-ai-cap-reset] Failed to notify clinic.", {
      clinicId,
      message: notificationError.message,
      details: notificationError.details,
      hint: notificationError.hint,
      code: notificationError.code,
    });
  }

  try {
    await insertAdminAuditLog(admin, {
      clinicId,
      userId: auth.user.id,
      action: "ai_cap_force_reset",
      details: {
        reset_at: nowIso,
      },
    });
  } catch (error) {
    console.error("[admin-ai-cap-reset] Failed to write audit log.", {
      clinicId,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "AI cap was reset, but the audit log could not be written." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
