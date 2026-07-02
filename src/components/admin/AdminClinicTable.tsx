"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { ClinicOverviewRow } from "@/lib/server/admin-analytics";

type SortKey =
  | "name"
  | "messages_30d"
  | "ai_spend_usd_30d"
  | "total_contacts"
  | "created_at";

function statusVariant(status: string | null) {
  switch (status) {
    case "active":
    case "received":
    case "connected":
      return "default" as const;
    case "paused":
    case "pending":
    case "pending_qr":
      return "secondary" as const;
    case "cancelled":
    case "churned":
    case "disconnected":
    case "not_connected":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function fmtUsd(n: number) {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

/** The bot only actually replies when all three gates are green. */
function isBotLive(r: ClinicOverviewRow) {
  return (
    r.payment_status === "received" &&
    r.subscription_status === "active" &&
    r.whatsapp_status === "connected"
  );
}

/** A clinic is a "problem" (float to top) when the bot can't run or recently skipped. */
function isProblem(r: ClinicOverviewRow) {
  return !isBotLive(r) || Boolean(r.last_bot_skip_reason);
}

export function AdminClinicTable({ rows }: { rows: ClinicOverviewRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("messages_30d");
  const [asc, setAsc] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q))
      : [...rows];
    list.sort((a, b) => {
      // Problem clinics always float to the top, regardless of column sort.
      const problemCmp = Number(isProblem(b)) - Number(isProblem(a));
      if (problemCmp !== 0) return problemCmp;

      let cmp: number;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "created_at") {
        cmp =
          new Date(a.created_at ?? 0).getTime() -
          new Date(b.created_at ?? 0).getTime();
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return asc ? cmp : -cmp;
    });
    return list;
  }, [rows, query, sortKey, asc]);

  const problemCount = useMemo(() => rows.filter(isProblem).length, [rows]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(false);
    }
  }

  const headers: { key: SortKey; label: string; num?: boolean }[] = [
    { key: "name", label: "Clinic" },
    { key: "total_contacts", label: "Contacts", num: true },
    { key: "messages_30d", label: "Msgs 30d", num: true },
    { key: "ai_spend_usd_30d", label: "AI spend 30d", num: true },
    { key: "created_at", label: "Signed up" },
  ];

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search clinics by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              {headers.map((h) => (
                <th
                  key={h.key}
                  onClick={() => toggleSort(h.key)}
                  className={`cursor-pointer select-none px-4 py-3 font-medium ${
                    h.num ? "text-right" : "text-left"
                  }`}
                >
                  {h.label}
                  {sortKey === h.key ? (asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className="border-t border-border hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/clinics/${r.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {r.plan_type ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.total_contacts}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.messages_30d}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtUsd(r.ai_spend_usd_30d)}
                </td>
                <td className="px-4 py-3">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={statusVariant(r.subscription_status)}>
                      sub:{r.subscription_status ?? "?"}
                    </Badge>
                    <Badge variant={statusVariant(r.payment_status)}>
                      pay:{r.payment_status ?? "?"}
                    </Badge>
                    <Badge variant={statusVariant(r.whatsapp_status)}>
                      wa:{r.whatsapp_status ?? "?"}
                    </Badge>
                    <Badge variant={isBotLive(r) ? "default" : "destructive"}>
                      {isBotLive(r) ? "bot live" : "bot off"}
                    </Badge>
                    {r.last_bot_skip_reason ? (
                      <Badge
                        variant="destructive"
                        title={`Last skip: ${r.last_bot_skip_reason}${
                          r.last_bot_skip_at
                            ? ` at ${new Date(r.last_bot_skip_at).toLocaleString()}`
                            : ""
                        }`}
                      >
                        ⚠ {r.last_bot_skip_reason}
                      </Badge>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  No clinics match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {rows.length} clinics ·{" "}
        {problemCount > 0 ? (
          <span className="font-medium text-destructive">
            {problemCount} need attention (sorted to top)
          </span>
        ) : (
          <span className="text-emerald-600">all bots live</span>
        )}{" "}
        · click a column to sort · click a clinic to drill down
      </p>
    </div>
  );
}
