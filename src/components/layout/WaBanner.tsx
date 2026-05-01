import Link from "next/link";
import { AlertCircle } from "lucide-react";

interface WaBannerProps {
  whatsappStatus: string | null;
}

export function WaBanner({ whatsappStatus }: WaBannerProps) {
  if (whatsappStatus === "connected") {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-b border-[#F7C1C1] bg-[var(--danger-bg)] px-4 py-1.5 text-[11px] text-[var(--danger-text)]">
      <AlertCircle className="h-[13px] w-[13px] shrink-0" />
      <span>
        WhatsApp disconnected - leads cannot receive messages.{" "}
        <Link href="/settings?tab=whatsapp" className="font-medium underline">
          Reconnect now -&gt;
        </Link>
      </span>
    </div>
  );
}
