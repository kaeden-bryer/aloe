import type { Cause, CauseId, Dashboard } from "@aloe/core/contracts";

type Landed = Dashboard["landed"][number];

export interface SharePost {
  headline: string;
  sub: string;
  chips: string[];
  postText: string;
  links: { x: string; linkedIn: string; bluesky: string };
}

/** "A", "A and B", "A, B and 2 more" */
export function joinNames(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : names.slice(0, 2).join(", ") + " and " + (names.length - 2) + " more";
}

/**
 * Builds the "Share your week" card and post text from dashboard data.
 * `causeOf` maps a project id to its main cause (from the projects list).
 */
export function buildSharePost(
  landed: Landed[],
  causeOf: (projectId: string) => CauseId | undefined,
  causes: Cause[],
): SharePost {
  const merged = landed.reduce((sum, p) => sum + p.merged, 0);
  const n = landed.length;

  const causeIds: CauseId[] = [];
  for (const p of landed) {
    const c = causeOf(p.projectId);
    if (c && !causeIds.includes(c)) causeIds.push(c);
  }
  const causeNames = causeIds.map((id) => causes.find((c) => c.id === id)?.name.toLowerCase() ?? id);

  const postText =
    "This week my unused AI quota shipped " +
    merged +
    " verified improvements to open-source " +
    (n === 1 ? "project " : "projects like ") +
    joinNames(landed.map((p) => p.name)) +
    ", through Aloe. Every merge checked, my own work never interrupted. 🌱";

  // encodeURIComponent so emoji, commas and "&" survive inside the query string.
  const enc = encodeURIComponent(postText);
  return {
    headline: merged + " improvements shipped",
    sub: "to " + n + (n === 1 ? " open-source project" : " open-source projects") + " for " + causeNames.join(", "),
    chips: landed.map((p) => p.emoji + " " + p.name),
    postText,
    links: {
      x: "https://twitter.com/intent/tweet?text=" + enc,
      linkedIn: "https://www.linkedin.com/feed/?shareActive=true&text=" + enc,
      bluesky: "https://bsky.app/intent/compose?text=" + enc,
    },
  };
}
