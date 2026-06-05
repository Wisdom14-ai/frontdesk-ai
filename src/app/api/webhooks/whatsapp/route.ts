import { NextResponse } from "next/server";

import {
  cancelPendingAutomationJobs,
  isAutomationSchemaMismatchError,
  scheduleFollowUpJobs,
} from "@/lib/server/automation";
import {
  markBroadcastCampaignReplyForContact,
  markCampaignJobDelivered,
  markCampaignJobOptedOut,
  markCampaignJobRead,
} from "@/lib/server/campaigns";
import {
  detectMarketingOptOut,
  markContactMarketingOptOut,
} from "@/lib/server/compliance";
import { buildOnboardingFields, getClinicUsageSummary } from "@/lib/server/clinic";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { handleInboundWhatsappChatbot } from "@/lib/server/whatsapp-chatbot";
import {
  detectTreatmentInterest,
  shouldUpdateTreatmentInterest,
} from "@/lib/server/lead-intelligence";
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
  getWebhookMessageId,
  getWebhookMessageStatus,
  getWebhookPairingCode,
  getWebhookQrCodeDataUrl,
  isWebhookFromMe,
  isWebhookMessageEvent,
  isWebhookMessageStatusEvent,
  type InboundWebhookPayload,
  normalizeInboundWebhookPayload,
  normalizePhoneNumber,
  sanitizeContactName,
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

function getWebhookErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function getSelfNameHints(input: {
  clinicRow: Record<string, unknown>;
  payload?: InboundWebhookPayload;
}) {
  return [
    input.clinicRow.name as string | null | undefined,
    input.clinicRow.evolution_instance_name as string | null | undefined,
    input.payload?.instanceName,
  ];
}

function getSafeIncomingContactName(input: {
  clinicRow: Record<string, unknown>;
  payload: InboundWebhookPayload;
  phone: string;
}) {
  return sanitizeContactName({
    incomingName: input.payload.contactName,
    phone: input.phone,
    selfNames: getSelfNameHints({
      clinicRow: input.clinicRow,
      payload: input.payload,
    }),
  });
}

function getContactNameUpdate(input: {
  currentName?: string | null;
  incomingName?: string | null;
  phone: string;
  selfNames?: Array<string | null | undefined>;
}) {
  const trustedIncomingName = sanitizeContactName({
    incomingName: input.incomingName,
    phone: input.phone,
    selfNames: input.selfNames,
  });

  const currentName = input.currentName?.trim() ?? "";
  const trustedCurrentName = sanitizeContactName({
    incomingName: currentName,
    phone: input.phone,
    selfNames: input.selfNames,
  });
  const currentIsPlaceholder =
    !currentName ||
    currentName === input.phone ||
    currentName.replace(/\D/g, "") === input.phone.replace(/\D/g, "") ||
    !trustedCurrentName;

  if (trustedIncomingName && currentIsPlaceholder) {
    return trustedIncomingName;
  }

  if (!trustedCurrentName && currentName && currentName !== input.phone) {
    return input.phone;
  }

  return null;
}

async function markChatbotHandoff(input: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  clinicId: string;
  contactId: string;
  reason: string;
}) {
  await input.admin
    .from("contacts")
    .update({
      bot_mode: "handoff_required",
      last_handoff_reason: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", input.clinicId)
    .eq("id", input.contactId);
}

async function hasRecentMatchingOutbound(input: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  clinicId: string;
  contactId: string;
  content: string;
}) {
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data, error } = await input.admin
    .from("messages")
    .select("id")
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("direction", "outbound")
    .eq("content", input.content)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

async function handleManualOutboundWebhook(input: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  clinicRow: Record<string, unknown>;
  payload: InboundWebhookPayload;
  normalizedPhone: string;
}) {
  const clinicId = input.clinicRow.id as string;
  const nowIso = new Date().toISOString();
  const phoneLookupVariants = buildPhoneLookupVariants(input.payload.phone);
  const safeIncomingName = getSafeIncomingContactName({
    clinicRow: input.clinicRow,
    payload: input.payload,
    phone: input.normalizedPhone,
  });
  const selfNameHints = getSelfNameHints({
    clinicRow: input.clinicRow,
    payload: input.payload,
  });

  const { data: existingContacts } = await input.admin
    .from("contacts")
    .select("id, full_name, phone_e164, created_at, automation_enabled")
    .in("phone_e164", phoneLookupVariants)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });

  const existingContact =
    (existingContacts ?? []).find(
      (contact) => (contact.phone_e164 as string | null) === input.normalizedPhone
    ) ??
    (existingContacts ?? [])[0] ??
    null;

  let contactId: string;
  let automationEnabled = true;

  if (existingContact) {
    contactId = existingContact.id as string;
    automationEnabled =
      (existingContact.automation_enabled as boolean | null | undefined) !== false;

    const updates: Record<string, unknown> = {
      phone_e164: input.normalizedPhone,
      last_outbound_at: nowIso,
      updated_at: nowIso,
    };
    const nameUpdate = getContactNameUpdate({
      currentName: existingContact.full_name as string | null,
      incomingName: safeIncomingName,
      phone: input.normalizedPhone,
      selfNames: selfNameHints,
    });
    if (nameUpdate) {
      updates.full_name = nameUpdate;
    }

    await input.admin
      .from("contacts")
      .update(updates)
      .eq("id", contactId)
      .eq("clinic_id", clinicId);
  } else {
    const usage = await getClinicUsageSummary(input.admin, {
      id: clinicId,
      plan_type: ((input.clinicRow.plan_type as "starter" | "pro") ?? "starter"),
      payment_received_at:
        (input.clinicRow.payment_received_at as string | null) ?? null,
      billing_cycle_anchor:
        (input.clinicRow.billing_cycle_anchor as string | null) ?? null,
      created_at: (input.clinicRow.created_at as string | null) ?? null,
      contact_limit_override:
        (input.clinicRow.contact_limit_override as number | null) ?? null,
      monthly_message_limit_override:
        (input.clinicRow.monthly_message_limit_override as number | null) ?? null,
    });

    if (usage.contact_limit_reached) {
      return { contactId: null, duplicate: false, limitReached: true };
    }

    const { data: newContact, error } = await input.admin
      .from("contacts")
      .insert({
        clinic_id: clinicId,
        full_name: safeIncomingName ?? input.normalizedPhone,
        phone_e164: input.normalizedPhone,
        current_status: "new_lead",
        unread_count: 0,
        last_outbound_at: nowIso,
        source: "manual_whatsapp_outbound",
        bot_mode: "active",
        automation_enabled: true,
      })
      .select("id")
      .single();

    if (error || !newContact) {
      throw error ?? new Error("Failed to create outbound lead.");
    }

    contactId = newContact.id as string;
  }

  if (
    !input.payload.messageId &&
    (await hasRecentMatchingOutbound({
      admin: input.admin,
      clinicId,
      contactId,
      content: input.payload.message,
    }))
  ) {
    return { contactId, duplicate: true, limitReached: false };
  }

  const conversationId = await ensureConversationForContact(
    input.admin,
    clinicId,
    contactId
  );

  await insertMessageRecord(input.admin, {
    clinic_id: clinicId,
    contact_id: contactId,
    conversation_id: conversationId,
    provider_message_id: input.payload.messageId ?? null,
    direction: "outbound",
    sender_type: "human",
    content: input.payload.message,
  });

  try {
    await enqueueContactMemoryJob(input.admin, {
      clinicId,
      contactId,
      triggerSource: "message_outbound_human",
    });
  } catch (error) {
    if (!isContactMemorySchemaMismatchError(error)) {
      throw error;
    }
  }

  if (automationEnabled) {
    try {
      await scheduleFollowUpJobs(input.admin, clinicId, contactId, new Date());
    } catch (error) {
      if (!isAutomationSchemaMismatchError(error)) {
        throw error;
      }
    }
  }

  return { contactId, duplicate: false, limitReached: false };
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
        "id, name, clinic_prompt, plan_type, subscription_status, payment_status, whatsapp_status, payment_received_at, billing_cycle_anchor, created_at, contact_limit_override, monthly_message_limit_override, evolution_instance_name, evolution_api_url, evolution_api_key, webhook_secret, onboarding_completed_at, whatsapp_qr_code, whatsapp_pairing_code"
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

    // Handle outbound message status updates (delivery / read receipts) for
    // campaign analytics. These events fire when a recipient's device
    // acknowledges receipt or when the message has been read.
    if (isWebhookMessageStatusEvent(body)) {
      const status = getWebhookMessageStatus(body);
      const providerMessageId = getWebhookMessageId(body);

      if (providerMessageId && (status === "delivered" || status === "read")) {
        try {
          if (status === "delivered") {
            await markCampaignJobDelivered(supabaseAdmin, {
              clinicId: clinicRow.id as string,
              providerMessageId,
            });
          } else {
            await markCampaignJobRead(supabaseAdmin, {
              clinicId: clinicRow.id as string,
              providerMessageId,
            });
          }
        } catch (statusError) {
          console.warn("[whatsapp-webhook] Failed to record status update", {
            clinicId: clinicRow.id,
            providerMessageId,
            status,
            message:
              statusError instanceof Error
                ? statusError.message
                : String(statusError),
          });
        }
      }

      return NextResponse.json({
        success: true,
        ignored: false,
        event: eventName,
        status,
      });
    }

    if (!isWebhookMessageEvent(body)) {
      return NextResponse.json({ success: true, ignored: true, event: eventName });
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

    if (isWebhookFromMe(body)) {
      const outbound = await handleManualOutboundWebhook({
        admin: supabaseAdmin,
        clinicRow,
        payload,
        normalizedPhone,
      });

      return NextResponse.json({
        success: true,
        contactId: outbound.contactId,
        outbound: true,
        duplicate: outbound.duplicate ?? false,
        limitReached: outbound.limitReached ?? false,
      });
    }

    let contactId: string;
    const phoneLookupVariants = buildPhoneLookupVariants(payload.phone);
    const detectedTreatment = detectTreatmentInterest(payload.message);
    const marketingOptOut = detectMarketingOptOut(payload.message);
    const safeIncomingName = getSafeIncomingContactName({
      clinicRow,
      payload,
      phone: normalizedPhone,
    });
    const selfNameHints = getSelfNameHints({ clinicRow, payload });

    const { data: existingContacts } = await supabaseAdmin
      .from("contacts")
      .select("id, full_name, unread_count, phone_e164, treatment_interest, current_status, created_at")
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

      const contactUpdates: Record<string, unknown> = {
        phone_e164: normalizedPhone,
        unread_count: ((existingContact.unread_count as number | null) ?? 0) + 1,
        last_inbound_at: nowIso,
        updated_at: nowIso,
      };

      if (
        shouldUpdateTreatmentInterest(
          existingContact.treatment_interest as string | null,
          detectedTreatment
        )
      ) {
        contactUpdates.treatment_interest = detectedTreatment;
      }

      const nameUpdate = getContactNameUpdate({
        currentName: existingContact.full_name as string | null,
        incomingName: safeIncomingName,
        phone: normalizedPhone,
        selfNames: selfNameHints,
      });
      if (nameUpdate) {
        contactUpdates.full_name = nameUpdate;
      }

      await supabaseAdmin
        .from("contacts")
        .update(contactUpdates)
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
          full_name: safeIncomingName ?? normalizedPhone,
          phone_e164: normalizedPhone,
          treatment_interest: detectedTreatment,
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

    try {
      await markBroadcastCampaignReplyForContact(supabaseAdmin, {
        clinicId: clinicRow.id as string,
        contactId,
        repliedAt: nowIso,
      });
    } catch (error) {
      console.warn("[whatsapp-webhook] Failed to track campaign reply", {
        clinicId: clinicRow.id,
        contactId,
        message:
          error instanceof Error ? error.message : String(error),
      });
    }

    await cancelPendingAutomationJobs(
      supabaseAdmin,
      clinicRow.id as string,
      contactId,
      "lead_replied",
      ["no_reply_follow_up", "monthly_nurture"]
    );

    if (marketingOptOut) {
      await markContactMarketingOptOut(supabaseAdmin, {
        clinicId: clinicRow.id as string,
        contactId,
        reason: marketingOptOut.reason,
        source: marketingOptOut.source,
        currentStatus:
          (existingContact?.current_status as string | null | undefined) ?? null,
      });

      // Attribute the opt-out to the most recent campaign that messaged this
      // contact, so clinics can see which campaigns trigger complaints.
      try {
        await markCampaignJobOptedOut(supabaseAdmin, {
          clinicId: clinicRow.id as string,
          contactId,
          optedOutAt: nowIso,
        });
      } catch (optOutError) {
        console.warn("[whatsapp-webhook] Failed to attribute campaign opt-out", {
          clinicId: clinicRow.id,
          contactId,
          message:
            optOutError instanceof Error
              ? optOutError.message
              : String(optOutError),
        });
      }

      await cancelPendingAutomationJobs(
        supabaseAdmin,
        clinicRow.id as string,
        contactId,
        `marketing_opt_out_${marketingOptOut.reason}`
      );

      return NextResponse.json({
        success: true,
        contactId,
        marketingOptOut: true,
        reason: marketingOptOut.reason,
      });
    }

    try {
      await handleInboundWhatsappChatbot({
        admin: supabaseAdmin,
        clinic: {
          id: clinicRow.id as string,
          name: (clinicRow.name as string | null) ?? null,
          clinic_prompt: (clinicRow.clinic_prompt as string | null) ?? null,
          plan_type: (clinicRow.plan_type as "starter" | "pro" | null) ?? null,
          subscription_status:
            (clinicRow.subscription_status as string | null) ?? null,
          payment_status: (clinicRow.payment_status as string | null) ?? null,
          whatsapp_status: "connected",
          evolution_instance_name:
            (clinicRow.evolution_instance_name as string | null) ?? null,
          evolution_api_url:
            (clinicRow.evolution_api_url as string | null) ?? null,
          evolution_api_key:
            (clinicRow.evolution_api_key as string | null) ?? null,
          payment_received_at:
            (clinicRow.payment_received_at as string | null) ?? null,
          billing_cycle_anchor:
            (clinicRow.billing_cycle_anchor as string | null) ?? null,
          created_at: (clinicRow.created_at as string | null) ?? null,
          contact_limit_override:
            (clinicRow.contact_limit_override as number | null) ?? null,
          monthly_message_limit_override:
            (clinicRow.monthly_message_limit_override as number | null) ?? null,
        },
        contactId,
        inboundMessage: payload.message,
        conversationId,
        detectedTreatment,
      });
    } catch (chatbotError) {
      const reason = getWebhookErrorMessage(chatbotError);
      console.warn("[whatsapp-webhook] Chatbot handoff required", {
        clinicId: clinicRow.id,
        contactId,
        reason,
      });

      await markChatbotHandoff({
        admin: supabaseAdmin,
        clinicId: clinicRow.id as string,
        contactId,
        reason,
      });
    }

    return NextResponse.json({ success: true, contactId });
  } catch (error: unknown) {
    const errorMessage = getWebhookErrorMessage(error);
    console.error("[whatsapp-webhook] Failed to process webhook", {
      message: errorMessage,
    });
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
