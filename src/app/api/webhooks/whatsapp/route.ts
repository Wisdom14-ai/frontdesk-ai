import { NextResponse } from "next/server";

import { cancelPendingAutomationJobs } from "@/lib/server/automation";
import { buildOnboardingFields, getClinicUsageSummary } from "@/lib/server/clinic";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import {
  findMessageContactByProviderMessageId,
  insertMessageRecord,
} from "@/lib/server/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPhoneLookupVariants,
  getWebhookConnectionState,
  getWebhookEventName,
  getWebhookInstanceName,
  getWebhookPairingCode,
  getWebhookQrCodeDataUrl,
  isWebhookFromMe,
  isWebhookMessageEvent,
  normalizeInboundWebhookPayload,
  normalizePhoneNumber,
} from "@/lib/server/whatsapp";

function buildClinicConnectionUpdate(
  clinic: Record<string, unknown>,
  whatsappStatus: "connected" | "pending_qr",
  nowIso: string,
  qrCodeDataUrl?: string | null,
  pairingCode?: string | null
) {
  return {
    whatsapp_status: whatsappStatus,
    whatsapp_qr_code: whatsappStatus === "connected" ? null : qrCodeDataUrl ?? null,
    whatsapp_pairing_code:
      whatsappStatus === "connected" ? null : pairingCode ?? null,
    whatsapp_last_synced_at: nowIso,
    whatsapp_connected_at: whatsappStatus === "connected" ? nowIso : null,
    updated_at: nowIso,
    ...buildOnboardingFields({
      paymentStatus: (clinic.payment_status as string) === "received" ? "received" : "pending",
      whatsappStatus,
      currentOnboardingCompletedAt:
        (clinic.onboarding_completed_at as string | null) ?? null,
      nowIso,
    }),
  };
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const token =
      url.searchParams.get("token")?.trim() ??
      req.headers.get("x-webhook-secret")?.trim();

    if (!token) {
      return NextResponse.json({ error: "Webhook secret is required." }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();

    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const instanceName = getWebhookInstanceName(body);

    const { data: clinic, error: clinicError } = await supabaseAdmin
      .from("clinics")
      .select(
        "id, name, plan_type, subscription_status, payment_status, whatsapp_status, payment_received_at, billing_cycle_anchor, created_at, contact_limit_override, monthly_message_limit_override, evolution_instance_name, webhook_secret, onboarding_completed_at, whatsapp_qr_code, whatsapp_pairing_code"
      )
      .eq("webhook_secret", token)
      .maybeSingle();
    if (clinicError || !clinic) {
      return NextResponse.json({ error: "Webhook clinic could not be resolved." }, { status: 404 });
    }

    const clinicRow = clinic as unknown as Record<string, unknown>;

    if (
      instanceName &&
      typeof clinicRow.evolution_instance_name === "string" &&
      clinicRow.evolution_instance_name.length > 0 &&
      clinicRow.evolution_instance_name !== instanceName
    ) {
      return NextResponse.json(
        { error: "Webhook instance does not match the configured clinic instance." },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();
    const eventName = getWebhookEventName(body);
    const connectionState = getWebhookConnectionState(body);
    const qrCodeDataUrl = getWebhookQrCodeDataUrl(body);
    const pairingCode = getWebhookPairingCode(body);
    const isConnectionLifecycleEvent =
      eventName === "connection.update" || eventName === "qrcode.updated";

    if (eventName === "connection.update" && connectionState === "open") {
      await supabaseAdmin
        .from("clinics")
        .update(buildClinicConnectionUpdate(clinicRow, "connected", nowIso))
        .eq("id", clinicRow.id as string);
    } else if (isConnectionLifecycleEvent) {
      await supabaseAdmin
        .from("clinics")
        .update(
          buildClinicConnectionUpdate(
            clinicRow,
            "pending_qr",
            nowIso,
            qrCodeDataUrl ?? (clinicRow.whatsapp_qr_code as string | null) ?? null,
            pairingCode ?? (clinicRow.whatsapp_pairing_code as string | null) ?? null
          )
        )
        .eq("id", clinicRow.id as string);
    }

    if (!isWebhookMessageEvent(body)) {
      return NextResponse.json({ success: true, ignored: true, event: eventName });
    }

    if (isWebhookFromMe(body)) {
      return NextResponse.json({ success: true, ignored: true, reason: "from_me" });
    }

    const payload = normalizeInboundWebhookPayload(body);
    if (!payload) {
      return NextResponse.json({ success: true, ignored: true, reason: "unsupported_payload" }, { status: 202 });
    }

    await supabaseAdmin
      .from("clinics")
      .update(buildClinicConnectionUpdate(clinicRow, "connected", nowIso))
      .eq("id", clinicRow.id as string);

    const normalizedPhone = normalizePhoneNumber(payload.phone);
    if (!normalizedPhone) {
      return NextResponse.json({ success: true, ignored: true, reason: "invalid_phone" }, { status: 202 });
    }

    if (payload.messageId) {
      const duplicateContactId = await findMessageContactByProviderMessageId(
        supabaseAdmin,
        clinicRow.id as string,
        payload.messageId
      );

      if (duplicateContactId) {
        return NextResponse.json({
          success: true,
          contactId: duplicateContactId,
          duplicate: true,
        });
      }
    }

    let contactId: string;
    const phoneLookupVariants = buildPhoneLookupVariants(payload.phone);

    const { data: existingContacts } = await supabaseAdmin
      .from("contacts")
      .select("id, unread_count, phone_e164, created_at")
      .in("phone_e164", phoneLookupVariants)
      .eq("clinic_id", clinicRow.id as string)
      .order("created_at", { ascending: true });

    const existingContact =
      (existingContacts ?? []).find(
        (contact) => (contact.phone_e164 as string | null) === normalizedPhone
      ) ??
      (existingContacts ?? [])[0] ??
      null;

    if (existingContact) {
      contactId = existingContact.id as string;
      await supabaseAdmin
        .from("contacts")
        .update({
          phone_e164: normalizedPhone,
          unread_count: ((existingContact.unread_count as number | null) ?? 0) + 1,
          last_inbound_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", contactId);
    } else {
      const usage = await getClinicUsageSummary(supabaseAdmin, {
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
        return NextResponse.json({ success: true, limitReached: true }, { status: 202 });
      }

      const { data: newContact, error } = await supabaseAdmin
        .from("contacts")
        .insert({
          clinic_id: clinicRow.id as string,
          full_name: payload.contactName || normalizedPhone,
          phone_e164: normalizedPhone,
          current_status: "new_lead",
          unread_count: 1,
          last_inbound_at: nowIso,
          source: "whatsapp_inbound",
          bot_mode: "active",
          automation_enabled: true,
        })
        .select("id")
        .single();

      if (error || !newContact) {
        throw error ?? new Error("Failed to create inbound lead.");
      }

      contactId = newContact.id as string;
    }

    const conversationId = await ensureConversationForContact(
      supabaseAdmin,
      clinicRow.id as string,
      contactId
    );

    const messageInsert = {
      clinic_id: clinicRow.id as string,
      contact_id: contactId,
      conversation_id: conversationId,
      provider_message_id: payload.messageId ?? null,
      direction: "inbound" as const,
      sender_type: "lead" as const,
      content: payload.message,
    };

    try {
      await insertMessageRecord(supabaseAdmin, messageInsert);
    } catch (messageError) {
      if (
        messageError &&
        typeof messageError === "object" &&
        "code" in messageError &&
        (messageError as { code?: unknown }).code === "23505"
      ) {
        return NextResponse.json({ success: true, contactId, duplicate: true });
      }

      throw messageError;
    }

    try {
      await enqueueContactMemoryJob(supabaseAdmin, {
        clinicId: clinicRow.id as string,
        contactId,
        triggerSource: "message_inbound",
      });
    } catch (error) {
      if (!isContactMemorySchemaMismatchError(error)) {
        throw error;
      }
    }

    await cancelPendingAutomationJobs(
      supabaseAdmin,
      clinicRow.id as string,
      contactId,
      "lead_replied"
    );

    return NextResponse.json({ success: true, contactId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
