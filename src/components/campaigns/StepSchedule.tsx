"use client";

export interface ScheduleState {
  sendNow: boolean;
  date: string;
  time: string;
  dailySendCap: number;
  stopOnInvalidNumber: boolean;
}

interface StepScheduleProps {
  schedule: ScheduleState;
  launching: boolean;
  onChange: (schedule: ScheduleState) => void;
  onBack: () => void;
  onLaunch: () => void;
}

export function StepSchedule({
  schedule,
  launching,
  onChange,
  onBack,
  onLaunch,
}: StepScheduleProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 text-[11px]">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={schedule.sendNow}
            onChange={() => onChange({ ...schedule, sendNow: true })}
          />
          Send now
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!schedule.sendNow}
            onChange={() => onChange({ ...schedule, sendNow: false })}
          />
          Schedule for later
        </label>
      </div>

      {!schedule.sendNow ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={schedule.date}
            onChange={(event) => onChange({ ...schedule, date: event.target.value })}
            className="h-8 rounded-[6px] border border-[var(--border-default)] px-2 text-[11px]"
          />
          <input
            type="time"
            value={schedule.time}
            onChange={(event) => onChange({ ...schedule, time: event.target.value })}
            className="h-8 rounded-[6px] border border-[var(--border-default)] px-2 text-[11px]"
          />
        </div>
      ) : null}

      <label className="block text-[11px] font-medium">
        Daily send cap
        <input
          type="number"
          min="1"
          value={schedule.dailySendCap}
          onChange={(event) =>
            onChange({ ...schedule, dailySendCap: Number(event.target.value) || 1 })
          }
          className="mt-1 h-8 w-full rounded-[6px] border border-[var(--border-default)] px-2"
        />
      </label>

      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={schedule.stopOnInvalidNumber}
          onChange={(event) =>
            onChange({ ...schedule, stopOnInvalidNumber: event.target.checked })
          }
        />
        Stop on invalid number
      </label>

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
          onClick={onLaunch}
          disabled={launching || (!schedule.sendNow && (!schedule.date || !schedule.time))}
          className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {launching ? "Launching..." : "Launch campaign"}
        </button>
      </div>
    </div>
  );
}
