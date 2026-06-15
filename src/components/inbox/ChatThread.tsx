"use client";

import { useEffect, useRef, useState } from "react";

import { ChatHeader } from "@/components/inbox/ChatHeader";
import { ChatInput } from "@/components/inbox/ChatInput";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { QuickReplies } from "@/components/inbox/QuickReplies";
import { formatDayLabel } from "@/lib/frontdesk";
import type { AppContact, AppMessage, MessageTemplate } from "@/types/app.types";

function isSameDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

interface ChatThreadProps {
  contact: AppContact | null;
  messages: AppMessage[];
  templates: MessageTemplate[];
  sending: boolean;
  onPatchContact: (contactId: string, updates: Partial<AppContact>) => Promise<void>;
  onSendMessage: (content: string) => Promise<void>;
}

export function ChatThread({
  contact,
  messages,
  templates,
  sending,
  onPatchContact,
  onSendMessage,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");

  // Render in chronological order regardless of how messages arrived
  // (initial load, realtime insert, or optimistic send).
  const orderedMessages = [...messages].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, contact?.id]);

  if (!contact) {
    return (
      <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--surface-base)] px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--text-muted)]">
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
          </svg>
        </span>
        <div className="text-[13px] font-medium text-[var(--text-secondary)]">
          Select a conversation
        </div>
        <div className="max-w-[240px] text-[11px] text-[var(--text-muted)]">
          Choose a chat from the list to view messages and reply.
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--surface-base)]">
      <ChatHeader contact={contact} onPatchContact={onPatchContact} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 fd-scrollbar">
        {orderedMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
            No messages yet
          </div>
        ) : (
          orderedMessages.map((message, index) => {
            const previous = orderedMessages[index - 1];
            const showDayDivider = !isSameDay(
              previous?.created_at,
              message.created_at
            );

            return (
              <div key={message.id} className="space-y-3">
                {showDayDivider ? (
                  <div className="flex justify-center">
                    <span className="rounded-full bg-[var(--surface-subtle)] px-3 py-1 text-[10px] font-medium text-[var(--text-muted)]">
                      {formatDayLabel(message.created_at)}
                    </span>
                  </div>
                ) : null}
                <MessageBubble message={message} />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <QuickReplies
        templates={templates}
        onPick={(body) => {
          setDraft(body);
        }}
      />
      <ChatInput
        draft={draft}
        disabled={sending}
        onDraftChange={setDraft}
        onSend={async (content) => {
          await onSendMessage(content);
          setDraft("");
        }}
      />
    </section>
  );
}
