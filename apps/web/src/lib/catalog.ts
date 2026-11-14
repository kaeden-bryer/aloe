/**
 * Presentation-only lookups: colors, labels and copy that the design needs but
 * the API doesn't send (the API describes *what* is true; this file decides
 * how it looks). Everything here is keyed by the contract's enums, so adding a
 * new state to the contract surfaces as a type error right here.
 */
import type { CauseId, Dashboard, QueueTask, Schedule } from "@aloe/core/contracts";

/** Pastel cover color behind each cause's emoji (cards, project header). */
export const CAUSE_COVER: Record<CauseId, string> = {
  climate: "#E4EFF5",
  electric: "#FBF1D6",
  eco: "#E5F2E3",
  farming: "#F3ECE2",
  health: "#F7E7EB",
};

/** The five status pill looks from the design. */
export type PillTone = "merged" | "review" | "progress" | "open" | "decision";

export const PILL_STYLE: Record<PillTone, { background: string; color: string }> = {
  merged: { background: "#DBEDDB", color: "#1C3829" },
  review: { background: "#D3E5EF", color: "#183347" },
  progress: { background: "#FDECC8", color: "#402C1B" },
  open: { background: "#E3E2E0", color: "#32302C" },
  decision: { background: "#FADEC9", color: "#49290E" },
};

type TaskState = QueueTask["state"];

/** Queue task state -> pill tone + label shown on the project page. */
export const TASK_STATE_VIEW: Record<TaskState, { tone: PillTone; label: string }> = {
  queued: { tone: "open", label: "Open" },
  leased: { tone: "progress", label: "In progress" },
  submitted: { tone: "review", label: "In review" },
  verifying: { tone: "review", label: "In review" },
  escalated: { tone: "decision", label: "Needs a maintainer" },
  merged: { tone: "merged", label: "Merged" },
  closed: { tone: "open", label: "Closed" },
  done: { tone: "merged", label: "Done" },
};

type ActivityStatus = Dashboard["activity"][number]["status"];

/** Activity feed status -> pill tone + label. */
export const ACTIVITY_VIEW: Record<ActivityStatus, { tone: PillTone; label: string }> = {
  working: { tone: "progress", label: "Working on it" },
  verifying: { tone: "review", label: "Submitted" },
  merged: { tone: "merged", label: "Merged" },
  escalated: { tone: "decision", label: "Sent to a maintainer" },
  retry: { tone: "open", label: "Retrying" },
};

/**
 * Donation windows. The contract's ids differ from the prototype's
 * (overnight / idle / weekends), so the copy is mapped here in one place.
 */
export const SCHEDULES: { id: Schedule; label: string; desc: string }[] = [
  { id: "overnight", label: "Overnight", desc: "Runs while you sleep, before your quota resets" },
  { id: "anytime", label: "Whenever I am idle", desc: "Starts after 30 minutes without use" },
  { id: "workday", label: "During the workday", desc: "Runs on weekdays while you are busy elsewhere" },
];

export function scheduleLabel(id: Schedule): string {
  return (SCHEDULES.find((s) => s.id === id) ?? SCHEDULES[0]!).label;
}

/**
 * Chart colors follow the project (the entity), never its rank, so a project
 * keeps its color as the week's numbers change.
 */
const PROJECT_COLOR: Record<string, string> = {
  eae: "#2a78d6",
  biomass: "#eb6834",
  off: "#1baf7a",
  farmos: "#eda100",
  accessmod: "#e87ba4",
};
const FALLBACK_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#7b61d1", "#3aa6b9"];

export function projectColor(projectId: string): string {
  const known = PROJECT_COLOR[projectId];
  if (known) return known;
  // Stable hash so unknown ids still get the same color on every render.
  let h = 0;
  for (const ch of projectId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!;
}

/** Colors for the "Work by kind" bar, assigned in the order the API lists kinds. */
export const KIND_COLORS = ["#2F7D4F", "#7FBF95", "#B9DCC4", "#1C4A2F", "#4E9A6B", "#D7EBDD"];

export const REGISTRY_URL = "https://www.digitalpublicgoods.net/registry";
