"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone, Unplug } from "lucide-react";

import type { WhatsappConnectionState } from "@/types";

interface ConnectionPayload {
  connection: WhatsappConnectionState;
  platformConfigured: boolean;
}

interface WhatsappConnectionCardProps {
  title: string;
  description: string;
  fetchConnection: (includeQr?: boolean) => Promise<ConnectionPayload | { error: string }>;
  startConnection: () => Promise<ConnectionPayload | { error: string }>;
  disconnectConnection?: () => Promise<{ success: boolean } | { error: string }>;
  onConnected?: () => void;
}

function isErrorResult<T extends object>(
  result: T | { error: string }
): result is { error: string } {
  return "error" in result;
}

export function WhatsappConnectionCard({
  title,
  description,
  fetchConnection,
  startConnection,
  disconnectConnection,
  onConnected,
}: WhatsappConnectionCardProps) {
  const [connection, setConnection] = useState<WhatsappConnectionState | null>(null);
  const [platformConfigured, setPlatformConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  const loadConnection = useCallback(async (includeQr = false) => {
    setLoading(true);
    const result = await fetchConnection(includeQr);

    if (isErrorResult(result)) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setConnection(result.connection);
    setPlatformConfigured(result.platformConfigured);
    setError("");
    setLoading(false);

    if (result.connection.is_connected) {
      onConnected?.();
    }
  }, [fetchConnection, onConnected]);

  useEffect(() => {
    void loadConnection(true);
  }, [loadConnection]);

  useEffect(() => {
    if (!connection?.instance_name || connection.is_connected) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadConnection(true);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [connection?.instance_name, connection?.is_connected, loadConnection]);

  const handleStart = async () => {
    setActionLoading(true);
    const result = await startConnection();
    if (isErrorResult(result)) {
      setError(result.error);
      setActionLoading(false);
      return;
    }

    setConnection(result.connection);
    setPlatformConfigured(result.platformConfigured);
    setError("");
    setActionLoading(false);
  };

  const handleRefresh = async () => {
    setActionLoading(true);
    await loadConnection(Boolean(connection?.instance_name && !connection.is_connected));
    setActionLoading(false);
  };

  const handleDisconnect = async () => {
    if (!disconnectConnection) {
      return;
    }

    setActionLoading(true);
    const result = await disconnectConnection();
    if ("error" in result) {
      setError(result.error);
      setActionLoading(false);
      return;
    }

    await loadConnection(false);
    setActionLoading(false);
  };

  const qrVisible = Boolean(connection?.qr_code_data_url);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>

        {connection?.is_connected ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Connected
          </div>
        ) : null}
      </div>

      {!platformConfigured && (
        <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          Platform WhatsApp credentials are not configured yet. Add the platform-level Evolution env vars before clinics can connect.
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading connection state...
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-border/60 bg-muted/20 p-5">
            {connection?.is_connected ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  The clinic WhatsApp number is connected and ready to send messages.
                </p>
                {connection.whatsapp_number ? (
                  <p className="text-sm text-muted-foreground">
                    Connected number: <span className="font-medium text-foreground">{connection.whatsapp_number}</span>
                  </p>
                ) : null}
              </div>
            ) : qrVisible ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <QrCode className="h-4 w-4 text-emerald-600" />
                  Scan this QR code using the clinic WhatsApp app
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-inner">
                  <Image
                    src={connection?.qr_code_data_url ?? ""}
                    alt="WhatsApp QR code"
                    width={320}
                    height={320}
                    className="mx-auto h-64 w-64 max-w-full object-contain"
                  />
                </div>
                {connection?.pairing_code ? (
                  <p className="text-xs text-muted-foreground">
                    Pairing code: <span className="font-medium text-foreground">{connection.pairing_code}</span>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  No QR is active yet. Generate one when the clinic phone is ready to scan.
                </p>
                <p className="text-sm text-muted-foreground">
                  Once the phone scans successfully, this panel will switch to connected automatically.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-border/60 bg-background p-5">
            <div className="rounded-xl border border-border/60 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Status
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {connection?.is_connected
                  ? "Connected"
                  : connection?.instance_name
                    ? "Waiting for scan"
                    : "Not started"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {connection?.instance_name
                  ? `Instance: ${connection.instance_name}`
                  : "A WhatsApp instance will be created when the QR is generated."}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleStart}
                disabled={actionLoading || !platformConfigured}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                {connection?.instance_name ? "Refresh QR" : "Generate QR"}
              </button>

              <button
                type="button"
                onClick={handleRefresh}
                disabled={actionLoading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${actionLoading ? "animate-spin" : ""}`} />
                Refresh status
              </button>

              {disconnectConnection ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={actionLoading || !connection?.instance_name}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
