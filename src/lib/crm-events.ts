import type { Message } from "@/types";

const CONTACTS_CHANGED_EVENT = "crm:contacts-changed";
const MESSAGES_CHANGED_EVENT = "crm:messages-changed";

export type MessageChangeDetail = {
  contactId: string;
  message?: Message;
};

function hasWindow() {
  return typeof window !== "undefined";
}

export function notifyContactsChanged() {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(new Event(CONTACTS_CHANGED_EVENT));
}

export function notifyMessagesChanged(contactId: string, message?: Message) {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MessageChangeDetail>(MESSAGES_CHANGED_EVENT, {
      detail: { contactId, message },
    })
  );
}

export function subscribeToContactsChanged(callback: () => void) {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = () => {
    callback();
  };

  window.addEventListener(CONTACTS_CHANGED_EVENT, handler);

  return () => {
    window.removeEventListener(CONTACTS_CHANGED_EVENT, handler);
  };
}

export function subscribeToMessagesChanged(
  contactId: string,
  callback: (detail: MessageChangeDetail) => void
) {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<MessageChangeDetail>).detail;

    if (detail?.contactId === contactId) {
      callback(detail);
    }
  };

  window.addEventListener(MESSAGES_CHANGED_EVENT, handler);

  return () => {
    window.removeEventListener(MESSAGES_CHANGED_EVENT, handler);
  };
}
