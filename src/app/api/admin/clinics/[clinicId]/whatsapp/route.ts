import { NextResponse } from "next/server";

import { CLINIC_BASE_SELECT } from "@/lib/server/clinic";
import { getAgencyAdminState } from "@/lib/server/auth";
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

async function loadClinic(clinicId: string) {
  const admin = createAdminClient();
  if (!admin) {
    return { admin: null, clinic: null };
  }

  const { data } = await admin
    .from("clinics")
    .select(WHATSAPP_SELECT)
    .eq("id", clinicId)
    .single();

  return { admin, clinic: (data as unknown as Record<string, unknown> | null) };
}

async function loadConnectionStateWithRecovery(input: {
  clinicId: string;
  clinic: Record<string, unknown>;
  instanceName: string;
  webhookUrl: string;
  webhookSecret: string;
}) {
  let connection = await buildWhatsappConnectionState({
    clinic: {
      id: input.clinic.id as string,
      name: input.clinic.name as string,
      whatsapp_status: "pending_qr",
      evolution_instance_name: input.instanceName,
      whatsapp_number: (input.clinic.whatsapp_number as string | null) ?? null,
      whatsapp_qr_code: (input.clinic.whatsapp_qr_code as string | null) ?? null,
      whatsapp_pairing_code:
        (input.clinic.whatsapp_pairing_code as string | null) ?? null,
      payment_status: (input.clinic.payment_status as string | null) ?? null,
      onboarding_completed_at:
        (input.clinic.onboarding_completed_at as string | null) ?? null,
    },
    includeQr: true,
  });

  if (!connection.is_connected && !connection.qr_code_data_url && connection.error) {
    await recreateWhatsappInstance({
      clinicId: input.clinicId,
      clinicName: input.clinic.name as string,
      instanceName: input.instanceName,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret,
    });

    await sleep(1500);

    connection = await buildWhatsappConnectionState({
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

  return connection;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const { clinicId } = await context.params;
  const includeQr = new URL(req.url).searchParams.get("includeQr") === "1";
  const { admin, clinic } = await loadClinic(clinicId);

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  const connection = await buildWhatsappConnectionState({
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
    connection
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

  if (shouldPersistState && admin) {
    await admin.from("clinics").update(nextStateUpdate).eq("id", clinicId);
  }

  return NextResponse.json({
    connection,
    platformConfigured: hasPlatformWhatsappConfig(),
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const { clinicId } = await context.params;
  const { admin, clinic } = await loadClinic(clinicId);

  if (!admin || !clinic) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  if ((clinic.subscription_status as string) === "churned") {
    return NextResponse.json(
      { error: "Cannot reconnect WhatsApp for a churned clinic." },
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

  await admin
    .from("clinics")
    .update({
      evolution_instance_name: instanceName,
      webhook_secret: webhookSecret,
      whatsapp_status: "pending_qr",
      whatsapp_last_synced_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", clinicId);

  let connection;

  try {
    await ensureClinicWhatsappInstance({
      clinicId: clinic.id as string,
      clinicName: clinic.name as string,
      instanceName,
      webhookUrl,
      webhookSecret,
    });

    connection = await loadConnectionStateWithRecovery({
      clinicId,
      clinic,
      instanceName,
      webhookUrl,
      webhookSecret,
    });

    if (!connection.is_connected && !connection.qr_code_data_url) {
      await sleep(2500);
      const { clinic: refreshedClinic } = await loadClinic(clinicId);
      if (refreshedClinic) {
        connection = await loadConnectionStateWithRecovery({
          clinicId,
          clinic: refreshedClinic,
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

  await admin
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
          payment_status: (clinic.payment_status as string | null) ?? null,
          onboarding_completed_at:
            (clinic.onboarding_completed_at as string | null) ?? null,
        },
        connection,
        nowIso
      )
    )
    .eq("id", clinicId);

  if (connection.error) {
    return NextResponse.json(
      {
        error: connection.error,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    connection,
    platformConfigured: hasPlatformWhatsappConfig(),
  });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const { clinicId } = await context.params;
  const { admin, clinic } = await loadClinic(clinicId);

  if (!admin || !clinic) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }

  if (clinic.evolution_instance_name) {
    const result = await disconnectWhatsappInstance(
      clinic.evolution_instance_name as string
    );
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
  }

  await admin
    .from("clinics")
    .update({
      whatsapp_status: "disconnected",
      whatsapp_connected_at: null,
      whatsapp_last_synced_at: new Date().toISOString(),
      onboarding_completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId);

  return NextResponse.json({ success: true });
}
