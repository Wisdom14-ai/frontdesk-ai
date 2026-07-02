import type { GoLiveChecklist as Checklist } from "@/lib/server/admin-analytics";
import { describeBotSkipReason } from "@/lib/server/bot-skip-observability";

export function GoLiveChecklist({
  checklist,
  lastBotSkipReason,
  lastBotSkipAt,
}: {
  checklist: Checklist;
  lastBotSkipReason: string | null;
  lastBotSkipAt: string | null;
}) {
  const { checks, live, failing } = checklist;
  const skipDetail = describeBotSkipReason(lastBotSkipReason);

  return (
    <div
      className={`rounded-lg border p-4 ${
        live
          ? "border-emerald-300 bg-emerald-50"
          : "border-destructive/40 bg-destructive/10"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {live ? "✓ Bot is live for this clinic" : "⚠ Bot is NOT live for this clinic"}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            live ? "bg-emerald-600 text-white" : "bg-destructive text-white"
          }`}
        >
          {checks.filter((c) => c.ok).length}/{checks.length} ready
        </span>
      </div>

      {!live ? (
        <p className="mt-1 text-sm text-destructive">
          reason(s): {failing.map((c) => c.label).join(" · ")}
        </p>
      ) : null}

      {skipDetail ? (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Last skip: {skipDetail}
          {lastBotSkipAt
            ? ` (${new Date(lastBotSkipAt).toLocaleString()})`
            : ""}
        </p>
      ) : null}

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2 text-sm">
            <span className={check.ok ? "text-emerald-600" : "text-destructive"}>
              {check.ok ? "✓" : "✗"}
            </span>
            <span>
              <span className="font-medium">{check.label}</span>
              <span className="block text-xs text-muted-foreground">
                {check.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
