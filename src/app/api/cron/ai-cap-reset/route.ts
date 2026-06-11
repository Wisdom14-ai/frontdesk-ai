import { NextResponse } from "next/server";

import {
  authorizeRunnerRequest,
  getAutomationRunnerSecrets,
} from "@/lib/server/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

function getCurrentMonthStartUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function handleAiCapReset(req: Request) {
  const authorization = authorizeRunnerRequest(req, {
    allowedSecrets: getAutomationRunnerSecrets(),
    missingSecretMessage: "Configure CRON_SECRET before running AI cap reset.",
    unauthorizedMessage: "Unauthorized AI cap reset request.",
  });

  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase service role is not configured." },
      { status: 503 }
    );
  }

  const currentMonthStart = getCurrentMonthStartUtc();
  const currentMonthStartIso = currentMonthStart.toISOString();

  const { data: pausedClinics, error: selectError } = await admin
    .from("clinics")
    .select("id")
    .not("ai_paused_at", "is", null)
    .eq("ai_paused_reason", "cap_exceeded")
    .lt("billing_cycle_start_at", currentMonthStartIso);

  if (selectError) {
    console.error("[ai-cap-reset] Failed to load paused clinics.", {
      message: selectError.message,
      details: selectError.details,
      hint: selectError.hint,
      code: selectError.code,
    });

    return NextResponse.json(
      { error: "Failed to load paused clinics." },
      { status: 500 }
    );
  }

  const clinicIds = (pausedClinics ?? [])
    .map((clinic) => clinic.id as string | null)
    .filter((clinicId): clinicId is string => Boolean(clinicId));

  if (clinicIds.length === 0) {
    return NextResponse.json({ reset_count: 0, clinic_ids: [] });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("clinics")
    .update({
      ai_paused_at: null,
      ai_paused_reason: null,
      ai_warning_sent_at: null,
      billing_cycle_start_at: currentMonthStartIso,
      updated_at: nowIso,
    })
    .in("id", clinicIds);

  if (updateError) {
    console.error("[ai-cap-reset] Failed to reset paused clinics.", {
      clinicIds,
      message: updateError.message,
      details: updateError.details,
      hint: updateError.hint,
      code: updateError.code,
    });

    return NextResponse.json(
      { error: "Failed to reset AI cap pause state." },
      { status: 500 }
    );
  }

  const { error: notificationError } = await admin
    .from("clinic_notifications")
    .insert(
      clinicIds.map((clinicId) => ({
        clinic_id: clinicId,
        severity: "info",
        category: "ai_cap_reset",
        title: "AI usage cycle reset",
        body: "Your monthly AI usage cap has reset for the new billing cycle.",
        metadata: {
          cycle_start: currentMonthStartIso,
        },
      }))
    );

  if (notificationError) {
    console.warn("[ai-cap-reset] Failed to create reset notifications.", {
      clinicIds,
      message: notificationError.message,
      details: notificationError.details,
      hint: notificationError.hint,
      code: notificationError.code,
    });
  }

  return NextResponse.json({
    reset_count: clinicIds.length,
    clinic_ids: clinicIds,
  });
}

export async function GET(req: Request) {
  return handleAiCapReset(req);
}

export async function POST(req: Request) {
  return handleAiCapReset(req);
}
