"use client";

import type { MessageTemplate } from "@/types/app.types";

export interface MessageState {
  name: string;
  body: string;
  templateId: string;
}

interface StepMessageProps {
  message: MessageState;
  templates: MessageTemplate[];
  onChange: (message: MessageState) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepMessage({
  message,
  templates,
  onChange,
  onBack,
  onNext,
}: StepMessageProps) {
  return (
    <div className="space-y-4">
      <label className="block text-[11px] font-medium">
        Campaign name
        <input
          value={message.name}
          onChange={(event) => onChange({ ...message, name: event.target.value })}
          className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 outline-none focus:border-[var(--brand-gold-border)]"
        />
      </label>

      <label className="block text-[11px] font-medium">
        Pick from templates
        <select
          value={message.templateId}
          onChange={(event) => {
            const template = templates.find((item) => item.id === event.target.value);
            onChange({
              ...message,
              templateId: event.target.value,
              body: template?.body ?? message.body,
            });
          }}
          className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 outline-none focus:border-[var(--brand-gold-border)]"
        >
          <option value="">Write custom</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-[11px] font-medium">
        Message
        <textarea
          value={message.body}
          onChange={(event) => onChange({ ...message, body: event.target.value })}
          rows={7}
          className="mt-1 w-full resize-none rounded-[6px] border border-[var(--border-default)] p-2 outline-none focus:border-[var(--brand-gold-border)]"
        />
      </label>
      <p className="text-[10px] text-[var(--text-muted)]">
        Variables: {"{nama}"}, {"{masa}"}, {"{tarikh}"}
      </p>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-[6px] border border-[var(--border-default)] px-3 py-1.5 text-[11px]"
        >
          &lt;- Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!message.name.trim() || !message.body.trim()}
          className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          Next -&gt;
        </button>
      </div>
    </div>
  );
}
