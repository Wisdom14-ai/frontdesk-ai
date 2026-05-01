"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { TemplateModal } from "@/components/campaigns/TemplateModal";
import { TemplateRow } from "@/components/campaigns/TemplateRow";
import type { MessageTemplate } from "@/types/app.types";

interface TemplateListProps {
  title?: string;
}

export function TemplateList({ title = "Templates" }: TemplateListProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function loadTemplates() {
    const response = await fetch("/api/templates", { cache: "no-store" });
    if (!response.ok) {
      setTemplates([]);
      return;
    }
    const payload = (await response.json()) as { templates: MessageTemplate[] };
    setTemplates(payload.templates);
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  async function deleteTemplate(template: MessageTemplate) {
    await fetch(`/api/templates/${template.id}`, { method: "DELETE" });
    await loadTemplates();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => {
            setEditingTemplate(null);
            setModalOpen(true);
          }}
          className="flex h-7 items-center gap-1 rounded-[6px] bg-[var(--brand-gold)] px-2.5 text-[11px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New template
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto fd-scrollbar">
        {templates.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
            No templates
          </div>
        ) : (
          templates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onEdit={(nextTemplate) => {
                setEditingTemplate(nextTemplate);
                setModalOpen(true);
              }}
              onDelete={(nextTemplate) => {
                void deleteTemplate(nextTemplate);
              }}
            />
          ))
        )}
      </div>
      <TemplateModal
        open={modalOpen}
        template={editingTemplate}
        onClose={() => setModalOpen(false)}
        onSaved={() => void loadTemplates()}
      />
    </section>
  );
}
