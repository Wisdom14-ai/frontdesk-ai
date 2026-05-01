import "server-only";

import { z } from "zod";

import { logAiUsage } from "@/lib/ai-usage-logger";
import { normalizeContactLeadMemory } from "@/lib/contact-memory";
import type {
  ContactLeadMemory,
  ContactMemoryTriggerSource,
  Message,
} from "@/types";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const CONTACT_MEMORY_TIMEOUT_MS = 30_000;
const CONTACT_MEMORY_OPERATION_TYPE = "lead_memory_generation";

export const CONTACT_MEMORY_MAX_ATTEMPTS = 3;
export const CONTACT_MEMORY_RETRY_DELAY_MS = 5 * 60 * 1000;

const contactLeadMemoryResponseSchema = z
  .object({
    lead_summary: z.string().optional(),
    conversation_summary: z.string().optional(),
    lead_quality: z.enum(["unknown", "cold", "warm", "hot"]).optional(),
    lead_quality_reason: z.string().optional(),
    last_outcome: z.string().optional(),
    next_action: z.string().optional(),
    objections: z.string().optional(),
  })
  .strip();

const CONTACT_MEMORY_JSON_SCHEMA = {
  type: "object",
  properties: {
    lead_summary: { type: "string" },
    conversation_summary: { type: "string" },
    lead_quality: {
      type: "string",
      enum: ["unknown", "cold", "warm", "hot"],
    },
    lead_quality_reason: { type: "string" },
    last_outcome: { type: "string" },
    next_action: { type: "string" },
    objections: { type: "string" },
  },
  required: [
    "lead_summary",
    "conversation_summary",
    "lead_quality",
    "lead_quality_reason",
    "last_outcome",
    "next_action",
    "objections",
  ],
  additionalProperties: false,
} as const;

interface ContactMemoryGenerationClinicInput {
  id: string;
  name: string;
  clinic_prompt?: string | null;
}

interface ContactMemoryGenerationContactInput {
  id: string;
  full_name: string;
  phone_e164: string;
  treatment_interest?: string | null;
  current_status: string;
  source?: string | null;
  campaign_name?: string | null;
  bot_mode?: string | null;
  automation_enabled: boolean;
  next_follow_up_at?: string | null;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  attendance_status?: string | null;
  lead_memory: ContactLeadMemory;
  staff_note?: string | null;
}

export interface ContactMemoryGenerationInput {
  clinic: ContactMemoryGenerationClinicInput;
  contact: ContactMemoryGenerationContactInput;
  messages: Array<
    Pick<Message, "direction" | "sender_type" | "content" | "created_at">
  >;
  triggerSource: ContactMemoryTriggerSource;
}

class ContactMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ContactMemoryConfigError extends ContactMemoryError {}
export class ContactMemoryValidationError extends ContactMemoryError {}
export class ContactMemoryTransientError extends ContactMemoryError {}

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

function getContactMemoryAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = process.env.LEAD_MEMORY_MODEL?.trim() ?? "";

  if (!apiKey && !model) {
    throw new ContactMemoryConfigError(
      "Set OPENAI_API_KEY and LEAD_MEMORY_MODEL to generate lead memory."
    );
  }

  if (!apiKey) {
    throw new ContactMemoryConfigError(
      "Set OPENAI_API_KEY to generate lead memory."
    );
  }

  if (!model) {
    throw new ContactMemoryConfigError(
      "Set LEAD_MEMORY_MODEL to generate lead memory."
    );
  }

  return { apiKey, model };
}

export function hasContactMemoryAiConfig() {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() && process.env.LEAD_MEMORY_MODEL?.trim()
  );
}

export function getContactMemoryAiConfigError() {
  try {
    getContactMemoryAiConfig();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Lead memory AI is not configured.";
  }
}

export function isContactMemoryTransientError(error: unknown) {
  return error instanceof ContactMemoryTransientError;
}

function normalizeValidatedLeadMemory(payload: unknown): ContactLeadMemory {
  const parsed = contactLeadMemoryResponseSchema.parse(payload);
  return normalizeContactLeadMemory(parsed);
}

function buildSystemPrompt() {
  return [
    "You summarize clinic CRM conversations into structured lead memory.",
    "Use only the information provided in the input.",
    "Keep each field concise and operational for front-desk staff.",
    "Do not invent facts, diagnoses, or medical advice.",
    "If a field is unknown, omit it or leave it empty rather than guessing.",
    "Set lead_quality to unknown unless the conversation clearly supports cold, warm, or hot.",
  ].join("\n");
}

function buildUserPayload(input: ContactMemoryGenerationInput) {
  return {
    clinic: input.clinic,
    contact: input.contact,
    messages: input.messages,
    trigger_source: input.triggerSource,
  };
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

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function callOpenAiResponses(
  input: ContactMemoryGenerationInput
): Promise<OpenAiResponsesPayload> {
  const { apiKey, model } = getContactMemoryAiConfig();
  const requestBody = {
    model,
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
        name: "contact_lead_memory",
        strict: true,
        schema: CONTACT_MEMORY_JSON_SCHEMA,
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: AbortSignal.timeout(CONTACT_MEMORY_TIMEOUT_MS),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `OpenAI request failed. ${error.message}`
        : "OpenAI request failed.";

    await logAiUsage({
      clinicId: input.clinic.id,
      contactId: input.contact.id,
      operationType: CONTACT_MEMORY_OPERATION_TYPE,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage: message,
    });

    throw new ContactMemoryTransientError(message);
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
      operationType: CONTACT_MEMORY_OPERATION_TYPE,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "error",
      errorMessage: message,
      requestId,
    });

    if (response.status === 401 || response.status === 403) {
      throw new ContactMemoryConfigError(message);
    }

    if (isRetryableStatus(response.status)) {
      throw new ContactMemoryTransientError(message);
    }

    throw new ContactMemoryValidationError(message);
  }

  if (!payload) {
    const message = "OpenAI returned an empty lead memory response.";

    await logAiUsage({
      clinicId: input.clinic.id,
      contactId: input.contact.id,
      operationType: CONTACT_MEMORY_OPERATION_TYPE,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "error",
      errorMessage: message,
      requestId,
    });

    throw new ContactMemoryTransientError(message);
  }

  const { inputTokens, outputTokens } = getOpenAiUsage(payload);
  await logAiUsage({
    clinicId: input.clinic.id,
    contactId: input.contact.id,
    operationType: CONTACT_MEMORY_OPERATION_TYPE,
    model,
    inputTokens,
    outputTokens,
    latencyMs,
    requestId,
  });

  return payload;
}

export async function generateContactLeadMemory(
  input: ContactMemoryGenerationInput
): Promise<ContactLeadMemory> {
  const payload = await callOpenAiResponses(input);
  const outputText = getResponseText(payload);

  if (!outputText) {
    throw new ContactMemoryValidationError(
      "OpenAI did not return structured lead memory content."
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new ContactMemoryValidationError(
      error instanceof Error
        ? `OpenAI returned invalid JSON. ${error.message}`
        : "OpenAI returned invalid JSON."
    );
  }

  return normalizeValidatedLeadMemory(parsed);
}
