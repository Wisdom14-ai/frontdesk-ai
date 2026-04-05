"use client";

import { WhatsappConnectionCard } from "./WhatsappConnectionCard";

interface AdminWhatsappConnectionCardProps {
  clinicId: string;
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

export function AdminWhatsappConnectionCard({
  clinicId,
}: AdminWhatsappConnectionCardProps) {
  const baseUrl = `/api/admin/clinics/${clinicId}/whatsapp`;

  return (
    <WhatsappConnectionCard
      title="Super Admin WhatsApp Control"
      description="Generate or refresh the clinic QR code, verify connection state, and disconnect the clinic number without exposing any backend credentials."
      fetchConnection={async (includeQr) => {
        try {
          const response = await fetch(
            `${baseUrl}${includeQr ? "?includeQr=1" : ""}`,
            {
              cache: "no-store",
            }
          );
          return await readJson(response);
        } catch (error) {
          return { error: toErrorMessage(error) };
        }
      }}
      startConnection={async () => {
        try {
          const response = await fetch(baseUrl, {
            method: "POST",
          });
          return await readJson(response);
        } catch (error) {
          return { error: toErrorMessage(error) };
        }
      }}
      disconnectConnection={async () => {
        try {
          const response = await fetch(baseUrl, {
            method: "DELETE",
          });
          await readJson(response);
          return { success: true as const };
        } catch (error) {
          return { error: toErrorMessage(error) };
        }
      }}
    />
  );
}
