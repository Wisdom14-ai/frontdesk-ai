import "server-only";

import { z } from "zod";

import { logAiUsage } from "@/lib/ai-usage-logger";
import { mergeContactLeadMemory } from "@/lib/contact-memory";
import {
  cancelPendingAutomationJobs,
  isAutomationSchemaMismatchError,
  scheduleFollowUpJobs,
} from "@/lib/server/automation";
import { enforceCapBeforeAiCall } from "@/lib/server/ai-cap";
import {
  recordBotSkip,
  type BotSkipReason,
} from "@/lib/server/bot-skip-observability";
import { getClinicUsageSummary } from "@/lib/server/clinic";
import {
  isComplianceSchemaMismatchError,
  markContactMarketingOptOut,
} from "@/lib/server/compliance";
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
const MAX_FOLLOW_UP_LENGTH = 600;
const MAX_AI_LATEST_MESSAGE_LENGTH = 4000;
const MAX_AI_RECENT_MESSAGE_LENGTH = 1500;
const MAX_REPLY_OUTPUT_TOKENS = 600;
const MAX_FOLLOW_UP_OUTPUT_TOKENS = 300;
const MIN_REPLY_CONFIDENCE = 0.5;
const INBOUND_DEBOUNCE_MS = 6_000;
const INBOUND_REPLY_OPERATION_TYPE = "inbound_reply";
const FOLLOW_UP_OPERATION_TYPE = "followup_message";
const DEFAULT_HANDOFF_REPLY =
  "Okay, saya connectkan awak dengan team kami sekarang.";

/**
 * Thrown for failures that are likely temporary (network errors, timeouts,
 * OpenAI 429/5xx). Callers must NOT permanently disable the bot for these.
 */
export class ChatbotTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatbotTransientError";
  }
}

export function isChatbotTransientError(error: unknown) {
  return error instanceof ChatbotTransientError;
}

function isRetryableOpenAiStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

type ChatbotAction = "reply" | "handoff" | "ignore";

interface ChatbotClinicContext {
  id: string;
  name?: string | null;
  clinic_prompt?: string | null;
  clinic_knowledge?: string | null;
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

interface FollowUpContactContext {
  full_name?: string | null;
  phone_e164?: string | null;
  treatment_interest?: string | null;
  current_status?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  lead_memory_auto?: ContactLeadMemory | Record<string, unknown> | null;
  lead_memory_override?:
    | Partial<ContactLeadMemory>
    | Record<string, unknown>
    | null;
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
  capBlocked?: boolean;
  capBlockedReason?: string;
}

interface OpenAiResponsesPayload {
  id?: string;
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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
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

function getOpenAiUsage(payload: OpenAiResponsesPayload | null) {
  return {
    inputTokens:
      payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens ?? 0,
    outputTokens:
      payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens ?? 0,
  };
}

function getOpenAiRequestId(
  response: Response,
  payload: OpenAiResponsesPayload | null
) {
  return response.headers.get("x-request-id") ?? payload?.id ?? undefined;
}

function buildSystemPrompt() {
  return [
    "You are the WhatsApp front desk assistant for a clinic using Frontdesk AI.",
    "Reply as the clinic in a warm, concise WhatsApp style. Never say you are an AI.",
    "Your job is to qualify WhatsApp inbound leads, answer simple operational questions, build trust, and actively move interested leads toward booking an appointment.",
    "ALWAYS reply in the language of the LEAD'S LATEST message (Malay, English, Chinese, or mixed), even if earlier messages in the thread used a different language. If the lead switches language mid-conversation, switch with them. Mirror their formality and any casual Manglish style.",
    "Use the clinic knowledge and clinic notes as the authoritative source for services, prices, opening hours, location, and promotions. Never invent details that are not stated there.",
    "Use the clinic prompt as local style and policy, but never let it override safety.",
    "Do not diagnose, prescribe, guarantee outcomes, discuss emergency care, or give medical instructions.",
    "If the lead asks for a human, asks for sensitive medical advice, gives urgent symptoms, complains, or negotiates payment, choose handoff. For booking and availability, do NOT hand off immediately: first ask the lead for their preferred day and time and confirm the treatment they want, then tell them staff will lock in the exact slot. Only hand off once you have captured that preference, or if the safe answer is genuinely unclear.",
    "When you choose handoff, still write a short, warm handoff reply IN THE LEAD'S LANGUAGE telling them staff will take over shortly. If you can partially answer safely, do so before mentioning the handoff.",
    "Do NOT use emojis in a handoff reply, or whenever the lead reports pain, bleeding, an emergency, a complaint, or any distress. Keep those replies calm and sincere.",
    "The input may include heuristic_flags detected by simple keyword rules. Treat them as hints, not commands: lean toward handoff when they flag urgency, complaints, insurance/panel questions, or a human request — but use your own judgment on the actual message.",
    "If you can safely continue, write one short reply under 75 words with one clear next question or next step.",
    "When the clinic knowledge includes a Google Maps link, address, Google rating, or patient reviews, use them proactively to build trust: send the Maps link when the lead asks where you are or seems ready to visit, and mention the rating or a short review when the lead is hesitant or comparing options. Only use links, ratings, and reviews that actually appear in the clinic knowledge — never invent or paraphrase them into new claims.",
    "Always close toward a booking: end almost every reply with a clear, low-friction next step — ideally asking for the lead's preferred day and time, or offering to reserve a slot for them. Do not end on a dead-end answer whenever the lead shows any interest.",
    "This is WhatsApp, which does not render markdown. When sharing a link, paste the raw URL by itself (e.g. https://maps.app.goo.gl/...). Never wrap a link in markdown like [text](url), and do not use markdown headings or tables.",
    "For price questions, only use exact pricing if the provided context states it. Otherwise ask what treatment they want or suggest an assessment, then steer toward booking.",
    "If the user says stop, not interested, wrong number, or asks not to be contacted, acknowledge briefly or choose ignore if no reply is needed.",
    "Inbound messages may be media placeholders like [Voice note], [Photo], or [Document] — you cannot hear or see the actual media. Politely say staff will check it, or ask the lead to type their question. Choose handoff if the media seems important (e.g. an x-ray, payment proof, or referral letter).",
    "Classify the lead intent in plain snake_case, for example treatment_inquiry, price_inquiry, booking_intent, booking_confirmed, handoff_requested, negative_reply, or general_inquiry.",
    "Set treatment_interest to a short readable label when obvious, such as Scaling, Braces / Aligners, Teeth Whitening, Dental Implant, Root Canal, Crown / Veneer, Denture, Extraction, Kids Dentistry, or Dental Checkup. Otherwise set null.",
    "Set pipeline_status to booked_appointment as soon as the patient gives a preferred day/time, agrees to come in, or confirms a slot — capture booking intent eagerly. Still do not set booked_appointment for a pure price inquiry with no intent to come.",
    "Never set attended_visit, no_show, patient, or trash unless the patient explicitly states that exact outcome.",
    "Set confidence to how sure you are that your reply is correct, safe, and on-policy (1 = fully sure).",
    "Return only the structured JSON decision.",
  ].join("\n");
}

function mapMessageForPrompt(message: Pick<Message, "direction" | "sender_type" | "content" | "created_at">) {
  return {
    direction: message.direction,
    sender_type: message.sender_type,
    content: truncateForAi(message.content, MAX_AI_RECENT_MESSAGE_LENGTH),
    created_at: message.created_at,
  };
}

function truncateForAi(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n[truncated]`;
}

function formatTranscriptLine(
  message: Pick<Message, "direction" | "sender_type" | "content" | "created_at">
) {
  const speaker =
    message.direction === "inbound"
      ? "Lead"
      : message.sender_type === "human"
        ? "Clinic (staff)"
        : "Clinic (bot)";
  const timestamp = message.created_at ? ` [${message.created_at}]` : "";
  const content = truncateForAi(message.content, MAX_AI_RECENT_MESSAGE_LENGTH);

  return `${speaker}${timestamp}: ${content}`;
}

interface ChatbotHeuristicHints {
  handoffTrigger?: string | null;
  detectedTreatment?: string | null;
  heuristicIntent?: string | null;
}

function buildUserMessage(input: {
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
  inboundMessage: string;
  recentMessages: Message[];
  heuristics?: ChatbotHeuristicHints;
}) {
  const leadMemory = mergeContactLeadMemory(
    input.contact.lead_memory_auto,
    input.contact.lead_memory_override
  );

  const transcript = input.recentMessages.length
    ? input.recentMessages.map(formatTranscriptLine).join("\n")
    : "(no previous messages)";

  const heuristicFlags = [
    input.heuristics?.handoffTrigger
      ? `possible_handoff: ${input.heuristics.handoffTrigger}`
      : null,
    input.heuristics?.detectedTreatment
      ? `keyword_treatment: ${input.heuristics.detectedTreatment}`
      : null,
    input.heuristics?.heuristicIntent
      ? `keyword_intent: ${input.heuristics.heuristicIntent}`
      : null,
  ].filter(Boolean);

  const sections = [
    "## Clinic",
    `Name: ${input.clinic.name ?? "Clinic"}`,
    input.clinic.clinic_knowledge?.trim()
      ? `Clinic knowledge (authoritative — services, prices, hours, location, FAQs):\n${input.clinic.clinic_knowledge.trim()}`
      : "Clinic knowledge: (none provided — do not state specific prices, hours, or addresses)",
    input.clinic.clinic_prompt?.trim()
      ? `Clinic style & policy notes:\n${input.clinic.clinic_prompt.trim()}`
      : null,
    "",
    "## Lead",
    `Name on file: ${input.contact.full_name ?? "(unknown)"}`,
    `Phone: ${input.contact.phone_e164 ?? "(unknown)"}`,
    `Treatment interest: ${input.contact.treatment_interest ?? "(unknown)"}`,
    `Pipeline status: ${input.contact.current_status ?? "(unknown)"}`,
    `Source: ${input.contact.source ?? "(unknown)"}${
      input.contact.campaign_name ? ` / campaign: ${input.contact.campaign_name}` : ""
    }`,
    input.contact.staff_note?.trim()
      ? `Staff note (internal): ${input.contact.staff_note.trim()}`
      : null,
    Object.keys(leadMemory).length
      ? `Lead memory (internal summary): ${JSON.stringify(leadMemory)}`
      : null,
    "",
    "## Conversation transcript (oldest first)",
    transcript,
    "",
    "## Latest inbound message (decide and reply to this)",
    truncateForAi(input.inboundMessage, MAX_AI_LATEST_MESSAGE_LENGTH),
  ];

  if (heuristicFlags.length) {
    sections.push("", "## heuristic_flags (hints only)", heuristicFlags.join("\n"));
  }

  return sections.filter((section) => section !== null).join("\n");
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

async function requestChatbotDecisionOnce(input: {
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
  inboundMessage: string;
  recentMessages: Message[];
  heuristics?: ChatbotHeuristicHints;
  config: { apiKey: string; model: string };
}) {
  const { config } = input;
  const requestBody = {
    model: config.model,
    store: false,
    max_output_tokens: MAX_REPLY_OUTPUT_TOKENS,
    input: [
      {
        role: "developer",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: buildUserMessage(input),
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
  const startedAt = Date.now();

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
    const message =
      error instanceof Error
        ? `OpenAI chatbot request failed. ${error.message}`
        : "OpenAI chatbot request failed.";

    await logAiUsage({
      clinicId: input.clinic.id,
      contactId: input.contact.id,
      operationType: INBOUND_REPLY_OPERATION_TYPE,
      model: config.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage: message,
    });

    throw new ChatbotTransientError(message);
  }

  const latencyMs = Date.now() - startedAt;
  const payload = (await response.json().catch(() => null)) as
    | OpenAiResponsesPayload
    | null;
  const requestId = getOpenAiRequestId(response, payload);

  if (!response.ok) {
    const message = getOpenAiErrorMessage(payload, response.status);

    await logAiUsage({
      clinicId: input.clinic.id,
      contactId: input.contact.id,
      operationType: INBOUND_REPLY_OPERATION_TYPE,
      model: config.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "error",
      errorMessage: message,
      requestId,
    });

    if (isRetryableOpenAiStatus(response.status)) {
      throw new ChatbotTransientError(message);
    }

    throw new Error(message);
  }

  if (!payload) {
    const message = "OpenAI returned an empty chatbot response.";

    await logAiUsage({
      clinicId: input.clinic.id,
      contactId: input.contact.id,
      operationType: INBOUND_REPLY_OPERATION_TYPE,
      model: config.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "error",
      errorMessage: message,
      requestId,
    });

    throw new ChatbotTransientError(message);
  }

  const { inputTokens, outputTokens } = getOpenAiUsage(payload);
  await logAiUsage({
    clinicId: input.clinic.id,
    contactId: input.contact.id,
    operationType: INBOUND_REPLY_OPERATION_TYPE,
    model: config.model,
    inputTokens,
    outputTokens,
    latencyMs,
    requestId,
  });

  const outputText = getResponseText(payload);
  if (!outputText) {
    throw new ChatbotTransientError("OpenAI did not return a chatbot decision.");
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

async function generateChatbotDecision(input: {
  clinic: ChatbotClinicContext;
  contact: ChatbotContactContext;
  inboundMessage: string;
  recentMessages: Message[];
  heuristics?: ChatbotHeuristicHints;
}) {
  const config = getWhatsappChatbotConfig();

  if (!config) {
    return null;
  }

  const capCheck = await enforceCapBeforeAiCall({
    clinicId: input.clinic.id,
    contactId: input.contact.id,
    operationType: INBOUND_REPLY_OPERATION_TYPE,
    model: config.model,
  });

  if (!capCheck.allowed) {
    return {
      action: "handoff",
      reply: null,
      intent: "ai_cap_blocked",
      confidence: null,
      handoff_reason: capCheck.reason,
      treatment_interest: null,
      pipeline_status: null,
      capBlocked: true,
      capBlockedReason: capCheck.reason,
    };
  }

  try {
    return await requestChatbotDecisionOnce({ ...input, config });
  } catch (error) {
    if (!isChatbotTransientError(error)) {
      throw error;
    }

    // One retry for transient failures (network, 429, 5xx) before giving up.
    return requestChatbotDecisionOnce({ ...input, config });
  }
}

function buildFollowUpSystemPrompt() {
  return [
    "You are writing ONE WhatsApp follow-up message on behalf of the same sender who has been messaging in the conversation below.",
    "The recipient has NOT replied to the previous message(s). Your job is a short, natural nudge to re-engage them.",
    "Read the transcript carefully and CONTINUE that same conversation. Do not restart it, change the topic, change the offer, or change the persona.",
    "Use the lead memory, staff note, current status, treatment interest, and next action as supporting context only. Never mention those internal fields directly.",
    "Conversion playbook: for price inquiry, gently offer to clarify treatment/details; for booking intent, ask for or confirm the next scheduling detail; for objection, address only that objection lightly; for no reply, make one low-pressure nudge; for no-show or post-visit, use care/reschedule language; for B2B outreach, continue the decision-maker handoff angle.",
    "Use follow_up_angle and next_action when present, but keep the message natural and short.",
    "Match the language of the transcript exactly (e.g. English, Malay, Chinese). If earlier messages were bilingual, mirror that.",
    "Address the recipient the same way they were addressed earlier in the thread — use the business or person name actually used in the transcript. NEVER address the recipient by the sender's own name or company.",
    "Refer to the sender (person and company) exactly as already established earlier in the thread. Keep the sender identity 100% consistent with earlier messages — do not invent or change names.",
    "Keep the same intent and direction as the original outreach. If the thread is a B2B pitch (e.g. asking to be passed to the owner/decision-maker), continue that. Do NOT switch to a generic 'help you book an appointment' script unless the thread was genuinely about booking an appointment.",
    "The structured name fields in the user payload may be unreliable or swapped — when they conflict with the transcript, ALWAYS trust the transcript.",
    "When the lead previously showed booking interest, make your nudge ask for a concrete preferred day/time to move them toward a booking. If the clinic style guide or earlier messages already referenced the clinic's Google rating, reviews, or location, you may lightly reuse that as reassurance — never invent new ratings, reviews, or links.",
    "Be brief (under 55 words), polite, and low-pressure in tone even while asking for the next step. No spammy urgency, no new emojis unless the thread already used them.",
    "Output ONLY the message text to send. No quotes, no labels, no explanation.",
  ].join("\n");
}

function buildFollowUpUserPayload(input: {
  clinic: { name?: string | null; clinic_prompt?: string | null };
  contact: FollowUpContactContext;
  followUpStage: string;
  recentMessages: Message[];
}) {
  const leadMemory = mergeContactLeadMemory(
    input.contact.lead_memory_auto,
    input.contact.lead_memory_override
  );

  return {
    note: "Name fields below are weak hints only and may be swapped. The transcript is the source of truth for who the sender and recipient are.",
    follow_up_stage: input.followUpStage,
    weak_hints: {
      sender_org_name: input.clinic.name ?? null,
      recipient_name: input.contact.full_name ?? null,
      sender_style_guide: input.clinic.clinic_prompt ?? null,
    },
    contact_context: {
      phone_e164: input.contact.phone_e164 ?? null,
      treatment_interest: input.contact.treatment_interest ?? null,
      current_status: input.contact.current_status ?? null,
      source: input.contact.source ?? null,
      campaign_name: input.contact.campaign_name ?? null,
      lead_memory: leadMemory,
      staff_note: input.contact.staff_note ?? null,
    },
    transcript_oldest_first: input.recentMessages.map(mapMessageForPrompt),
  };
}

function normalizeFollowUpGuardText(value?: string | null) {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

const FOLLOW_UP_GREETING_KEYS = [
  "assalamualaikum",
  "salam",
  "hello",
  "dear",
  "hey",
  "hai",
  "hi",
];

function startsWithSelfNameGreeting(input: {
  message: string;
  selfNames: Array<string | null | undefined>;
}) {
  const prefixKey = normalizeFollowUpGuardText(input.message.slice(0, 120));

  for (const selfName of input.selfNames) {
    const selfKey = normalizeFollowUpGuardText(selfName);
    if (selfKey.length < 4) {
      continue;
    }

    for (const greetingKey of FOLLOW_UP_GREETING_KEYS) {
      if (prefixKey.startsWith(`${greetingKey}${selfKey}`)) {
        return true;
      }
    }
  }

  return false;
}

function validateGeneratedFollowUp(input: {
  message: string;
  clinicName?: string | null;
}) {
  if (
    startsWithSelfNameGreeting({
      message: input.message,
      selfNames: [input.clinicName],
    })
  ) {
    return null;
  }

  return input.message;
}

/**
 * Generate a context-aware follow-up message by reading the conversation
 * transcript. Returns null when AI is unconfigured, capped, errored, or
 * produced nothing usable — callers should fall back to a static template.
 */
export async function generateContextualFollowUp(input: {
  clinicId: string;
  clinicName?: string | null;
  clinicPrompt?: string | null;
  contactId: string;
  contactName?: string | null;
  contact?: FollowUpContactContext;
  followUpStage: string;
  recentMessages: Message[];
}): Promise<string | null> {
  const config = getWhatsappChatbotConfig();
  if (!config) {
    return null;
  }

  // No transcript means nothing to anchor names/direction to — let the
  // caller use the deterministic template instead of guessing.
  if (input.recentMessages.length === 0) {
    return null;
  }

  const capCheck = await enforceCapBeforeAiCall({
    clinicId: input.clinicId,
    contactId: input.contactId,
    operationType: FOLLOW_UP_OPERATION_TYPE,
    model: config.model,
  });

  if (!capCheck.allowed) {
    return null;
  }

  const requestBody = {
    model: config.model,
    store: false,
    max_output_tokens: MAX_FOLLOW_UP_OUTPUT_TOKENS,
    input: [
      {
        role: "developer",
        content: buildFollowUpSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify(
          buildFollowUpUserPayload({
            clinic: {
              name: input.clinicName,
              clinic_prompt: input.clinicPrompt,
            },
            contact: input.contact ?? { full_name: input.contactName },
            followUpStage: input.followUpStage,
            recentMessages: input.recentMessages,
          })
        ),
      },
    ],
  };

  const startedAt = Date.now();
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
    await logAiUsage({
      clinicId: input.clinicId,
      contactId: input.contactId,
      operationType: FOLLOW_UP_OPERATION_TYPE,
      model: config.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage:
        error instanceof Error
          ? `OpenAI follow-up request failed. ${error.message}`
          : "OpenAI follow-up request failed.",
    });
    return null;
  }

  const latencyMs = Date.now() - startedAt;
  const payload = (await response.json().catch(() => null)) as
    | OpenAiResponsesPayload
    | null;
  const requestId = getOpenAiRequestId(response, payload);

  if (!response.ok) {
    await logAiUsage({
      clinicId: input.clinicId,
      contactId: input.contactId,
      operationType: FOLLOW_UP_OPERATION_TYPE,
      model: config.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "error",
      errorMessage: getOpenAiErrorMessage(payload, response.status),
      requestId,
    });
    return null;
  }

  const { inputTokens, outputTokens } = getOpenAiUsage(payload);
  await logAiUsage({
    clinicId: input.clinicId,
    contactId: input.contactId,
    operationType: FOLLOW_UP_OPERATION_TYPE,
    model: config.model,
    inputTokens,
    outputTokens,
    latencyMs,
    requestId,
  });

  const text = payload ? getResponseText(payload) : "";
  if (!text) {
    return null;
  }

  const message = text
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .slice(0, MAX_FOLLOW_UP_LENGTH)
    .trim();

  if (!message) {
    return null;
  }

  return validateGeneratedFollowUp({
    message,
    clinicName: input.clinicName,
  });
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

async function applyNegativeReplyOptOut(
  admin: SupabaseAdminClient,
  clinic: ChatbotClinicContext,
  contact: ChatbotContactContext
) {
  try {
    await markContactMarketingOptOut(admin, {
      clinicId: clinic.id,
      contactId: contact.id,
      reason: "not_interested",
      source: "whatsapp_inbound",
      currentStatus: contact.current_status ?? null,
    });
  } catch (error) {
    if (!isComplianceSchemaMismatchError(error)) {
      throw error;
    }
  }
  try {
    await cancelPendingAutomationJobs(admin, clinic.id, contact.id, "negative_reply");
  } catch (error) {
    if (!isAutomationSchemaMismatchError(error)) {
      throw error;
    }
  }
}

// Skip reasons that reflect a clinic-wide misconfiguration (worth surfacing to
// the admin + clinic), as opposed to per-contact bot_mode states.
const CLINIC_LEVEL_SKIP_REASONS = new Set<string>([
  "subscription_not_active",
  "payment_pending",
  "whatsapp_instance_missing",
]);

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

async function hasNewerInboundMessage(input: {
  admin: SupabaseAdminClient;
  clinicId: string;
  contactId: string;
  sinceIso: string;
}) {
  const { data, error } = await input.admin
    .from("messages")
    .select("id")
    .eq("clinic_id", input.clinicId)
    .eq("contact_id", input.contactId)
    .eq("direction", "inbound")
    .gt("created_at", input.sinceIso)
    .limit(1);

  if (error) {
    // If the check fails, reply anyway rather than dropping the lead.
    console.warn("[whatsapp-chatbot] Debounce check failed", {
      clinicId: input.clinicId,
      contactId: input.contactId,
      message: error.message,
    });
    return false;
  }

  return Boolean(data?.length);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleInboundWhatsappChatbot(input: WhatsappChatbotInput) {
  const receivedAtIso = new Date().toISOString();
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
    // Surface clinic-level silent failures (not per-contact bot_mode states) so
    // the admin checklist and the clinic dashboard can explain the silence.
    // Best-effort + schema-tolerant: never blocks the skip.
    if (CLINIC_LEVEL_SKIP_REASONS.has(skipReason)) {
      await recordBotSkip({
        admin: input.admin,
        clinicId: input.clinic.id,
        reason: skipReason as BotSkipReason,
      });
    }
    return { action: "ignore" as const, skipped: true, reason: skipReason };
  }

  const hasCapacity = await ensureMessageCapacity({
    admin: input.admin,
    clinic: input.clinic,
    contactId: contact.id,
  });

  if (!hasCapacity) {
    await recordBotSkip({
      admin: input.admin,
      clinicId: input.clinic.id,
      reason: "message_limit_reached",
    });
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

  // When the AI is configured, keyword handoff triggers are passed to the
  // model as hints so it can write a localized, graceful handoff reply.
  // The hard bypass below only runs when no AI is available.
  if (handoffTrigger && !hasWhatsappChatbotConfig()) {
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

  // Debounce: WhatsApp leads often send several short messages in a burst.
  // Wait briefly and skip this reply if a newer inbound message has already
  // arrived — its own webhook run will answer with the full context.
  await sleep(INBOUND_DEBOUNCE_MS);
  if (
    await hasNewerInboundMessage({
      admin: input.admin,
      clinicId: input.clinic.id,
      contactId: contact.id,
      sinceIso: receivedAtIso,
    })
  ) {
    return {
      action: "ignore" as const,
      skipped: true,
      reason: "superseded_by_newer_inbound",
    };
  }

  const recentMessages = await listMessagesForContact(input.admin, {
    clinicId: input.clinic.id,
    contactId: contact.id,
    order: "desc",
    limit: 20,
  });
  const decision = await generateChatbotDecision({
    clinic: input.clinic,
    contact,
    inboundMessage: input.inboundMessage,
    recentMessages: [...recentMessages].reverse(),
    heuristics: {
      handoffTrigger,
      detectedTreatment,
      heuristicIntent: heuristicIntent !== "general_inquiry" ? heuristicIntent : null,
    },
  });

  if (!decision) {
    return {
      action: "ignore" as const,
      skipped: true,
      reason: "chatbot_not_configured",
    };
  }

  if (decision.capBlocked) {
    const reason = decision.capBlockedReason ?? "ai_cap_blocked";

    // The cap pause is clinic-wide and temporary — record the reason for
    // staff visibility but keep bot_mode active so the bot resumes for this
    // contact automatically once the cap resets.
    await updateContactAiState(input.admin, {
      clinicId: input.clinic.id,
      contactId: contact.id,
      intent: decision.intent,
      confidence: decision.confidence,
      handoffReason: reason,
      treatmentInterest: heuristicTreatmentUpdate,
    });

    return {
      action: "handoff" as const,
      sent: false,
      reason,
      capBlocked: true,
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

  // Don't send replies the model itself isn't confident about — hand off to
  // staff instead of risking a wrong or unsafe answer.
  if (
    decision.action === "reply" &&
    typeof decision.confidence === "number" &&
    decision.confidence < MIN_REPLY_CONFIDENCE
  ) {
    decision.action = "handoff";
    decision.reply = null;
    decision.handoff_reason = decision.handoff_reason ?? "low_confidence";
  }

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
    if (decision.intent === "negative_reply") {
      // Contact explicitly doesn't want to hear from us — apply full opt-out
      // so automation stops even if the pattern check in the webhook missed it.
      await applyNegativeReplyOptOut(input.admin, input.clinic, contact);
    } else {
      await updateContactAiState(input.admin, {
        clinicId: input.clinic.id,
        contactId: contact.id,
        intent: decision.intent,
        confidence: decision.confidence,
        handoffReason: null,
        treatmentInterest: treatmentUpdate,
        currentStatus: nextStatus,
      });
    }

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

  // If AI acknowledged a negative/stop reply, apply opt-out after sending so
  // the acknowledgment goes through but no further automation fires.
  if (decision.intent === "negative_reply") {
    await applyNegativeReplyOptOut(input.admin, input.clinic, contact);
    return {
      action: "reply" as const,
      sent: true,
      intent: decision.intent,
      confidence: decision.confidence,
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
