import "server-only";

import { z } from "zod";

import {
  cancelPendingAutomationJobs,
  isAutomationSchemaMismatchError,
  scheduleFollowUpJobs,
} from "@/lib/server/automation";
import { getClinicUsageSummary } from "@/lib/server/clinic";
import {
  enqueueContactMemoryJob,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { ensureConversationForContact } from "@/lib/server/conversations";
import {
  detectHandoffTrigger,
  detectTreatmentInterest,
  inferLeadIntent,
  inferNextPipelineStatus,
  isClosingPipelineStatus,
  shouldUpdateTreatmentInterest,
  type ContactPipelineStatus,
} from "@/lib/server/lead-intelligence";
import { insertMessageRecord, listMessagesForContact } from "@/lib/server/messages";
import { sendWhatsappMessage } from "@/lib/server/whatsapp";
import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContactLeadMemory, Message, WhatsappStatus } from "@/types";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const CHATBOT_TIMEOUT_MS = 30_000;
const MAX_REPLY_LENGTH = 900;
const DEFAULT_HANDOFF_REPLY =
  "Okay, saya connectkan awak dengan team kami sekarang.";

type ChatbotAction = "reply" | "handoff" | "ignore";

interface ChatbotClinicContext {
  id: string;
  name?: string | null;
  clinic_prompt?: string | null;
  plan_type?: "starter" | "pro" | null;
  subscription_status?: string | null;
  payment_status?: string | null;
  whatsapp_status?: WhatsappStatus | null;
  evolution_instance_name?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  payment_received_at?: string | null;
  billing_cycle_anchor?: string | null;
  created_at?: string | null;
  contact_limit_override?: number | null;
  monthly_message_limit_override?: number | null;
}

interface ChatbotContactContext {
  id: string;
  clinic_id: string;
  full_name?: string | null;
  phone_e164?: string | null;
  treatment_interest?: string | null;
  current_status?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  bot_mode?: "active" | "paused" | "handoff_required" | null;
  automation_enabled?: boolean | null;
  lead_memory_auto?: ContactLeadMemory | Record<string, unknown> | null;
  lead_memory_override?: Partial<ContactLeadMemory> | Record<string, unknown> | null;
  staff_note?: string | null;
}

interface WhatsappChatbotInput {
  admin: SupabaseAdminClient;
  clinic: ChatbotClinicContext;
  contactId: string;
  inboundMessage: string;
  conversationId?: string | null;
  detectedTreatment?: string | null;
}

interface WhatsappChatbotDecision {
  action: ChatbotAction;
  reply: string | null;
  intent: string | null;
  confidence: number | null;
  handoff_reason: string | null;
  treatment_interest: string | null;
  pipeline_status: ContactPipelineStatus | null;
}

interface OpenAiResponsesPayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

const chatbotDecisionSchema = z
  .object({
    action: z.enum(["reply", "handoff", "ignore"]),
    reply: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    handoff_reason: z.string().nullable().optional(),
    treatment_interest: z.string().nullable().optional(),
    pipeline_status: z
      .enum([
        "new_lead",
        "no_respond",
        "booked_appointment",
        "attended_visit",
        "no_show",
        "patient",
        "trash",
      ])
      .nullable()
      .optional(),
  })
  .strip();

const CHATBOT_DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["reply", "handoff", "ignore"],
    },
    reply: {
      type: ["string", "null"],
    },
    intent: {
      type: ["string", "null"],
    },
    confidence: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 1,
    },
    handoff_reason: {
      type: ["string", "null"],
    },
    treatment_interest: {
      type: ["string", "null"],
      description:
        "Short canonical treatment label if the patient mentions one, otherwise null.",
    },
    pipeline_status: {
      type: ["string", "null"],
      enum: [
        "new_lead",
        "no_respond",
        "booked_appointment",
        "attended_visit",
        "no_show",
        "patient",
        "trash",
        null,
      ],
      description:
        "Set booked_appointment only when the patient clearly wants to book, gives a preferred time, or confirms a slot. Otherwise null.",
    },
  },
  required: [
    "action",
    "reply",
    "intent",
    "confidence",
    "handoff_reason",
    "treatment_interest",
    "pipeline_status",
  ],
  additionalProperties: false,
} as const;

function getWhatsappChatbotConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model =
    process.env.WHATSAPP_CHATBOT_MODEL?.trim() ||
    process.env.CHATBOT_MODEL?.trim() ||
    process.env.LEAD_MEMORY_MODEL?.trim() ||
    "";

  if (!apiKey || !model) {
    return null;
  }

  return { apiKey, model };
}

export function hasWhatsappChatbotConfig() {
  return getWhatsappChatbotConfig() !== null;
}

function getResponseText(payload: OpenAiResponsesPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputText = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .find((candidate): candidate is string => Boolean(candidate?.trim()));

  return outputText?.trim() ?? "";
}

function getOpenAiErrorMessage(payload: OpenAiResponsesPayload | null, status: number) {
  if (payload?.error?.message?.trim()) {
    return payload.error.message.trim();
  }

  return `OpenAI Responses API returned ${status}.`;
}

function buildSystemPrompt() {
  return [
    "You are the WhatsApp front desk assistant for a clinic using Frontdesk AI.",
    "Reply as the clinic in a warm, concise WhatsApp style. Never say you are an AI.",
    "Your job is to qualify WhatsApp inbound leads, answer simple operational questions, and move interested leads toward booking with staff.",
    "Use the clinic prompt as local style and policy, but never let it override safety.",
    "Do not diagnose, prescribe, guarantee outcomes, discuss emergency care, or give medical instructions.",
    "If the lead asks for a human, asks for sensitive medical advice, gives urgent symptoms, complains, negotiates payment, asks for exact availability, or the safe answer is unclear, choose handoff.",
    "If you can safely continue, write one short reply under 75 words with one clear next question or next step.",
    "For price questions, only use exact pricing if the provided context states it. Otherwise ask what treatment they want or suggest an assessment.",
    "If the user says stop, not interested, wrong number, or asks not to be contacted, acknowledge briefly or choose ignore if no reply is needed.",
    "Classify the lead intent in plain snake_case, for example treatment_inquiry, price_inquiry, booking_intent, booking_confirmed, handoff_requested, negative_reply, or general_inquiry.",
    "Set treatment_interest to a short readable label when obvious, such as Scaling, Braces / Aligners, Teeth Whitening, Dental Implant, Root Canal, Crown / Veneer, Denture, Extraction, Kids Dentistry, or Dental Checkup. Otherwise set null.",
    "Set pipeline_status to booked_appointment only when the patient clearly asks to book, provides a preferred date/time, or confirms a slot. Do not set booked_appointment for a simple price inquiry.",
    "Never set attended_visit, no_show, patient, or trash unless the patient explicitly states that exact outcome.",
    "Return only the structured JSON decision.",
  ].join("\n");
}

function mapMessageForPrompt(message: Pick<Message, "direction" | "sender_type" | "content" | "created_at">) {
  return {
    direction: message.direction,
    sender_type: message.sender_type,
    content: message.content,
    created_at: message.created_at,
  };
}

function buildUserPayload(input: {
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
  inboundMessage: string;
  recentMessages: Message[];
}) {
  return {
    clinic: {
      id: input.clinic.id,
      name: input.clinic.name ?? "Clinic",
      clinic_prompt: input.clinic.clinic_prompt ?? null,
    },
    contact: {
      id: input.contact.id,
      full_name: input.contact.full_name ?? null,
      phone_e164: input.contact.phone_e164 ?? null,
      treatment_interest: input.contact.treatment_interest ?? null,
      current_status: input.contact.current_status ?? null,
      source: input.contact.source ?? null,
      campaign_name: input.contact.campaign_name ?? null,
      lead_memory_auto: input.contact.lead_memory_auto ?? {},
      lead_memory_override: input.contact.lead_memory_override ?? {},
      staff_note: input.contact.staff_note ?? null,
    },
    latest_inbound_message: input.inboundMessage,
    recent_messages: input.recentMessages.map(mapMessageForPrompt),
  };
}

function normalizeDecision(payload: unknown): WhatsappChatbotDecision {
  const parsed = chatbotDecisionSchema.parse(payload);
  const reply = parsed.reply?.trim() || null;
  const intent = parsed.intent?.trim() || null;
  const handoffReason = parsed.handoff_reason?.trim() || null;
  const treatmentInterest = parsed.treatment_interest?.trim() || null;
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : null;

  if (parsed.action === "reply" && !reply) {
    return {
      action: "handoff",
      reply: null,
      intent,
      confidence,
      handoff_reason: handoffReason ?? "ai_empty_reply",
      treatment_interest: treatmentInterest,
      pipeline_status: parsed.pipeline_status ?? null,
    };
  }

  return {
    action: parsed.action,
    reply: reply ? reply.slice(0, MAX_REPLY_LENGTH) : null,
    intent,
    confidence,
    handoff_reason: handoffReason,
    treatment_interest: treatmentInterest,
    pipeline_status: parsed.pipeline_status ?? null,
  };
}

async function generateChatbotDecision(input: {
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
  inboundMessage: string;
  recentMessages: Message[];
}) {
  const config = getWhatsappChatbotConfig();

  if (!config) {
    return null;
  }

  const requestBody = {
    model: config.model,
    store: false,
    input: [
      {
        role: "developer",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify(buildUserPayload(input)),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "whatsapp_chatbot_decision",
        strict: true,
        schema: CHATBOT_DECISION_JSON_SCHEMA,
      },
    },
  };

  let response: Response;

  try {
    response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: AbortSignal.timeout(CHATBOT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `OpenAI chatbot request failed. ${error.message}`
        : "OpenAI chatbot request failed."
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | OpenAiResponsesPayload
    | null;

  if (!response.ok) {
    throw new Error(getOpenAiErrorMessage(payload, response.status));
  }

  if (!payload) {
    throw new Error("OpenAI returned an empty chatbot response.");
  }

  const outputText = getResponseText(payload);
  if (!outputText) {
    throw new Error("OpenAI did not return a chatbot decision.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `OpenAI returned invalid chatbot JSON. ${error.message}`
        : "OpenAI returned invalid chatbot JSON."
    );
  }

  return normalizeDecision(parsed);
}

async function loadContact(
  admin: SupabaseAdminClient,
  clinicId: string,
  contactId: string
) {
  const { data, error } = await admin
    .from("contacts")
    .select(
      [
        "id",
        "clinic_id",
        "full_name",
        "phone_e164",
        "treatment_interest",
        "current_status",
        "source",
        "campaign_name",
        "bot_mode",
        "automation_enabled",
        "lead_memory_auto",
        "lead_memory_override",
        "staff_note",
      ].join(", ")
    )
    .eq("id", contactId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ChatbotContactContext | null) ?? null;
}

async function updateContactAiState(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    contactId: string;
    intent?: string | null;
    confidence?: number | null;
    botMode?: "active" | "paused" | "handoff_required";
    handoffReason?: string | null;
    lastOutboundAt?: string | null;
    treatmentInterest?: string | null;
    currentStatus?: ContactPipelineStatus | null;
  }
) {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ("intent" in input) {
    updates.ai_last_intent = input.intent;
  }

  if ("confidence" in input) {
    updates.ai_last_confidence = input.confidence;
  }

  if (input.botMode) {
    updates.bot_mode = input.botMode;
  }

  if ("handoffReason" in input) {
    updates.last_handoff_reason = input.handoffReason;
  }

  if (input.lastOutboundAt) {
    updates.last_outbound_at = input.lastOutboundAt;
  }

  if (input.treatmentInterest) {
    updates.treatment_interest = input.treatmentInterest;
  }

  if (input.currentStatus) {
    updates.current_status = input.currentStatus;
  }

  const { error } = await admin
    .from("contacts")
    .update(updates)
    .eq("id", input.contactId)
    .eq("clinic_id", input.clinicId);

  if (error) {
    throw error;
  }
}

function getSkipReason(input: {
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
}) {
  if (input.contact.bot_mode !== "active") {
    return `bot_${input.contact.bot_mode ?? "paused"}`;
  }

  if (input.clinic.subscription_status !== "active") {
    return "subscription_not_active";
  }

  if (input.clinic.payment_status !== "received") {
    return "payment_pending";
  }

  if (!input.clinic.evolution_instance_name) {
    return "whatsapp_instance_missing";
  }

  return null;
}

async function ensureMessageCapacity(input: {
  admin: SupabaseAdminClient;
  clinic: ChatbotClinicContext;
  contactId: string;
}) {
  const usage = await getClinicUsageSummary(input.admin, {
    id: input.clinic.id,
    plan_type: input.clinic.plan_type ?? "starter",
    payment_received_at: input.clinic.payment_received_at ?? null,
    billing_cycle_anchor: input.clinic.billing_cycle_anchor ?? null,
    created_at: input.clinic.created_at ?? null,
    contact_limit_override: input.clinic.contact_limit_override ?? null,
    monthly_message_limit_override:
      input.clinic.monthly_message_limit_override ?? null,
  });

  if (!usage.monthly_message_limit_reached) {
    return true;
  }

  await updateContactAiState(input.admin, {
    clinicId: input.clinic.id,
    contactId: input.contactId,
    botMode: "handoff_required",
    handoffReason: "message_limit_reached",
  });

  return false;
}

function getDetectedTreatment(input: {
  provided?: string | null;
  message: string;
}) {
  return input.provided?.trim() || detectTreatmentInterest(input.message);
}

function getTreatmentUpdate(input: {
  currentTreatment?: string | null;
  detectedTreatment?: string | null;
  aiTreatment?: string | null;
}) {
  const candidate = input.aiTreatment?.trim() || input.detectedTreatment;
  return shouldUpdateTreatmentInterest(input.currentTreatment, candidate)
    ? candidate
    : null;
}

async function sendAndStoreBotReply(input: {
  admin: SupabaseAdminClient;
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
  conversationId: string | null;
  reply: string;
  confidence?: number | null;
}) {
  const sendResult = await sendWhatsappMessage({
    clinic: {
      id: input.clinic.id,
      name: input.clinic.name ?? "Clinic",
      evolution_instance_name: input.clinic.evolution_instance_name ?? null,
      evolution_api_url: input.clinic.evolution_api_url ?? null,
      evolution_api_key: input.clinic.evolution_api_key ?? null,
      whatsapp_status: "connected",
    },
    contactId: input.contact.id,
    phone: input.contact.phone_e164 ?? "",
    message: input.reply,
    senderType: "bot",
  });

  if (!sendResult.success) {
    return {
      success: false as const,
      error: sendResult.error ?? "bot_send_failed",
    };
  }

  await insertMessageRecord(input.admin, {
    clinic_id: input.clinic.id,
    contact_id: input.contact.id,
    conversation_id: input.conversationId,
    provider_message_id:
      "providerMessageId" in sendResult ? sendResult.providerMessageId : null,
    direction: "outbound",
    sender_type: "bot",
    content: input.reply,
    ai_generated: true,
    ai_confidence: input.confidence,
  });

  return {
    success: true as const,
    sentAt: new Date().toISOString(),
  };
}

export async function handleInboundWhatsappChatbot(input: WhatsappChatbotInput) {
  const contact = await loadContact(input.admin, input.clinic.id, input.contactId);

  if (!contact) {
    return { action: "ignore" as const, skipped: true, reason: "contact_not_found" };
  }

  const detectedTreatment = getDetectedTreatment({
    provided: input.detectedTreatment,
    message: input.inboundMessage,
  });
  const heuristicIntent = inferLeadIntent(input.inboundMessage, detectedTreatment);
  const handoffTrigger = detectHandoffTrigger(input.inboundMessage);

  const skipReason = getSkipReason({
    clinic: input.clinic,
    contact,
  });

  if (skipReason) {
    return { action: "ignore" as const, skipped: true, reason: skipReason };
  }

  const hasCapacity = await ensureMessageCapacity({
    admin: input.admin,
    clinic: input.clinic,
    contactId: contact.id,
  });

  if (!hasCapacity) {
    return {
      action: "handoff" as const,
      sent: false,
      reason: "message_limit_reached",
    };
  }

  const conversationId =
    input.conversationId ??
    (await ensureConversationForContact(input.admin, input.clinic.id, contact.id));

  const heuristicTreatmentUpdate = getTreatmentUpdate({
    currentTreatment: contact.treatment_interest,
    detectedTreatment,
  });

  if (handoffTrigger) {
    const handoffReply = DEFAULT_HANDOFF_REPLY;
    const sendResult = await sendAndStoreBotReply({
      admin: input.admin,
      clinic: input.clinic,
      contact,
      conversationId,
      reply: handoffReply,
      confidence: 1,
    });

    await updateContactAiState(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      intent: "handoff_requested",
      confidence: 1,
      botMode: "handoff_required",
      handoffReason: handoffTrigger,
      treatmentInterest: heuristicTreatmentUpdate,
      lastOutboundAt: sendResult.success ? sendResult.sentAt : null,
    });

    return {
      action: "handoff" as const,
      sent: sendResult.success,
      intent: "handoff_requested",
      confidence: 1,
      reason: handoffTrigger,
    };
  }

  if (!hasWhatsappChatbotConfig()) {
    if (heuristicTreatmentUpdate || heuristicIntent !== "general_inquiry") {
      await updateContactAiState(input.admin, {
        clinicId: input.clinic.id,
        contactId: contact.id,
        intent: heuristicIntent,
        confidence: heuristicIntent === "general_inquiry" ? null : 0.75,
        treatmentInterest: heuristicTreatmentUpdate,
      });
    }

    return {
      action: "ignore" as const,
      skipped: true,
      reason: "chatbot_not_configured",
    };
  }

  const recentMessages = await listMessagesForContact(input.admin, {
    clinicId: input.clinic.id,
    contactId: contact.id,
    order: "desc",
    limit: 14,
  });
  const decision = await generateChatbotDecision({
    clinic: input.clinic,
    contact,
    inboundMessage: input.inboundMessage,
    recentMessages: [...recentMessages].reverse(),
  });

  if (!decision) {
    return {
      action: "ignore" as const,
      skipped: true,
      reason: "chatbot_not_configured",
    };
  }

  const treatmentUpdate = getTreatmentUpdate({
    currentTreatment: contact.treatment_interest,
    detectedTreatment,
    aiTreatment: decision.treatment_interest,
  });
  const nextStatus = inferNextPipelineStatus({
    currentStatus: contact.current_status,
    inboundMessage: input.inboundMessage,
    aiIntent: decision.intent,
    aiPipelineStatus: decision.pipeline_status,
  });

  if (decision.action === "handoff") {
    const handoffReply = decision.reply?.trim() || DEFAULT_HANDOFF_REPLY;
    const sendResult = await sendAndStoreBotReply({
      admin: input.admin,
      clinic: input.clinic,
      contact,
      conversationId,
      reply: handoffReply,
      confidence: decision.confidence,
    });

    await updateContactAiState(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      intent: decision.intent,
      confidence: decision.confidence,
      botMode: "handoff_required",
      handoffReason: decision.handoff_reason ?? "ai_requested_handoff",
      treatmentInterest: treatmentUpdate,
      currentStatus: nextStatus,
      lastOutboundAt: sendResult.success ? sendResult.sentAt : null,
    });

    return {
      action: decision.action,
      sent: sendResult.success,
      intent: decision.intent,
      confidence: decision.confidence,
    };
  }

  if (decision.action === "ignore") {
    await updateContactAiState(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      intent: decision.intent,
      confidence: decision.confidence,
      handoffReason: null,
      treatmentInterest: treatmentUpdate,
      currentStatus: nextStatus,
    });

    return {
      action: decision.action,
      sent: false,
      intent: decision.intent,
      confidence: decision.confidence,
    };
  }

  const reply = decision.reply?.trim();
  if (!reply) {
    await updateContactAiState(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      intent: decision.intent,
      confidence: decision.confidence,
      botMode: "handoff_required",
      handoffReason: "ai_empty_reply",
      treatmentInterest: treatmentUpdate,
      currentStatus: nextStatus,
    });

    return { action: "handoff" as const, sent: false, reason: "ai_empty_reply" };
  }

  const sendResult = await sendAndStoreBotReply({
    admin: input.admin,
    clinic: input.clinic,
    contact,
    conversationId,
    reply,
    confidence: decision.confidence,
  });

  if (!sendResult.success) {
    await updateContactAiState(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      intent: decision.intent,
      confidence: decision.confidence,
      botMode: "handoff_required",
      handoffReason: sendResult.error ?? "bot_send_failed",
      treatmentInterest: treatmentUpdate,
      currentStatus: nextStatus,
    });

    return {
      action: "handoff" as const,
      sent: false,
      reason: sendResult.error ?? "bot_send_failed",
    };
  }

  await updateContactAiState(input.admin, {
    clinicId: input.clinic.id,
    contactId: contact.id,
    intent: decision.intent,
    confidence: decision.confidence,
    handoffReason: null,
    lastOutboundAt: sendResult.sentAt,
    treatmentInterest: treatmentUpdate,
    currentStatus: nextStatus,
  });

  try {
    await enqueueContactMemoryJob(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      triggerSource: "message_outbound_bot",
    });
  } catch (error) {
    if (!isContactMemorySchemaMismatchError(error)) {
      throw error;
    }
  }

  const effectiveStatus = nextStatus ?? contact.current_status;
  if (isClosingPipelineStatus(effectiveStatus)) {
    try {
      await cancelPendingAutomationJobs(
        input.admin,
        input.clinic.id,
        contact.id,
        `status_changed_to_${effectiveStatus}`
      );
    } catch (error) {
      if (!isAutomationSchemaMismatchError(error)) {
        throw error;
      }
    }
  } else if (contact.automation_enabled !== false) {
    try {
      await scheduleFollowUpJobs(input.admin, input.clinic.id, contact.id, new Date());
    } catch (error) {
      if (!isAutomationSchemaMismatchError(error)) {
        throw error;
      }
    }
  }

  return {
    action: "reply" as const,
    sent: true,
    intent: decision.intent,
    confidence: decision.confidence,
  };
}
