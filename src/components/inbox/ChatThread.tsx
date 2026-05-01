"use client";

import { useEffect, useRef, useState } from "react";

import { ChatHeader } from "@/components/inbox/ChatHeader";
import { ChatInput } from "@/components/inbox/ChatInput";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { QuickReplies } from "@/components/inbox/QuickReplies";
import type { AppContact, AppMessage, MessageTemplate } from "@/types/app.types";

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, contact?.id]);

  if (!contact) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center bg-[var(--surface-base)] text-[12px] text-[var(--text-muted)]">
        Select a conversation
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--surface-base)]">
      <ChatHeader contact={contact} onPatchContact={onPatchContact} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 fd-scrollbar">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
            No messages yet
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
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
