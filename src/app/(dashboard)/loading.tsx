export default function DashboardLoading() {
  return (
    <div className="flex-1 animate-pulse p-5">
      <div className="h-5 w-44 rounded bg-[var(--surface-subtle)]" />
      <div className="mt-2 h-3 w-72 rounded bg-[var(--surface-subtle)]" />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[72px] rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-raised)]"
          />
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="h-[320px] rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-raised)]" />
        <div className="h-[320px] rounded-[8px] border border-[var(--border-subtle)] bg-[var(--surface-raised)]" />
      </div>
    </div>
  );
}
