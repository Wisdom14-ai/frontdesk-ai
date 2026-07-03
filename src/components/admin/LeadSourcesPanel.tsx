"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LeadSourceRow {
  id: string;
  clinic_id: string;
  label: string;
  match_phrase: string;
  created_at: string | null;
}

export function LeadSourcesPanel({ clinicId }: { clinicId: string }) {
  const [sources, setSources] = useState<LeadSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [matchPhrase, setMatchPhrase] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const base = `/api/admin/clinics/${clinicId}/lead-sources`;

  const loadSources = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) {
      setSources([]);
      setLoading(false);
      return;
    }
    const payload = (await res.json()) as { sources: LeadSourceRow[] };
    setSources(payload.sources);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  async function addSource() {
    setAddBusy(true);
    setAddError(null);
    setNotice(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, match_phrase: matchPhrase }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setAddError(payload.error ?? "Could not save the source.");
        return;
      }
      setLabel("");
      setMatchPhrase("");
      await loadSources();
    } finally {
      setAddBusy(false);
    }
  }

  async function remove(sourceId: string, sourceLabel: string) {
    if (!window.confirm(`Remove the "${sourceLabel}" source? Existing contacts keep their attribution.`)) {
      return;
    }
    setRowBusy(sourceId);
    setNotice(null);
    try {
      const res = await fetch(`${base}/${sourceId}`, { method: "DELETE" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(payload.error ?? "Failed to remove the source.");
        return;
      }
      await loadSources();
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead sources</CardTitle>
        <CardDescription>
          Map each wasap.my link&apos;s pre-filled opening phrase to a channel
          label (Google Ads, GMB, Referral, …). New contacts are attributed by
          matching their first message against these phrases. Dashboard and
          analytics group leads by the resulting label.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
            {notice}
          </div>
        ) : null}

        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_2fr_auto]">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Google Ads)"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <input
            value={matchPhrase}
            onChange={(e) => setMatchPhrase(e.target.value)}
            placeholder="Opening phrase (e.g. Hi! Saya nak tanya pasal rawatan yang diiklankan)"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void addSource()}
            disabled={!label.trim() || !matchPhrase.trim() || addBusy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {addBusy ? "Saving…" : "Add"}
          </button>
          {addError ? (
            <p className="text-xs text-destructive sm:col-span-3">{addError}</p>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading lead sources…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lead sources configured yet — every lead lands as
            &quot;whatsapp_inbound&quot; until you add one.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{source.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    &quot;{source.match_phrase}&quot;
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(source.id, source.label)}
                  disabled={rowBusy === source.id}
                  className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
