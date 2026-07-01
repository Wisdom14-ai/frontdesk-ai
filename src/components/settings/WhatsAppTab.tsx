"use client";

import { Copy, Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/ui/Toaster";

interface ClinicDetails {
  id: string;
  whatsapp_status: string;
  whatsapp_number?: string | null;
  whatsapp_connected_at?: string | null;
  webhook_secret?: string | null;
  n8n_webhook_url?: string | null;
  evolution_instance_name?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  clinic_prompt?: string | null;
  clinic_knowledge?: string | null;
}

interface WhatsappConnection {
  whatsapp_status: string;
  qr_code_data_url?: string | null;
  pairing_code?: string | null;
  is_connected: boolean;
  error?: string | null;
}

interface WhatsAppTabProps {
  clinic: ClinicDetails | null;
  onReload: () => void;
}

export function WhatsAppTab({ clinic, onReload }: WhatsAppTabProps) {
  const { toast } = useToast();
  const [instanceName, setInstanceName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState("");
  const [clinicPrompt, setClinicPrompt] = useState("");
  const [clinicKnowledge, setClinicKnowledge] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [connection, setConnection] = useState<WhatsappConnection | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInstanceName(clinic?.evolution_instance_name ?? "");
    setApiUrl(clinic?.evolution_api_url ?? "");
    setApiKey(clinic?.evolution_api_key ?? "");
    setN8nWebhookUrl(clinic?.n8n_webhook_url ?? "");
    setClinicPrompt(clinic?.clinic_prompt ?? "");
    setClinicKnowledge(clinic?.clinic_knowledge ?? "");
  }, [clinic]);

  const webhookUrl = useMemo(() => {
    if (!clinic?.webhook_secret || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/api/webhook/whatsapp?token=${clinic.webhook_secret}`;
  }, [clinic?.webhook_secret]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/clinic", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evolution_instance_name: instanceName,
          evolution_api_url: apiUrl,
          evolution_api_key: apiKey,
          n8n_webhook_url: n8nWebhookUrl,
          clinic_prompt: clinicPrompt,
          clinic_knowledge: clinicKnowledge,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        toast("error", payload.error || "Failed to save settings.");
        return;
      }

      toast("success", "Settings saved.");
      onReload();
    } catch {
      toast("error", "Failed to save settings. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function reconnect() {
    setQrError(null);
    setConnection(null);
    setQrOpen(true);
    try {
      const response = await fetch("/api/clinic/whatsapp", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        connection?: WhatsappConnection;
        error?: string;
      };
      if (!response.ok) {
        setQrError(payload.error || "Failed to start the WhatsApp connection.");
        return;
      }
      if (payload.connection) {
        setConnection(payload.connection);
      }
    } catch {
      setQrError("Failed to reach the server. Check your connection and try again.");
    }
  }

  const refreshConnection = useCallback(async (includeQr = false) => {
    const response = await fetch(`/api/clinic/whatsapp${includeQr ? "?includeQr=1" : ""}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      connection?: WhatsappConnection;
      error?: string;
    };
    if (!response.ok) {
      setQrError(payload.error || "Failed to load the WhatsApp connection.");
      return;
    }
    if (payload.connection) {
      setConnection(payload.connection);
      // A 200 response can still carry a connection-level error (e.g. the
      // Evolution platform is unreachable). Surface it instead of silently
      // falling back to the "Waiting for QR..." spinner. Only clear an error
      // on real progress (QR shown or connected) so a blank poll doesn't wipe
      // an error raised by the initial POST (e.g. subscription inactive).
      if (payload.connection.error) {
        setQrError(payload.connection.error);
      } else if (payload.connection.qr_code_data_url || payload.connection.is_connected) {
        setQrError(null);
      }
      if (payload.connection.is_connected) {
        setQrOpen(false);
        onReload();
      }
    }
  }, [onReload]);

  async function disconnect() {
    await fetch("/api/clinic/whatsapp", { method: "DELETE" });
    onReload();
  }

  useEffect(() => {
    if (!qrOpen) return;
    const timer = window.setInterval(() => {
      void refreshConnection(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [qrOpen, refreshConnection]);

  const status = connection?.whatsapp_status ?? clinic?.whatsapp_status ?? "not_connected";
  const connected = status === "connected";

  return (
    <section className="max-w-[620px] space-y-3">
      <div className="rounded-[8px] border border-[var(--border-subtle)] bg-white p-3">
        <div className="grid gap-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-[var(--wa-connected)]" : "bg-[var(--wa-disconnected)]"}`} />
            <span className="font-medium capitalize">{status.replace("_", " ")}</span>
          </div>
          <div>Number: {clinic?.whatsapp_number || "-"}</div>
          <div>
            Connected since:{" "}
            {clinic?.whatsapp_connected_at
              ? new Date(clinic.whatsapp_connected_at).toLocaleDateString("en-MY", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "-"}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void reconnect()}
              className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white"
            >
              Reconnect QR
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-[6px] border border-[var(--border-default)] px-3 py-1.5 text-[11px]"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>

      <Field label="Webhook URL (n8n)">
        <div className="flex gap-1">
          <input value={webhookUrl} readOnly className="fd-input flex-1" />
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(webhookUrl)}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--border-default)]"
            aria-label="Copy webhook URL"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </Field>
      <Field label="Evolution instance">
        <input value={instanceName} onChange={(event) => setInstanceName(event.target.value)} className="fd-input" />
      </Field>
      <Field label="Evolution API URL">
        <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} className="fd-input" />
      </Field>
      <Field label="Evolution API key">
        <div className="flex gap-1">
          <input
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="fd-input flex-1"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--border-default)]"
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
          >
            {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </Field>
      <Field label="n8n webhook URL">
        <input value={n8nWebhookUrl} onChange={(event) => setN8nWebhookUrl(event.target.value)} className="fd-input" />
      </Field>
      <Field label="AI clinic prompt (style & policy)">
        <textarea
          value={clinicPrompt}
          onChange={(event) => setClinicPrompt(event.target.value)}
          rows={7}
          placeholder="How the AI should sound and behave, e.g. friendly, bilingual Malay/English, always offer a free consultation."
          className="w-full resize-none rounded-[6px] border border-[var(--border-default)] p-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
        />
      </Field>
      <Field label="AI clinic knowledge (services, prices, hours, location, FAQs)">
        <textarea
          value={clinicKnowledge}
          onChange={(event) => setClinicKnowledge(event.target.value)}
          rows={10}
          placeholder={"Facts the AI may quote to patients. Example:\nServices & prices: Scaling RM120, Whitening RM450...\nHours: Mon-Sat 9am-9pm, closed Sunday\nAddress: 12 Jalan Ampang, KL\nFAQs: Panel insurance accepted: AIA, Etiqa..."}
          className="w-full resize-none rounded-[6px] border border-[var(--border-default)] p-2 text-[11px] outline-none focus:border-[var(--brand-gold-border)]"
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          The AI only states prices, hours, and other facts that are written here.
        </p>
      </Field>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
      >
        Save changes
      </button>

      {qrOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="rounded-[8px] border border-[var(--border-default)] bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-8">
              <h3 className="text-[13px] font-semibold">Scan QR</h3>
              <button
                type="button"
                onClick={() => {
                  setQrOpen(false);
                  setQrError(null);
                }}
                className="text-[11px]"
              >
                Close
              </button>
            </div>
            {qrError ? (
              <div className="flex h-[260px] w-[260px] flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="text-[11px] text-[var(--wa-disconnected)]">{qrError}</p>
                <button
                  type="button"
                  onClick={() => void reconnect()}
                  className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white"
                >
                  Try again
                </button>
              </div>
            ) : connection?.qr_code_data_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connection.qr_code_data_url} alt="WhatsApp QR code" className="h-[260px] w-[260px]" />
            ) : (
              <div className="flex h-[260px] w-[260px] items-center justify-center text-[11px] text-[var(--text-muted)]">
                Waiting for QR...
              </div>
            )}
            {connection?.pairing_code ? (
              <p className="mt-2 text-center text-[11px] text-[var(--text-secondary)]">
                {connection.pairing_code}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
