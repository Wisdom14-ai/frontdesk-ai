"use client";

import { useEffect, useState } from "react";

import type { MessageTemplate, TemplateCategory } from "@/types/app.types";

interface TemplateModalProps {
  template?: MessageTemplate | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: Array<{ value: TemplateCategory; label: string }> = [
  { value: "reminder", label: "Reminder" },
  { value: "promo", label: "Promo" },
  { value: "nurture", label: "Nurture" },
  { value: "follow_up", label: "Follow-up" },
  { value: "custom", label: "Custom" },
];

export function TemplateModal({ template, open, onClose, onSaved }: TemplateModalProps) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("custom");
  const [quickReply, setQuickReply] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(template?.name ?? "");
    setBody(template?.body ?? "");
    setCategory(template?.category ?? "custom");
    setQuickReply(template?.show_as_quick_reply ?? false);
  }, [template, open]);

  if (!open) {
    return null;
  }

  async function saveTemplate() {
    if (!name.trim() || !body.trim()) {
      return;
    }

    setSaving(true);
    await fetch(template ? `/api/templates/${template.id}` : "/api/templates", {
      method: template ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        body: body.trim(),
        category,
        show_as_quick_reply: quickReply,
      }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
      <div className="w-[420px] rounded-[8px] border border-[var(--border-default)] bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">
            {template ? "Edit template" : "New template"}
          </h2>
          <button type="button" onClick={onClose} className="text-[12px] text-[var(--text-muted)]">
            Close
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-[11px] font-medium">
            Template name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 outline-none focus:border-[var(--brand-gold-border)]"
            />
          </label>
          <label className="block text-[11px] font-medium">
            Body
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={7}
              className="mt-1 w-full resize-none rounded-[6px] border border-[var(--border-default)] p-2 outline-none focus:border-[var(--brand-gold-border)]"
            />
          </label>
          <p className="text-[10px] text-[var(--text-muted)]">
            Variables: {"{nama}"}, {"{masa}"}, {"{tarikh}"}
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="block text-[11px] font-medium">
              Category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as TemplateCategory)}
                className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2 outline-none focus:border-[var(--brand-gold-border)]"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-6 flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={quickReply}
                onChange={(event) => setQuickReply(event.target.checked)}
              />
              Quick reply
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-[var(--border-default)] px-3 py-1.5 text-[11px]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !name.trim() || !body.trim()}
            onClick={() => void saveTemplate()}
            className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            Save template
          </button>
        </div>
      </div>
    </div>
  );
}
