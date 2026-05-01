"use client";

import type { AppMessage } from "@/types/app.types";

interface MessageBubbleProps {
  message: AppMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isInbound = message.direction === "inbound";
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
    <div className={isInbound ? "flex justify-start" : "flex justify-end"}>
      <div className={isInbound ? "max-w-[72%]" : "max-w-[72%] text-right"}>
        <div className="mb-0.5 text-[9px] text-[var(--text-hint)]">
          {label} · {time}
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
