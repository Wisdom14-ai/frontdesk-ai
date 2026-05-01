"use client";

import { Send } from "lucide-react";
import { useEffect, useState } from "react";

interface ChatInputProps {
  draft: string;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSend: (content: string) => Promise<void>;
}

export function ChatInput({ draft, disabled, onDraftChange, onSend }: ChatInputProps) {
  const [sending, setSending] = useState(false);
  const [localDraft, setLocalDraft] = useState(draft);

  useEffect(() => {
    setLocalDraft(draft);
  }, [draft]);

  async function handleSend() {
    const content = localDraft.trim();
    if (!content || sending || disabled) {
      return;
    }

    setSending(true);
    setLocalDraft("");
    onDraftChange("");

    try {
      await onSend(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
      <input
        value={localDraft}
        onChange={(event) => {
          setLocalDraft(event.target.value);
          onDraftChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
          }
        }}
        disabled={disabled || sending}
        placeholder="Type a reply..."
        className="h-[30px] min-w-0 flex-1 rounded-full border border-[var(--border-default)] bg-white px-3 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--brand-gold-border)]"
      />
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={disabled || sending || !localDraft.trim()}
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--brand-gold)] text-white transition-colors hover:bg-[var(--brand-gold-dark)] disabled:opacity-50"
        aria-label="Send"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
