/** Small pure text helpers. Pure = easy to unit test (see src/test). */

export function pctHint(pct: number): string {
  return pct === 0
    ? "At 0%, Aloe stays off. Raise it whenever you are ready."
    : "If 10 agent-hours would expire this week, about " + pct / 10 + " of them go to your causes.";
}

/** "https://world.openfoodfacts.org/" -> "world.openfoodfacts.org" */
export function urlLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** "Kaeden Bryer" -> "KB" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Activity timestamps as the design shows them: "Today 02:12",
 * "Yesterday 01:06", "Wed 00:24". `now` is a parameter so tests are stable.
 */
export function formatWhen(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const startOf = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const dayDiff = Math.round((startOf(now) - startOf(ts)) / 86_400_000);
  const day = dayDiff === 0 ? "Today" : dayDiff === 1 ? "Yesterday" : DAYS[d.getDay()]!;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}
