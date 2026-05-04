"use client";

import { BookOpen, Loader2, Plus } from "lucide-react";
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
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

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

  async function loadStarterTemplates() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/templates/seed", { method: "POST" });
      const payload = (await res.json()) as {
        inserted?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok || payload.error) {
        setSeedResult(payload.error ?? "Failed to load starter templates.");
      } else {
        const { inserted = 0, skipped = 0 } = payload;
        if (inserted === 0) {
          setSeedResult("All starter templates are already loaded.");
        } else {
          setSeedResult(
            `Loaded ${inserted} starter template${inserted !== 1 ? "s" : ""}${skipped > 0 ? ` (${skipped} already existed)` : ""}.`
          );
          await loadTemplates();
        }
      }
    } catch {
      setSeedResult("Network error — please try again.");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-white">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadStarterTemplates()}
            disabled={seeding}
            title="Load pre-built templates for dental, aesthetic & GP clinics"
            className="flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border-subtle)] bg-white px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            {seeding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookOpen className="h-3.5 w-3.5" />
            )}
            Starter templates
          </button>
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
      </div>
      {seedResult && (
        <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          {seedResult}
          <button
            type="button"
            onClick={() => setSeedResult(null)}
            className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            ✕
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto fd-scrollbar">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-[11px] text-[var(--text-muted)]">No templates yet.</p>
            <button
              type="button"
              onClick={() => void loadStarterTemplates()}
              disabled={seeding}
              className="flex items-center gap-1.5 rounded-[6px] border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {seeding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <BookOpen className="h-3.5 w-3.5" />
              )}
              Load starter templates
            </button>
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
