/** Calendar helpers. They use the server's local time zone: the demo runs on one laptop. */

export const DAY_MS = 24 * 60 * 60 * 1000;

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function startOfDay(ts: number): number {
  return new Date(ts).setHours(0, 0, 0, 0);
}

/** Monday 00:00 of the week containing `ts`. */
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const sinceMonday = (d.getDay() + 6) % 7;
  return d.setDate(d.getDate() - sinceMonday);
}

/** Add calendar days (not 24h blocks), so daylight-saving changes don't shift midnight. */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  return d.setDate(d.getDate() + days);
}

/** "Mon 9 to Sun 15 November", or "Mon 30 November to Sun 6 December" across months. */
export function weekLabel(now: number): string {
  const mon = new Date(startOfWeek(now));
  const sun = new Date(addDays(mon.getTime(), 6));
  const monMonth = MONTHS[mon.getMonth()]!;
  const sunMonth = MONTHS[sun.getMonth()]!;
  return monMonth === sunMonth
    ? `Mon ${mon.getDate()} to Sun ${sun.getDate()} ${sunMonth}`
    : `Mon ${mon.getDate()} ${monMonth} to Sun ${sun.getDate()} ${sunMonth}`;
}

/** { label: "Mon", long: "Monday 9 Nov" } */
export function dayLabels(ts: number): { label: string; long: string } {
  const d = new Date(ts);
  return {
    label: SHORT_DAYS[d.getDay()]!,
    long: `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}`,
  };
}

/** "just now", "38 min ago", "3 h ago", "2 days ago" */
export function ago(ts: number, now: number): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
