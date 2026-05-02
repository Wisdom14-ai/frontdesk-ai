import { NextResponse } from "next/server";

import { insertAdminAuditLog } from "@/lib/server/admin-audit";
import { getClinicCapStatus } from "@/lib/server/ai-cap";
import { getAgencyAdminState } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizeCapUsd(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

export async function PATCH(
  req: Request,
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
  const body = (await req.json().catch(() => ({}))) as {
    ai_monthly_cost_cap_usd?: unknown;
  };
  const nextCapUsd = normalizeCapUsd(body.ai_monthly_cost_cap_usd);

  if (nextCapUsd === null) {
    return NextResponse.json(
      { error: "ai_monthly_cost_cap_usd must be a positive number." },
      { status: 400 }
    );
  }

  const { data: clinic, error: clinicError } = await admin
    .from("clinics")
    .select("id, ai_monthly_cost_cap_usd")
    .eq("id", clinicId)
    .maybeSingle();

  if (clinicError) {
    return NextResponse.json(
      { error: "Failed to load clinic AI cap." },
      { status: 500 }
    );
  }

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  let currentStatus;
  try {
    currentStatus = await getClinicCapStatus(clinicId);
  } catch (error) {
    console.error("[admin-ai-cap] Failed to load current cap status.", {
      clinicId,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to load current AI cap status." },
      { status: 500 }
    );
  }

  const nextPercentage =
    nextCapUsd > 0 ? (currentStatus.currentCostUsd / nextCapUsd) * 100 : 100;
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {
    ai_monthly_cost_cap_usd: nextCapUsd,
    updated_at: nowIso,
  };

  if (currentStatus.currentCostUsd < nextCapUsd) {
    updates.ai_paused_at = null;
    updates.ai_paused_reason = null;
  }

  if (nextPercentage < 80) {
    updates.ai_warning_sent_at = null;
  }

  const { error: updateError } = await admin
    .from("clinics")
    .update(updates)
    .eq("id", clinicId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update clinic AI cap." },
      { status: 500 }
    );
  }

  const { error: notificationError } = await admin
    .from("clinic_notifications")
    .insert({
      clinic_id: clinicId,
      severity: "info",
      category: "ai_cap_updated",
      title: "AI monthly cap updated",
      body: `Your clinic's monthly AI cap is now $${nextCapUsd.toFixed(2)}.`,
      metadata: {
        previous_cap_usd: clinic.ai_monthly_cost_cap_usd,
        next_cap_usd: nextCapUsd,
        current_cost_usd: currentStatus.currentCostUsd,
        updated_by_user_id: auth.user.id,
      },
    });

  if (notificationError) {
    console.warn("[admin-ai-cap] Failed to notify clinic.", {
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
      action: "ai_cap_updated",
      details: {
        previous_cap_usd: clinic.ai_monthly_cost_cap_usd,
        next_cap_usd: nextCapUsd,
        current_cost_usd: currentStatus.currentCostUsd,
        pause_cleared: currentStatus.currentCostUsd < nextCapUsd,
        updated_at: nowIso,
      },
    });
  } catch (error) {
    console.error("[admin-ai-cap] Failed to write audit log.", {
      clinicId,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "AI cap was updated, but the audit log could not be written." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    ai_monthly_cost_cap_usd: nextCapUsd,
    ai_paused_cleared: currentStatus.currentCostUsd < nextCapUsd,
  });
}
