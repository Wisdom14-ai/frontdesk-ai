import { NextResponse } from "next/server";

import { CLINIC_BASE_SELECT } from "@/lib/server/clinic";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import {
  buildWhatsappConnectionState,
  buildWhatsappInstanceName,
  buildWhatsappStateUpdate,
  buildWhatsappWebhookUrl,
  disconnectWhatsappInstance,
  ensureClinicWhatsappInstance,
  generateWebhookSecret,
  hasPlatformWhatsappConfig,
  recreateWhatsappInstance,
} from "@/lib/server/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

const WHATSAPP_SELECT = `${CLINIC_BASE_SELECT}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConnectionStateWithRecovery(input: {
  clinicId: string;
  clinic: Record<string, unknown>;
  instanceName: string;
  webhookUrl: string;
  webhookSecret: string;
}) {
  let state = await buildWhatsappConnectionState({
    clinic: {
      id: input.clinic.id as string,
      name: input.clinic.name as string,
      whatsapp_status: "pending_qr",
      evolution_instance_name: input.instanceName,
      whatsapp_number: (input.clinic.whatsapp_number as string | null) ?? null,
      whatsapp_qr_code: (input.clinic.whatsapp_qr_code as string | null) ?? null,
      whatsapp_pairing_code: (input.clinic.whatsapp_pairing_code as string | null) ?? null,
      payment_status: (input.clinic.payment_status as string | null) ?? null,
      onboarding_completed_at:
        (input.clinic.onboarding_completed_at as string | null) ?? null,
    },
    includeQr: true,
  });

  if (!state.is_connected && !state.qr_code_data_url && state.error) {
    await recreateWhatsappInstance({
      clinicId: input.clinicId,
      clinicName: input.clinic.name as string,
      instanceName: input.instanceName,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret,
    });

    await sleep(1500);

    state = await buildWhatsappConnectionState({
      clinic: {
        id: input.clinic.id as string,
        name: input.clinic.name as string,
        whatsapp_status: "pending_qr",
        evolution_instance_name: input.instanceName,
        whatsapp_number: (input.clinic.whatsapp_number as string | null) ?? null,
        whatsapp_qr_code: null,
        whatsapp_pairing_code: null,
        payment_status: (input.clinic.payment_status as string | null) ?? null,
        onboarding_completed_at:
          (input.clinic.onboarding_completed_at as string | null) ?? null,
      },
      includeQr: true,
    });
  }

  return state;
}

export async function GET(req: Request) {
  const { supabase, membership } = await requireMembership();
  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "Only managers and admins can manage WhatsApp settings." },
      { status: 403 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  const includeQr = new URL(req.url).searchParams.get("includeQr") === "1";

  const { data, error } = await supabase
    .from("clinics")
    .select(WHATSAPP_SELECT)
    .eq("id", membership.clinic_id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to load WhatsApp connection." },
      { status: 500 }
    );
  }

  const clinic = data as unknown as Record<string, unknown>;

  const state = await buildWhatsappConnectionState({
    clinic: {
      id: clinic.id as string,
      name: clinic.name as string,
      whatsapp_status: clinic.whatsapp_status as
        | "not_connected"
        | "pending_qr"
        | "connected"
        | "disconnected"
        | null,
      evolution_instance_name:
        (clinic.evolution_instance_name as string | null) ?? null,
      whatsapp_number: (clinic.whatsapp_number as string | null) ?? null,
      whatsapp_qr_code: (clinic.whatsapp_qr_code as string | null) ?? null,
      whatsapp_pairing_code: (clinic.whatsapp_pairing_code as string | null) ?? null,
    },
    includeQr,
  });

  const nextStateUpdate = buildWhatsappStateUpdate(
    {
      id: clinic.id as string,
      name: clinic.name as string,
      whatsapp_status: clinic.whatsapp_status as
        | "not_connected"
        | "pending_qr"
        | "connected"
        | "disconnected"
        | null,
      evolution_instance_name:
        (clinic.evolution_instance_name as string | null) ?? null,
      webhook_secret: (clinic.webhook_secret as string | null) ?? null,
      whatsapp_number: (clinic.whatsapp_number as string | null) ?? null,
      whatsapp_qr_code: (clinic.whatsapp_qr_code as string | null) ?? null,
      whatsapp_pairing_code:
        (clinic.whatsapp_pairing_code as string | null) ?? null,
      payment_status: (clinic.payment_status as string | null) ?? null,
      onboarding_completed_at:
        (clinic.onboarding_completed_at as string | null) ?? null,
    },
    state
  );

  const shouldPersistState =
    nextStateUpdate.whatsapp_status !== clinic.whatsapp_status ||
    (nextStateUpdate.whatsapp_number ?? null) !==
      ((clinic.whatsapp_number as string | null) ?? null) ||
    (nextStateUpdate.whatsapp_qr_code ?? null) !==
      ((clinic.whatsapp_qr_code as string | null) ?? null) ||
    (nextStateUpdate.whatsapp_pairing_code ?? null) !==
      ((clinic.whatsapp_pairing_code as string | null) ?? null) ||
    (nextStateUpdate.onboarding_completed_at ?? null) !==
      ((clinic.onboarding_completed_at as string | null) ?? null);

  if (shouldPersistState) {
    await writer.from("clinics").update(nextStateUpdate).eq("id", membership.clinic_id);
  }

  return NextResponse.json({
    connection: state,
    platformConfigured: hasPlatformWhatsappConfig(),
  });
}

export async function POST(req: Request) {
  const { supabase, membership } = await requireMembership();
  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "Only managers and admins can manage WhatsApp settings." },
      { status: 403 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  const { data, error } = await writer
    .from("clinics")
    .select(WHATSAPP_SELECT)
    .eq("id", membership.clinic_id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to load clinic WhatsApp state." },
      { status: 500 }
    );
  }

  const clinic = data as unknown as Record<string, unknown>;

  if ((clinic.subscription_status as string) !== "active") {
    return NextResponse.json(
      { error: "Your subscription is not active." },
      { status: 403 }
    );
  }

  const instanceName =
    (clinic.evolution_instance_name as string | null) ??
    buildWhatsappInstanceName(clinic.id as string, clinic.name as string);
  const webhookSecret =
    (clinic.webhook_secret as string | null) ?? generateWebhookSecret();
  const requestUrl = new URL(req.url);
  const webhookUrl = buildWhatsappWebhookUrl(requestUrl, webhookSecret);
  const nowIso = new Date().toISOString();

  await writer
    .from("clinics")
    .update({
      evolution_instance_name: instanceName,
      webhook_secret: webhookSecret,
      whatsapp_status: "pending_qr",
      whatsapp_qr_code: null,
      whatsapp_pairing_code: null,
      whatsapp_last_synced_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", membership.clinic_id);

  let refreshedState;

  try {
    await ensureClinicWhatsappInstance({
      clinicId: clinic.id as string,
      clinicName: clinic.name as string,
      instanceName,
      webhookUrl,
      webhookSecret,
    });

    refreshedState = await loadConnectionStateWithRecovery({
      clinicId: membership.clinic_id,
      clinic,
      instanceName,
      webhookUrl,
      webhookSecret,
    });

    if (!refreshedState.is_connected && !refreshedState.qr_code_data_url) {
      await sleep(2500);

      const { data: qrClinic } = await writer
        .from("clinics")
        .select(WHATSAPP_SELECT)
        .eq("id", membership.clinic_id)
        .single();

      if (qrClinic) {
        refreshedState = await loadConnectionStateWithRecovery({
          clinicId: membership.clinic_id,
          clinic: qrClinic as unknown as Record<string, unknown>,
          instanceName,
          webhookUrl,
          webhookSecret,
        });
      }
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start the WhatsApp connection.",
      },
      { status: 502 }
    );
  }

  await writer
    .from("clinics")
    .update(
      buildWhatsappStateUpdate(
        {
          id: clinic.id as string,
          name: clinic.name as string,
      whatsapp_status: clinic.whatsapp_status as
        | "not_connected"
        | "pending_qr"
            | "connected"
            | "disconnected"
            | null,
          evolution_instance_name: instanceName,
      webhook_secret: webhookSecret,
      whatsapp_number: (clinic.whatsapp_number as string | null) ?? null,
      whatsapp_qr_code: (clinic.whatsapp_qr_code as string | null) ?? null,
      whatsapp_pairing_code: (clinic.whatsapp_pairing_code as string | null) ?? null,
      payment_status: (clinic.payment_status as string | null) ?? null,
      onboarding_completed_at:
        (clinic.onboarding_completed_at as string | null) ?? null,
        },
        refreshedState,
        nowIso
      )
    )
    .eq("id", membership.clinic_id);

  if (refreshedState.error) {
    return NextResponse.json(
      {
        error: refreshedState.error,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    connection: refreshedState,
    platformConfigured: hasPlatformWhatsappConfig(),
  });
}

export async function DELETE() {
  const { supabase, membership } = await requireMembership();
  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "Only managers and admins can manage WhatsApp settings." },
      { status: 403 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  const { data, error } = await writer
    .from("clinics")
    .select(WHATSAPP_SELECT)
    .eq("id", membership.clinic_id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to load clinic WhatsApp state." },
      { status: 500 }
    );
  }

  const clinic = data as unknown as Record<string, unknown>;

  if (clinic.evolution_instance_name) {
    const result = await disconnectWhatsappInstance(
      clinic.evolution_instance_name as string
    );
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
  }

  await writer
    .from("clinics")
    .update({
      whatsapp_status: "disconnected",
      whatsapp_qr_code: null,
      whatsapp_pairing_code: null,
      whatsapp_connected_at: null,
      whatsapp_last_synced_at: new Date().toISOString(),
      onboarding_completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership.clinic_id);

  return NextResponse.json({ success: true });
}
