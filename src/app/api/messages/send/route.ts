import { NextResponse } from "next/server";

import { isAutomationSchemaMismatchError, scheduleFollowUpJobs } from "@/lib/server/automation";
import { getClinicUsageSummary } from "@/lib/server/clinic";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { hasMarketingOptedOut } from "@/lib/server/compliance";
import { insertMessageRecord } from "@/lib/server/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";
import { sendWhatsappMessage } from "@/lib/server/whatsapp";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "Internal server error";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      contactId?: string;
      contact_id?: string;
      message?: string;
      content?: string;
      clinic_id?: string;
    };
    const contactId = body.contactId ?? body.contact_id;
    const message = body.message ?? body.content;

    if (!contactId || !message?.trim()) {
      return NextResponse.json({ error: "Missing contactId or message" }, { status: 400 });
    }

    const { supabase, membership } = await requireMembership();
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .single();

    if (contactError || !contact || contact.clinic_id !== membership.clinic_id) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    if (hasMarketingOptedOut(contact as { marketing_opt_out_at?: string | null })) {
      return NextResponse.json(
        { error: "This contact has opted out. Resume messaging consent before sending." },
        { status: 403 }
      );
    }

    const { data: clinic, error: clinicError } = await supabase
      .from("clinics")
      .select(
        "id, name, plan_type, subscription_status, payment_status, whatsapp_status, evolution_instance_name, evolution_api_url, evolution_api_key, billing_cycle_anchor, payment_received_at, created_at, contact_limit_override, monthly_message_limit_override"
      )
      .eq("id", membership.clinic_id)
      .single();

    if (clinicError || !clinic) {
      return NextResponse.json({ error: "Clinic settings could not be loaded." }, { status: 500 });
    }

    const clinicRow = clinic as unknown as Record<string, unknown>;

    if ((clinicRow.subscription_status as string) !== "active") {
      return NextResponse.json({ error: "This subscription is not active." }, { status: 403 });
    }

    if ((clinicRow.payment_status as string) !== "received") {
      return NextResponse.json({ error: "Payment is still pending for this clinic." }, { status: 403 });
    }

    if ((clinicRow.whatsapp_status as string) !== "connected") {
      return NextResponse.json({ error: "Clinic WhatsApp is disconnected." }, { status: 403 });
    }

    const usage = await getClinicUsageSummary(supabase, {
      id: clinicRow.id as string,
      plan_type: ((clinicRow.plan_type as "starter" | "pro") ?? "starter"),
      payment_received_at: (clinicRow.payment_received_at as string | null) ?? null,
      billing_cycle_anchor: (clinicRow.billing_cycle_anchor as string | null) ?? null,
      created_at: (clinicRow.created_at as string | null) ?? null,
      contact_limit_override: (clinicRow.contact_limit_override as number | null) ?? null,
      monthly_message_limit_override:
        (clinicRow.monthly_message_limit_override as number | null) ?? null,
    });

    if (usage.monthly_message_limit_reached) {
      return NextResponse.json(
        {
          error:
            "This clinic has reached its monthly sent-message limit. Contact admin to upgrade the plan.",
        },
        { status: 403 }
      );
    }

    const writer = createAdminClient() ?? supabase;
    const conversationId = await ensureConversationForContact(
      writer,
      membership.clinic_id,
      contactId
    );

    const sendResult = await sendWhatsappMessage({
      clinic: {
        id: clinicRow.id as string,
        name: clinicRow.name as string,
        evolution_instance_name: clinicRow.evolution_instance_name as string | null,
        evolution_api_url: clinicRow.evolution_api_url as string | null,
        evolution_api_key: clinicRow.evolution_api_key as string | null,
        whatsapp_status: clinicRow.whatsapp_status as
          | "not_connected"
          | "pending_qr"
          | "connected"
          | "disconnected"
          | null,
      },
      contactId,
      phone: contact.phone_e164 as string,
      message: message.trim(),
      senderType: "human",
    });

    if (!sendResult.success) {
      return NextResponse.json({ error: sendResult.error }, { status: 502 });
    }

    const nowIso = new Date().toISOString();

    await insertMessageRecord(writer, {
      clinic_id: contact.clinic_id as string,
      contact_id: contactId,
      conversation_id: conversationId,
      provider_message_id:
        "providerMessageId" in sendResult ? sendResult.providerMessageId : null,
      direction: "outbound",
      sender_type: "human",
      content: message.trim(),
    });

    await writer
      .from("contacts")
      .update({
        last_outbound_at: nowIso,
        updated_at: nowIso,
        bot_mode: "paused",
        last_handoff_reason: "human_replied",
      })
      .eq("id", contactId)
      .eq("clinic_id", membership.clinic_id);

    try {
      await enqueueContactMemoryJob(writer, {
        clinicId: membership.clinic_id,
        contactId,
        triggerSource: "message_outbound_human",
      });
    } catch (error) {
      if (!isContactMemorySchemaMismatchError(error)) {
        throw error;
      }
    }

    const admin = createAdminClient();
    if (admin && contact.automation_enabled !== false) {
      try {
        await scheduleFollowUpJobs(admin, membership.clinic_id, contactId, new Date());
      } catch (error) {
        if (!isAutomationSchemaMismatchError(error)) {
          throw error;
        }
      }
    }

    return NextResponse.json({ success: true, sent: true });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
