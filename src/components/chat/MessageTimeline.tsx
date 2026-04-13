"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";

import { subscribeToMessagesChanged } from "@/lib/crm-events";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

const MESSAGE_POLL_INTERVAL_MS = 15_000;

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function getMessageTime(message: Message) {
  const timestamp = new Date(message.created_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isLocalMessage(message: Message) {
  return message.id.startsWith("local:");
}

function isSameLocalMessage(left: Message, right: Message) {
  const localMessage = isLocalMessage(left) ? left : isLocalMessage(right) ? right : null;
  const persistedMessage = localMessage === left ? right : localMessage === right ? left : null;

  if (!localMessage || !persistedMessage || isLocalMessage(persistedMessage)) {
    return false;
  }

  return (
    localMessage.contact_id === persistedMessage.contact_id &&
    localMessage.direction === persistedMessage.direction &&
    localMessage.sender_type === persistedMessage.sender_type &&
    localMessage.content === persistedMessage.content &&
    Math.abs(getMessageTime(localMessage) - getMessageTime(persistedMessage)) < 2 * 60 * 1000
  );
}

function mergeMessages(...messageLists: Message[][]) {
  const merged: Message[] = [];

  for (const messages of messageLists) {
    for (const message of messages) {
      if (
        merged.some(
          (existing) => existing.id === message.id || isSameLocalMessage(existing, message)
        )
      ) {
        continue;
      }

      merged.push(message);
    }
  }

  return merged.sort((left, right) => getMessageTime(left) - getMessageTime(right));
}

export function MessageTimeline({ leadId }: { leadId: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeLeadIdRef = useRef<string | null>(null);
  const previousLeadIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const localMessagesRef = useRef<Message[]>([]);

  const rememberLocalMessage = useCallback((message: Message) => {
    localMessagesRef.current = mergeMessages(localMessagesRef.current, [message]);
    setMessages((current) => mergeMessages(current, [message]));
  }, []);

  const fetchMessages = useCallback(
    async (contactId: string, showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/contacts/${contactId}/messages`, {
          cache: "no-store",
        });
        const payload = await readJson<{ messages: Message[] }>(response);
        if (activeLeadIdRef.current === contactId) {
          const fetchedMessages = payload.messages ?? [];
          localMessagesRef.current = localMessagesRef.current.filter(
            (message) =>
              message.contact_id !== contactId ||
              !fetchedMessages.some((fetched) => isSameLocalMessage(fetched, message))
          );
          const localMessages = localMessagesRef.current.filter(
            (message) => message.contact_id === contactId
          );
          setMessages(mergeMessages(fetchedMessages, localMessages));
        }
      } catch (error) {
        console.error("Failed to load messages:", error);
        if (activeLeadIdRef.current === contactId) {
          setMessages(
            localMessagesRef.current.filter((message) => message.contact_id === contactId)
          );
        }
      } finally {
        if (showLoading && activeLeadIdRef.current === contactId) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!leadId) {
      activeLeadIdRef.current = null;
      setMessages([]);
      setLoading(false);
      previousLeadIdRef.current = null;
      previousMessageCountRef.current = 0;
      return;
    }

    activeLeadIdRef.current = leadId;
    void fetchMessages(leadId, true);

    const unsubscribeMessagesChanged = subscribeToMessagesChanged(leadId, (detail) => {
      if (detail.message) {
        rememberLocalMessage(detail.message);
      }
      void fetchMessages(leadId);
    });

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchMessages(leadId);
      }
    }, MESSAGE_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchMessages(leadId);
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        void fetchMessages(leadId);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      unsubscribeMessagesChanged();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchMessages, leadId, rememberLocalMessage]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const leadChanged = previousLeadIdRef.current !== leadId;
    const messageCountIncreased = messages.length > previousMessageCountRef.current;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldScroll =
      leadChanged ||
      previousMessageCountRef.current === 0 ||
      (messageCountIncreased && distanceFromBottom < 120);

    if (shouldScroll) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: leadChanged ? "auto" : "smooth",
      });
    }

    previousLeadIdRef.current = leadId;
    previousMessageCountRef.current = messages.length;
  }, [leadId, messages]);

  if (!leadId) {
    return null;
  }

  return (
    <div ref={scrollRef} className="flex max-h-[500px] flex-col gap-4 overflow-y-auto p-2">
      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading conversation...
        </div>
      ) : null}

      {!loading && messages.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No messages yet.
        </div>
      ) : null}

      {messages.map((msg) => {
        const isInbound = msg.direction === "inbound";

        return (
          <div
            key={msg.id}
            className={cn(
              "relative flex max-w-[85%] flex-col",
              isInbound ? "self-start items-start" : "self-end items-end"
            )}
          >
            <div className="mb-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
              <span>{msg.sender_type.toUpperCase()}</span>
              <span>&bull;</span>
              <span>{format(new Date(msg.created_at), "h:mm a")}</span>
            </div>
            <div
              className={cn(
                "rounded-2xl px-4 py-2 text-sm shadow-sm",
                isInbound
                  ? "rounded-tl-none border border-border bg-card"
                  : msg.sender_type === "bot"
                    ? "rounded-tr-none border-primary/20 bg-primary/10 text-blue-900 dark:text-teal-100"
                    : "rounded-tr-none bg-primary text-primary-foreground"
              )}
            >
              {msg.content}
            </div>
            {msg.sender_type === "bot" ? (
              <div className="mx-1 mt-1 text-[10px] text-muted-foreground opacity-60">
                AI Generated
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
