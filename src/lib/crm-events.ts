const CONTACTS_CHANGED_EVENT = "crm:contacts-changed";
const MESSAGES_CHANGED_EVENT = "crm:messages-changed";

type MessageChangeDetail = {
  contactId: string;
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

export function notifyMessagesChanged(contactId: string) {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MessageChangeDetail>(MESSAGES_CHANGED_EVENT, {
      detail: { contactId },
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
  callback: () => void
) {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<MessageChangeDetail>).detail;

    if (detail?.contactId === contactId) {
      callback();
    }
  };

  window.addEventListener(MESSAGES_CHANGED_EVENT, handler);

  return () => {
    window.removeEventListener(MESSAGES_CHANGED_EVENT, handler);
  };
}
