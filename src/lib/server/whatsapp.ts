import "server-only";

import QRCode from "qrcode";

import { buildOnboardingFields } from "@/lib/server/clinic";
import { normalizeWhatsappStatus } from "@/lib/plans";
import type { WhatsappConnectionState, WhatsappStatus } from "@/types";

export interface ClinicMessagingConfig {
  id: string;
  name: string;
  whatsapp_status?: WhatsappStatus | null;
  evolution_instance_name?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  webhook_secret?: string | null;
  whatsapp_number?: string | null;
  whatsapp_qr_code?: string | null;
  whatsapp_pairing_code?: string | null;
  payment_status?: string | null;
  subscription_status?: string | null;
  onboarding_completed_at?: string | null;
}

interface EvolutionPlatformConfig {
  apiUrl: string;
  apiKey: string;
}

interface EvolutionConnectionResponse {
  instance?: {
    state?: string;
  };
}

interface EvolutionInstanceRecord {
  name?: string | null;
  instanceName?: string | null;
  connectionStatus?: string | null;
  disconnectionReasonCode?: number | null;
  disconnectionObject?: string | null;
}

function isErrorWithCode(value: unknown): value is { code?: string } {
  return Boolean(value && typeof value === "object" && "code" in value);
}

function collectErrorCodes(error: unknown) {
  const codes = new Set<string>();

  if (isErrorWithCode(error) && typeof error.code === "string") {
    codes.add(error.code);
  }

  if (
    error &&
    typeof error === "object" &&
    "cause" in error &&
    (error as { cause?: unknown }).cause
  ) {
    const cause = (error as { cause?: unknown }).cause;

    if (isErrorWithCode(cause) && typeof cause.code === "string") {
      codes.add(cause.code);
    }

    if (
      cause instanceof AggregateError &&
      Array.isArray(cause.errors)
    ) {
      for (const nested of cause.errors) {
        if (isErrorWithCode(nested) && typeof nested.code === "string") {
          codes.add(nested.code);
        }
      }
    }
  }

  return [...codes];
}

function getEvolutionConnectivityErrorMessage(error: unknown) {
  const codes = collectErrorCodes(error);
  const connectivityCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ETIMEDOUT",
  ]);

  if (codes.some((code) => connectivityCodes.has(code))) {
    return "WhatsApp platform is unreachable. Start Evolution API and confirm the configured platform URL is correct.";
  }

  if (error instanceof Error && error.message.trim()) {
    return `Failed to reach the WhatsApp platform. ${error.message}`;
  }

  return "Failed to reach the WhatsApp platform.";
}

function getPlatformConfig(): EvolutionPlatformConfig | null {
  const apiUrl =
    process.env.WHATSAPP_PLATFORM_EVOLUTION_API_URL ??
    process.env.EVOLUTION_API_URL ??
    process.env.PLATFORM_EVOLUTION_API_URL;
  const apiKey =
    process.env.WHATSAPP_PLATFORM_EVOLUTION_API_KEY ??
    process.env.EVOLUTION_API_KEY ??
    process.env.PLATFORM_EVOLUTION_API_KEY;

  if (!apiUrl || !apiKey) {
    return null;
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    apiKey,
  };
}

function buildHeaders() {
  const platform = getPlatformConfig();
  if (!platform) {
    throw new Error("Platform WhatsApp config is not set.");
  }

  return {
    apikey: platform.apiKey,
    "Content-Type": "application/json",
  };
}

function extractEvolutionErrorMessage(
  payload: Record<string, unknown>,
  status: number
) {
  const nestedResponse =
    payload.response && typeof payload.response === "object"
      ? (payload.response as Record<string, unknown>)
      : null;

  if (Array.isArray(nestedResponse?.message)) {
    const invalidRecipient = nestedResponse.message.find((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      const row = entry as Record<string, unknown>;
      return row.exists === false && typeof row.number === "string";
    }) as Record<string, unknown> | undefined;

    if (invalidRecipient?.number) {
      return `WhatsApp could not find a valid account for ${invalidRecipient.number as string}. Check the contact number format.`;
    }
  }

  return (
    (payload.message as string | undefined) ||
    (payload.error as string | undefined) ||
    `WhatsApp platform returned ${status}.`
  );
}

async function callEvolution<T>(input: {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}) {
  const platform = getPlatformConfig();
  if (!platform) {
    throw new Error("Platform WhatsApp config is not set.");
  }

  let response: Response;

  try {
    response = await fetch(`${platform.apiUrl}${input.path}`, {
      method: input.method ?? "GET",
      headers: buildHeaders(),
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(getEvolutionConnectivityErrorMessage(error));
  }

  const payload = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorMessage = extractEvolutionErrorMessage(payload, response.status);
    throw new Error(errorMessage);
  }

  return payload as T;
}

function slugifyClinicName(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return normalized || "clinic";
}

export function buildWhatsappInstanceName(clinicId: string, clinicName: string) {
  return `${slugifyClinicName(clinicName)}-${clinicId.slice(0, 8)}`;
}

export function normalizePhoneNumber(input: string) {
  let digitsOnly = input.replace(/\D/g, "");
  if (!digitsOnly) {
    return "";
  }

  if (digitsOnly.startsWith("00")) {
    digitsOnly = digitsOnly.slice(2);
  }

  if (digitsOnly.startsWith("60")) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.startsWith("0")) {
    return `+60${digitsOnly.slice(1)}`;
  }

  return `+${digitsOnly}`;
}

export function buildPhoneLookupVariants(input: string) {
  const normalized = normalizePhoneNumber(input);
  if (!normalized) {
    return [];
  }

  const digits = normalized.replace(/\D/g, "");
  const variants = new Set<string>([normalized, digits, `+${digits}`]);

  if (digits.startsWith("60")) {
    const localNumber = `0${digits.slice(2)}`;
    variants.add(localNumber);
    variants.add(`+${localNumber}`);
  }

  return [...variants];
}

export function maskSecret(secret?: string | null) {
  if (!secret) {
    return null;
  }

  const visible = secret.slice(-4);
  return `••••${visible}`;
}

export function getSecretLast4(secret?: string | null) {
  if (!secret) {
    return null;
  }

  return secret.slice(-4);
}

export function generateWebhookSecret() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildWhatsappWebhookUrl(requestUrl: URL, webhookSecret: string) {
  const appBaseUrl = (
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    requestUrl.origin
  ).replace(/\/$/, "");

  return `${appBaseUrl}/api/webhooks/whatsapp?token=${webhookSecret}`;
}

export interface InboundWebhookPayload {
  message: string;
  phone: string;
  contactName?: string;
  messageId?: string;
  instanceName?: string;
}

function getNestedRecord(
  value: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object") {
    return undefined;
  }

  return nested as Record<string, unknown>;
}

function getFirstArrayRecord(
  value: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const nested = (value as Record<string, unknown>)[key];
  if (!Array.isArray(nested) || nested.length === 0) {
    return undefined;
  }

  const first = nested[0];
  if (!first || typeof first !== "object") {
    return undefined;
  }

  return first as Record<string, unknown>;
}

function getStringCandidates(...values: unknown[]) {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
}

function getClinicPlatformConfig(clinic?: ClinicMessagingConfig): EvolutionPlatformConfig | null {
  if (clinic?.evolution_api_url && clinic.evolution_api_key) {
    return {
      apiUrl: clinic.evolution_api_url.replace(/\/$/, ""),
      apiKey: clinic.evolution_api_key,
    };
  }

  return getPlatformConfig();
}

function getMessageTextContent(message?: Record<string, unknown>) {
  if (!message) {
    return undefined;
  }

  const extendedTextMessage = getNestedRecord(message, "extendedTextMessage");
  const imageMessage = getNestedRecord(message, "imageMessage");
  const videoMessage = getNestedRecord(message, "videoMessage");
  const reactionMessage = getNestedRecord(message, "reactionMessage");
  const buttonsResponseMessage = getNestedRecord(message, "buttonsResponseMessage");
  const listResponseMessage = getNestedRecord(message, "listResponseMessage");
  const singleSelectReply = getNestedRecord(
    listResponseMessage,
    "singleSelectReply"
  );
  const templateButtonReplyMessage = getNestedRecord(
    message,
    "templateButtonReplyMessage"
  );
  const interactiveResponseMessage = getNestedRecord(
    message,
    "interactiveResponseMessage"
  );
  const nativeFlowResponseMessage = getNestedRecord(
    interactiveResponseMessage,
    "nativeFlowResponseMessage"
  );

  return getStringCandidates(
    message.conversation,
    extendedTextMessage?.text,
    imageMessage?.caption,
    videoMessage?.caption,
    reactionMessage?.text,
    buttonsResponseMessage?.selectedDisplayText,
    buttonsResponseMessage?.selectedButtonId,
    singleSelectReply?.selectedRowId,
    singleSelectReply?.title,
    templateButtonReplyMessage?.selectedDisplayText,
    templateButtonReplyMessage?.selectedId,
    nativeFlowResponseMessage?.name
  );
}

function normalizeWebhookEventName(value?: string | null) {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase().replace(/[\s_-]+/g, ".");
}

function getMessageKey(body: Record<string, unknown>) {
  return (
    getNestedRecord(getNestedRecord(body, "data"), "key") ??
    getNestedRecord(body, "key") ??
    undefined
  );
}

function isIgnoredRemoteJid(value?: string | null) {
  if (!value) {
    return false;
  }

  return (
    value.endsWith("@g.us") ||
    value.endsWith("@broadcast") ||
    value === "status@broadcast"
  );
}

export function getWebhookEventName(body: Record<string, unknown>) {
  const data = getNestedRecord(body, "data");
  return normalizeWebhookEventName(
    getStringCandidates(
      body.event,
      body.eventType,
      body.event_name,
      body.type,
      data?.event,
      data?.eventType,
      data?.event_name,
      data?.type
    )
  );
}

export function getWebhookInstanceName(body: Record<string, unknown>) {
  const data = getNestedRecord(body, "data");
  const instance = getNestedRecord(body, "instance");
  const nestedInstance = getNestedRecord(data, "instance");

  return getStringCandidates(
    body.instanceName,
    body.instance_name,
    typeof body.instance === "string" ? body.instance : undefined,
    instance?.instanceName,
    instance?.instance_name,
    instance?.name,
    data?.instanceName,
    data?.instance_name,
    typeof data?.instance === "string" ? data.instance : undefined,
    nestedInstance?.instanceName,
    nestedInstance?.instance_name,
    nestedInstance?.name
  );
}

export function getWebhookConnectionState(body: Record<string, unknown>) {
  const data = getNestedRecord(body, "data");
  const instance = getNestedRecord(body, "instance");
  const nestedInstance = getNestedRecord(data, "instance");
  const state = getStringCandidates(
    body.state,
    body.connection,
    body.status,
    data?.state,
    data?.connection,
    data?.status,
    instance?.state,
    nestedInstance?.state
  );

  return state?.trim().toLowerCase() ?? null;
}

export function isWebhookFromMe(body: Record<string, unknown>) {
  const data = getNestedRecord(body, "data");
  const key = getMessageKey(body);

  return Boolean(
    body.fromMe === true ||
      data?.fromMe === true ||
      key?.fromMe === true
  );
}

export function isWebhookMessageEvent(body: Record<string, unknown>) {
  const eventName = getWebhookEventName(body);

  if (!eventName) {
    return true;
  }

  return eventName === "messages.upsert";
}

/**
 * Detect Evolution / WhatsApp status update events. Evolution sends
 * `messages.update` (or `MESSAGES_UPDATE`) when a message's delivery state
 * changes — i.e. the recipient's device acknowledges receipt or the message
 * has been read.
 */
export function isWebhookMessageStatusEvent(body: Record<string, unknown>) {
  const eventName = getWebhookEventName(body);
  if (!eventName) {
    return false;
  }

  return eventName === "messages.update" || eventName === "send.message";
}

/**
 * Extract a normalized status string from a status-update webhook payload.
 * Returns one of: "delivered", "read", "sent", "failed", or null if unknown.
 *
 * Evolution / Baileys reports statuses in several shapes:
 *  - `status: "DELIVERY_ACK" | "READ" | "SERVER_ACK" | "ERROR"`
 *  - `status: 2 | 3 | 4` (Baileys legacy enum: 1=pending, 2=server_ack, 3=delivery_ack, 4=read)
 *  - `update.status: "PLAYED"` etc.
 */
export function getWebhookMessageStatus(
  body: Record<string, unknown>
): "sent" | "delivered" | "read" | "failed" | null {
  const data = getNestedRecord(body, "data");
  const update = getNestedRecord(data, "update") ?? getNestedRecord(body, "update");

  const raw = getStringCandidates(
    body.status,
    data?.status,
    update?.status,
    body.messageStatus,
    data?.messageStatus
  );

  if (!raw) {
    // Try numeric (Baileys legacy)
    const candidates = [data?.status, body.status, update?.status];
    for (const candidate of candidates) {
      if (typeof candidate === "number") {
        if (candidate === 4) return "read";
        if (candidate === 3) return "delivered";
        if (candidate === 2) return "sent";
        if (candidate === 0 || candidate === -1) return "failed";
      }
    }
    return null;
  }

  const normalized = raw.trim().toUpperCase();

  if (normalized === "READ" || normalized === "PLAYED") {
    return "read";
  }
  if (
    normalized === "DELIVERY_ACK" ||
    normalized === "DELIVERED" ||
    normalized === "DELIVER"
  ) {
    return "delivered";
  }
  if (
    normalized === "SERVER_ACK" ||
    normalized === "SENT" ||
    normalized === "PENDING"
  ) {
    return "sent";
  }
  if (
    normalized === "ERROR" ||
    normalized === "FAILED" ||
    normalized === "FAIL"
  ) {
    return "failed";
  }

  return null;
}

/**
 * Extract the provider message ID from a status update webhook. Reuses the
 * same shape as inbound messages (key.id, data.id, etc.).
 */
export function getWebhookMessageId(body: Record<string, unknown>) {
  const data = getNestedRecord(body, "data");
  const key =
    getNestedRecord(data, "key") ?? getNestedRecord(body, "key") ?? undefined;

  return getStringCandidates(
    body.messageId,
    body.id,
    data?.messageId,
    data?.id,
    key?.id,
    getNestedRecord(body, "update")?.messageId,
    getNestedRecord(data, "update")?.messageId
  );
}

export function normalizeEvolutionNumber(input: string) {
  return normalizePhoneNumber(input).replace(/\D/g, "");
}

function readDelayEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Compute a humanized "typing" delay (ms) passed to Evolution's sendText so the
 * recipient sees a composing presence for a realistic duration before the
 * message arrives. Sending bursts with zero delay is the primary trigger for
 * WhatsApp number bans on automated/bulk traffic.
 *
 * The delay scales with message length (≈45 ms/char, i.e. a brisk typist),
 * clamped to a configurable floor/ceiling, plus randomized jitter so automated
 * sends don't form a detectable uniform pattern. Human (live agent) replies use
 * a tighter ceiling so the inbox stays responsive.
 */
export function computeHumanizedSendDelayMs(
  message: string,
  senderType: "human" | "bot" | "system"
) {
  const minDelay = readDelayEnv("WHATSAPP_SEND_MIN_DELAY_MS", 1200);
  const maxDelay = readDelayEnv(
    "WHATSAPP_SEND_MAX_DELAY_MS",
    senderType === "human" ? 2500 : 5000
  );

  if (maxDelay <= 0) {
    return 0;
  }

  const lower = Math.min(minDelay, maxDelay);
  const typingMs = message.trim().length * 45;
  const base = Math.min(Math.max(typingMs, lower), maxDelay);
  const jitterRange = Math.max(0, maxDelay - base);
  const jitter = Math.floor(Math.random() * (jitterRange + 1));

  return Math.min(base + jitter, maxDelay);
}

function getWebhookQrRecord(body: Record<string, unknown>) {
  const data = getNestedRecord(body, "data");
  return (
    getNestedRecord(data, "qrcode") ??
    getNestedRecord(body, "qrcode") ??
    undefined
  );
}

export function getWebhookQrCodeDataUrl(body: Record<string, unknown>) {
  const qr = getWebhookQrRecord(body);
  const rawValue = getStringCandidates(
    qr?.base64,
    body.base64,
    getNestedRecord(body, "data")?.base64
  );

  if (!rawValue) {
    return null;
  }

  if (rawValue.startsWith("data:image") || rawValue.startsWith("data:")) {
    return rawValue;
  }

  return null;
}

export function getWebhookPairingCode(body: Record<string, unknown>) {
  const qr = getWebhookQrRecord(body);

  return (
    getStringCandidates(
      qr?.pairingCode,
      body.pairingCode,
      getNestedRecord(body, "data")?.pairingCode,
      qr?.code
    ) ?? null
  );
}

export function normalizeInboundWebhookPayload(
  body: Record<string, unknown>
): InboundWebhookPayload | null {
  const nestedData = getNestedRecord(body, "data");
  const nestedMessage = getNestedRecord(nestedData, "message");
  const nestedKey = getMessageKey(body);
  const remoteJid = getStringCandidates(
    nestedKey?.remoteJid,
    nestedData?.remoteJid,
    body.remoteJid
  );

  if (isIgnoredRemoteJid(remoteJid)) {
    return null;
  }

  const content =
    (body.message as string | undefined) ||
    getMessageTextContent(nestedMessage);

  const phone =
    (body.phone as string | undefined) ||
    remoteJid?.split("@")[0] ||
    (nestedData?.phone as string | undefined);

  if (!content || !phone) {
    return null;
  }

  return {
    message: content,
    phone,
    contactName:
      (body.contactName as string | undefined) ||
      (nestedData?.pushName as string | undefined) ||
      (body.pushName as string | undefined),
    messageId:
      (body.messageId as string | undefined) ||
      (nestedKey?.id as string | undefined),
    instanceName: getWebhookInstanceName(body),
  };
}

export async function ensureClinicWhatsappInstance(input: {
  clinicId: string;
  clinicName: string;
  instanceName: string;
  webhookUrl: string;
}) {
  const existing = (await callEvolution<Record<string, unknown>[] | Record<string, unknown>>({
    path: `/instance/fetchInstances?instanceName=${encodeURIComponent(
      input.instanceName
    )}`,
  }).catch(() => null)) as
    | Record<string, unknown>[]
    | Record<string, unknown>
    | null;

  const existingInstances = Array.isArray(existing)
    ? existing
    : existing
      ? [existing]
      : [];
  const matchingInstance = existingInstances.find((instance) => {
    const candidate = instance as EvolutionInstanceRecord;
    return (
      candidate.name === input.instanceName ||
      candidate.instanceName === input.instanceName
    );
  }) as EvolutionInstanceRecord | undefined;
  const alreadyExists = existingInstances.length > 0;

  if (alreadyExists) {
    if (matchingInstance && shouldRecreateWhatsappInstance(matchingInstance)) {
      await deleteWhatsappInstance(input.instanceName);
    } else {
      return { created: false };
    }
  }

  await callEvolution({
    path: "/instance/create",
    method: "POST",
    body: {
      instanceName: input.instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      groupsIgnore: true,
      webhook: {
        url: input.webhookUrl,
        // Keep a single fixed webhook URL because this app passes the clinic token
        // via query string; per-event URL suffixes break that format.
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    },
  });

  return { created: true };
}

function shouldRecreateWhatsappInstance(instance: EvolutionInstanceRecord) {
  const reasonText = instance.disconnectionObject?.toLowerCase() ?? "";
  const connectionStatus = instance.connectionStatus?.toLowerCase() ?? "";

  return (
    instance.disconnectionReasonCode === 401 ||
    reasonText.includes("unauthorized") ||
    reasonText.includes("log out instance") ||
    (connectionStatus === "close" &&
      (reasonText.includes("statuscode\":401") ||
        reasonText.includes("message\":\"log out instance")))
  );
}

async function deleteWhatsappInstance(instanceName: string) {
  try {
    await callEvolution({
      path: `/instance/delete/${encodeURIComponent(instanceName)}`,
      method: "DELETE",
    });
  } catch {
    await callEvolution({
      path: `/instance/delete/${encodeURIComponent(instanceName)}`,
      method: "POST",
    });
  }
}

export async function recreateWhatsappInstance(input: {
  clinicId: string;
  clinicName: string;
  instanceName: string;
  webhookUrl: string;
}) {
  await deleteWhatsappInstance(input.instanceName).catch(() => null);

  return ensureClinicWhatsappInstance(input);
}

function getConnectionStateValue(payload: EvolutionConnectionResponse) {
  return (payload.instance?.state ?? "").toLowerCase();
}

async function getInstanceConnectionState(instanceName: string) {
  const payload = await callEvolution<EvolutionConnectionResponse>({
    path: `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  });
  return getConnectionStateValue(payload);
}

export async function fetchWhatsappQrCode(instanceName: string) {
  const payload = (await callEvolution<Record<string, unknown>>({
    path: `/instance/connect/${encodeURIComponent(instanceName)}`,
    method: "GET",
  })) as Record<string, unknown>;

  const rawCode =
    (payload.code as string | undefined) ??
    (payload.base64 as string | undefined) ??
    (payload.qrcode as string | undefined) ??
    "";

  if (!rawCode) {
    return {
      qrCodeDataUrl: null,
      pairingCode: null,
    };
  }

  if (rawCode.startsWith("data:image")) {
    return {
      qrCodeDataUrl: rawCode,
      pairingCode: null,
    };
  }

  if (rawCode.startsWith("data:")) {
    return {
      qrCodeDataUrl: rawCode,
      pairingCode: null,
    };
  }

  const qrCodeDataUrl = await QRCode.toDataURL(rawCode, {
    width: 320,
    margin: 1,
  });

  return {
    qrCodeDataUrl,
    pairingCode: (payload.pairingCode as string | undefined) ?? rawCode,
  };
}

export async function disconnectWhatsappInstance(instanceName: string) {
  try {
    try {
      await callEvolution({
        path: `/instance/logout/${encodeURIComponent(instanceName)}`,
        method: "DELETE",
      });
    } catch {
      await callEvolution({
        path: `/instance/logout/${encodeURIComponent(instanceName)}`,
        method: "POST",
      }).catch(() => null);
    }

    await deleteWhatsappInstance(instanceName).catch(() => null);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to disconnect instance.",
    };
  }
}

export async function buildWhatsappConnectionState(input: {
  clinic: ClinicMessagingConfig;
  includeQr?: boolean;
}) {
  if (!input.clinic.evolution_instance_name) {
    return {
      clinic_id: input.clinic.id,
      whatsapp_status: normalizeWhatsappStatus(input.clinic.whatsapp_status),
      whatsapp_number: input.clinic.whatsapp_number ?? null,
      instance_name: null,
      is_connected: false,
      qr_code_data_url: input.clinic.whatsapp_qr_code ?? null,
      pairing_code: input.clinic.whatsapp_pairing_code ?? null,
      last_synced_at: null,
      connected_at: null,
      error: null,
    } satisfies WhatsappConnectionState;
  }

  try {
    const state = await getInstanceConnectionState(
      input.clinic.evolution_instance_name
    );
    const isConnected = state === "open";
    let qrCodeDataUrl: string | null = null;
    let pairingCode: string | null = null;

    if (!isConnected && input.includeQr) {
      const qrPayload = await fetchWhatsappQrCode(
        input.clinic.evolution_instance_name
      );
      qrCodeDataUrl = qrPayload.qrCodeDataUrl ?? input.clinic.whatsapp_qr_code ?? null;
      pairingCode =
        qrPayload.pairingCode ?? input.clinic.whatsapp_pairing_code ?? null;
    }

    return {
      clinic_id: input.clinic.id,
      whatsapp_status: isConnected ? "connected" : "pending_qr",
      whatsapp_number: input.clinic.whatsapp_number ?? null,
      instance_name: input.clinic.evolution_instance_name,
      is_connected: isConnected,
      qr_code_data_url: qrCodeDataUrl,
      pairing_code: pairingCode,
      last_synced_at: new Date().toISOString(),
      connected_at: isConnected ? new Date().toISOString() : null,
      error: null,
    } satisfies WhatsappConnectionState;
  } catch (error) {
    return {
      clinic_id: input.clinic.id,
      whatsapp_status: "disconnected",
      whatsapp_number: input.clinic.whatsapp_number ?? null,
      instance_name: input.clinic.evolution_instance_name,
      is_connected: false,
      qr_code_data_url: null,
      pairing_code: null,
      last_synced_at: new Date().toISOString(),
      connected_at: null,
      error: error instanceof Error ? error.message : "Failed to load QR state.",
    } satisfies WhatsappConnectionState;
  }
}

export function buildWhatsappStateUpdate(
  clinic: ClinicMessagingConfig,
  state: WhatsappConnectionState,
  nowIso = new Date().toISOString()
) {
  const nextWhatsappStatus = state.is_connected
    ? "connected"
    : state.whatsapp_status === "disconnected"
      ? "disconnected"
      : "pending_qr";

  return {
    whatsapp_status: nextWhatsappStatus,
    whatsapp_number:
      (state.whatsapp_number?.trim() || clinic.whatsapp_number || null) as
        | string
        | null,
    whatsapp_qr_code: state.is_connected ? null : state.qr_code_data_url ?? null,
    whatsapp_pairing_code: state.is_connected ? null : state.pairing_code ?? null,
    whatsapp_connected_at: state.is_connected ? nowIso : null,
    whatsapp_last_synced_at: nowIso,
    updated_at: nowIso,
    ...buildOnboardingFields({
      paymentStatus: clinic.payment_status === "received" ? "received" : "pending",
      whatsappStatus: nextWhatsappStatus,
      currentOnboardingCompletedAt: clinic.onboarding_completed_at ?? null,
      nowIso,
    }),
  };
}

export function hasPlatformWhatsappConfig() {
  return getPlatformConfig() !== null;
}

export function getSupportWhatsappNumber() {
  return (
    process.env.SUPPORT_WHATSAPP_NUMBER ??
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER ??
    null
  );
}

function extractSendMessageProviderId(payload: Record<string, unknown>) {
  const data = getNestedRecord(payload, "data");
  const message = getNestedRecord(payload, "message");
  const dataMessage = getNestedRecord(data, "message");
  const key = getNestedRecord(payload, "key");
  const dataKey = getNestedRecord(data, "key");
  const messageKey = getNestedRecord(message, "key");
  const dataMessageKey = getNestedRecord(dataMessage, "key");
  const firstMessage = getFirstArrayRecord(payload, "messages");
  const firstDataMessage = getFirstArrayRecord(data, "messages");
  const firstMessageKey = getNestedRecord(firstMessage, "key");
  const firstDataMessageKey = getNestedRecord(firstDataMessage, "key");

  return (
    getStringCandidates(
      payload.messageId,
      payload.id,
      data?.messageId,
      data?.id,
      message?.id,
      dataMessage?.id,
      key?.id,
      dataKey?.id,
      messageKey?.id,
      dataMessageKey?.id,
      firstMessage?.messageId,
      firstMessage?.id,
      firstDataMessage?.messageId,
      firstDataMessage?.id,
      firstMessageKey?.id,
      firstDataMessageKey?.id
    ) ?? null
  );
}

export async function sendWhatsappMessage(input: {
  clinic: ClinicMessagingConfig;
  contactId: string;
  phone: string;
  message: string;
  senderType: "human" | "bot" | "system";
}) {
  const platform = getClinicPlatformConfig(input.clinic);

  if (!platform) {
    return {
      success: false,
      error: "Platform WhatsApp config is not set.",
    };
  }

  if (!input.clinic.evolution_instance_name) {
    return {
      success: false,
      error: "Clinic WhatsApp instance is not ready yet.",
    };
  }

  if (normalizeWhatsappStatus(input.clinic.whatsapp_status) !== "connected") {
    return {
      success: false,
      error: "Clinic WhatsApp is disconnected.",
    };
  }

  try {
    const number = normalizeEvolutionNumber(input.phone);
    if (!number) {
      return {
        success: false,
        error: "Contact phone number is invalid.",
      };
    }

    const path = `/message/sendText/${encodeURIComponent(
      input.clinic.evolution_instance_name
    )}`;
    const response = await fetch(`${platform.apiUrl}${path}`, {
      method: "POST",
      headers: {
        apikey: platform.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number,
        text: input.message.trim(),
        delay: computeHumanizedSendDelayMs(input.message, input.senderType),
        presence: "composing",
      }),
      cache: "no-store",
    });
    const payload = (await response
      .json()
      .catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      return {
        success: false,
        error: extractEvolutionErrorMessage(payload, response.status),
      };
    }

    return {
      success: true,
      providerMessageId: extractSendMessageProviderId(payload),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to send external message.",
    };
  }
}
