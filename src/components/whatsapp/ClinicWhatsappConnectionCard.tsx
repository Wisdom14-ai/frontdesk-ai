"use client";

import { useRouter } from "next/navigation";

import {
  disconnectWhatsappConnection,
  fetchWhatsappConnection,
  startWhatsappConnection,
} from "@/lib/supabase/hooks";

import { WhatsappConnectionCard } from "./WhatsappConnectionCard";

interface ClinicWhatsappConnectionCardProps {
  title: string;
  description: string;
  redirectOnConnected?: string;
}

export function ClinicWhatsappConnectionCard({
  title,
  description,
  redirectOnConnected,
}: ClinicWhatsappConnectionCardProps) {
  const router = useRouter();

  return (
    <WhatsappConnectionCard
      title={title}
      description={description}
      fetchConnection={(includeQr) => fetchWhatsappConnection(includeQr)}
      startConnection={() => startWhatsappConnection()}
      disconnectConnection={() => disconnectWhatsappConnection()}
      onConnected={() => {
        router.refresh();
        if (redirectOnConnected) {
          router.push(redirectOnConnected);
        }
      }}
    />
  );
}
