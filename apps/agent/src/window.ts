/**
 * Donation windows: when a donor is happy for their machine to do Aloe work.
 *
 *   overnight  22:00 - 07:00   (wraps past midnight)
 *   workday    09:00 - 17:00
 *   anytime    always
 *
 * Times are the donor's local clock, because "overnight" means *their* night.
 */
import type { Schedule } from "@aloe/core/contracts";

const WINDOWS: Record<Exclude<Schedule, "anytime">, { start: number; end: number }> = {
  overnight: { start: 22, end: 7 },
  workday: { start: 9, end: 17 },
};

export function isInWindow(schedule: Schedule, at: Date): boolean {
  if (schedule === "anytime") return true;
  const { start, end } = WINDOWS[schedule];
  const hour = at.getHours();
  // A window whose end is "before" its start wraps midnight: 22..24 or 0..7.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Milliseconds until the window next opens; 0 if we're inside it now. */
export function msUntilWindowOpens(schedule: Schedule, at: Date): number {
  if (isInWindow(schedule, at)) return 0;
  const { start } = WINDOWS[schedule as Exclude<Schedule, "anytime">];
  const opens = new Date(at);
  opens.setHours(start, 0, 0, 0);
  if (opens <= at) opens.setDate(opens.getDate() + 1);
  return opens.getTime() - at.getTime();
}
