"use client";

import type { AppMessage } from "@/types/app.types";

interface MessageBubbleProps {
  message: AppMessage;
}

function DeliveryTicks({ delivered }: { delivered: boolean }) {
  // Single tick = sent/in-flight, double tick = delivered to WhatsApp.
  return (
    <svg
      viewBox="0 0 18 12"
      className="inline-block h-3 w-[18px] align-[-1px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={delivered ? "Delivered" : "Sent"}
    >
      <path d="M1 6.5 4 9.5 9.5 3" />
      {delivered ? <path d="M7.5 9.5 13 3" /> : null}
    </svg>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isInbound = message.direction === "inbound";
  const isPending = message.id.startsWith("temp-");
  const isDelivered = !isInbound && !isPending && Boolean(message.provider_message_id);
  const label = isInbound
    ? "Lead"
    : message.sender_type === "bot"
      ? "Bot"
      : message.sender_type === "system"
        ? "System"
        : "Human";
  const time = new Date(message.created_at).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={[
        isInbound ? "flex justify-start" : "flex justify-end",
        isPending ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className={isInbound ? "max-w-[72%]" : "max-w-[72%] text-right"}>
        <div
          className={[
            "mb-0.5 flex items-center gap-1 text-[9px] text-[var(--text-hint)]",
            isInbound ? "justify-start" : "justify-end",
          ].join(" ")}
        >
          {isInbound ? null : (
            <span className={isDelivered ? "text-[var(--wa-connected)]" : "text-[var(--text-hint)]"}>
              <DeliveryTicks delivered={isDelivered} />
            </span>
          )}
          <span>
            {isPending ? "Sending…" : `${label} · ${time}`}
          </span>
        </div>
        <div
          className={[
            "whitespace-pre-wrap px-3 py-2 text-[12px] leading-5",
            isInbound
              ? "rounded-[10px] rounded-bl-[2px] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
              : message.sender_type === "bot"
                ? "rounded-[10px] rounded-br-[2px] bg-[var(--status-bot-bg)] text-[var(--status-bot-text)]"
                : "rounded-[10px] rounded-br-[2px] bg-[var(--brand-gold-light)] text-[#633806]",
          ].join(" ")}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
