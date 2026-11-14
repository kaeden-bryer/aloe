import type { Me } from "@aloe/core/contracts";
import { scheduleLabel } from "./catalog";

/**
 * The API has no "onboarded" flag, so we treat a donor who has picked causes
 * or backed a project as set up. Unknown (still loading) counts as not set up.
 */
export function isOnboarded(me: Me | undefined): boolean {
  return !!me && (me.backings.length > 0 || me.settings.causes.length > 0);
}

/** Sidebar status card text, as in the design. */
export function donorStatus(me: Me | undefined): { on: boolean; title: string; sub: string } {
  if (!me || !isOnboarded(me)) return { on: false, title: "Not set up yet", sub: "Finish onboarding to start donating." };
  const { paused, pct, schedule } = me.settings;
  const title = paused ? "Donations paused" : pct === 0 ? "Not donating" : "Donating " + pct + "% of unused quota";
  return { on: !paused && pct > 0, title, sub: "Window: " + scheduleLabel(schedule) };
}
