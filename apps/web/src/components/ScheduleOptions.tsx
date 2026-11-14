import type { Schedule } from "@aloe/core/contracts";
import { SCHEDULES } from "../lib/catalog";

/** The three donation-window tiles, used by onboarding and settings. */
export function ScheduleOptions({
  value,
  onChange,
  compact = false,
}: {
  value: Schedule;
  onChange: (s: Schedule) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "schedule-grid is-compact" : "schedule-grid"}>
      {SCHEDULES.map((s) => (
        <button key={s.id} type="button" className="tile schedule-tile" aria-pressed={value === s.id} onClick={() => onChange(s.id)}>
          <span className="l">{s.label}</span>
          <span className="d">{s.desc}</span>
        </button>
      ))}
    </div>
  );
}
