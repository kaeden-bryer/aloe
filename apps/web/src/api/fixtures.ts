/**
 * Demo content for mock mode, taken from the design prototype's data().
 * Shapes follow @aloe/core/contracts; src/test/fixtures.test.ts parses them
 * with the real schemas so they can't drift from the API.
 */
import type { Cause, CauseId, Decision, DonorSettings, Me, ProjectDetail, QueueTask } from "@aloe/core/contracts";

export const causes: Cause[] = [
  { id: "climate", emoji: "🌎", name: "Climate Change", blurb: "Track forest carbon and cut emissions" },
  { id: "electric", emoji: "⚡️", name: "Electrification", blurb: "Bring clean, reliable power to everyone" },
  { id: "eco", emoji: "🌱", name: "Eco Friendliness", blurb: "Make greener everyday choices easier" },
  { id: "farming", emoji: "🐄", name: "Sustainable Farming", blurb: "Tools for healthier soil and food systems" },
  { id: "health", emoji: "💊", name: "Health", blurb: "Close gaps in access to care" },
];

const emojiOf = (id: CauseId) => causes.find((c) => c.id === id)!.emoji;

// The prototype's five task statuses, mapped onto real task states.
type DemoStatus = "merged" | "review" | "progress" | "open" | "decision";
const STATE: Record<DemoStatus, Pick<QueueTask, "state" | "who">> = {
  merged: { state: "merged", who: "Merged by steward" },
  review: { state: "verifying", who: "Second agent reviewing" },
  progress: { state: "leased", who: "A donor agent has the lease" },
  open: { state: "queued", who: "Waiting for a donor agent" },
  decision: { state: "escalated", who: "Escalated by steward" },
};

interface DemoProject {
  id: string;
  name: string;
  owner: string;
  cause: CauseId;
  also: CauseId[];
  type: string;
  region: string;
  tagline: string;
  about: string;
  url: string;
  repoUrl: string;
  tasks: { title: string; status: DemoStatus; category: QueueTask["category"] }[];
  decision: string;
  options: { id: string; label: string }[];
  backers: number;
  mergedThisWeek: number;
}

export const demoProjects: DemoProject[] = [
  {
    id: "eae", name: "Energy Access Explorer", owner: "World Resources Institute", cause: "electric", also: ["climate"],
    type: "Open software", region: "Africa and South Asia",
    tagline: "Maps where clean energy would do the most good.",
    about: "An open-source, interactive geospatial platform that helps governments, businesses and financiers find high-priority areas for energy access interventions. WRI says it has reached more than 100 governments across eight countries and over 25,000 users. It was registered as a digital public good in 2024, the first in the energy sector.",
    url: "https://github.com/energyaccessexplorer", repoUrl: "https://github.com/energyaccessexplorer/eae-client",
    tasks: [
      { title: "Add a data-quality check that flags outdated grid layers", status: "merged", category: "feature" },
      { title: "Write tests for the multi-criteria priority index", status: "review", category: "tests" },
      { title: "Speed up loading of 1 km raster layers", status: "progress", category: "feature" },
      { title: "Translate interface strings to Portuguese", status: "open", category: "docs" },
      { title: "Change the default weights for demand indicators", status: "decision", category: "interface" },
    ],
    decision: "Changing default weights changes which areas look like priorities, so a maintainer decides. Donor agents keep working on the rest of the queue.",
    options: [{ id: "approve", label: "Approve new weights" }, { id: "keep", label: "Keep current weights" }],
    backers: 212, mergedThisWeek: 11,
  },
  {
    id: "biomass", name: "Biomass Prediction Model", owner: "vertify.earth", cause: "climate", also: [],
    type: "Open AI model", region: "Forest carbon monitoring",
    tagline: "Estimates forest biomass from satellite imagery.",
    about: "An open AI model that predicts above-ground forest biomass from multi-spectral satellite imagery, built by vertify.earth for the GIZ Forest Forward initiative to support sustainable forest management and carbon monitoring. Its model card notes limited validation in some ecosystems, such as mangroves and wetlands.",
    url: "https://huggingface.co/vertify/biomass-model", repoUrl: "https://huggingface.co/vertify/biomass-model",
    tasks: [
      { title: "Package inference as a command-line tool", status: "merged", category: "feature" },
      { title: "Write tests for GeoTIFF band checks", status: "review", category: "tests" },
      { title: "Add a validation report for mangrove and wetland sites", status: "progress", category: "docs" },
      { title: "Document the required Sentinel-1 and Sentinel-2 bands", status: "open", category: "docs" },
      { title: "Publish a new model version", status: "decision", category: "release" },
    ],
    decision: "Releases always go to a human, so a maintainer signs off before a new model version is published.",
    options: [{ id: "publish", label: "Publish the release" }, { id: "hold", label: "Hold for more validation" }],
    backers: 96, mergedThisWeek: 6,
  },
  {
    id: "off", name: "Open Food Facts", owner: "Open Food Facts (non-profit)", cause: "eco", also: ["health"],
    type: "Open data", region: "Global",
    tagline: "The open database of the food we buy.",
    about: "A collaborative, open database of food products, often called the Wikipedia of food. Its data is used in more than 1,000 peer-reviewed papers on health and sustainability, and the project has a partnership with Santé publique France. It was added to the DPG registry in December 2024.",
    url: "https://world.openfoodfacts.org", repoUrl: "https://github.com/openfoodfacts/openfoodfacts-server",
    tasks: [
      { title: "Add tests for ingredient-parsing edge cases", status: "merged", category: "tests" },
      { title: "Improve the docs for the public read API", status: "review", category: "docs" },
      { title: "Flag products that are missing packaging data", status: "progress", category: "feature" },
      { title: "Clean up duplicate category translations", status: "open", category: "lint" },
      { title: "Change how environmental impact appears on product pages", status: "decision", category: "interface" },
    ],
    decision: "How impact is shown to shoppers is a judgment about what counts as good, so it goes to a maintainer.",
    options: [{ id: "ship", label: "Ship the new layout" }, { id: "revise", label: "Ask for a revision" }],
    backers: 344, mergedThisWeek: 19,
  },
  {
    id: "farmos", name: "farmOS", owner: "farmOS community", cause: "farming", also: ["eco"],
    type: "Open software", region: "Global",
    tagline: "Farm management, planning and record keeping.",
    about: "A web-based application for farm management, planning and record keeping. Farmers use it to track operations and trace food from seed to sale, and researchers use it to compare lab results against soil-health practices. It has been a digital public good since 2022.",
    url: "https://farmos.org", repoUrl: "https://github.com/farmOS/farmOS",
    tasks: [
      { title: "Write API tests for quantity logs", status: "merged", category: "tests" },
      { title: "Add timezone tests for recurring logs", status: "review", category: "tests" },
      { title: "Add CSV import for soil test results", status: "progress", category: "feature" },
      { title: "Improve the farm map layer docs", status: "open", category: "docs" },
      { title: "Change the data model for harvest records", status: "decision", category: "interface" },
    ],
    decision: "Data model changes affect every farm using farmOS, so the steward sent this one to a maintainer.",
    options: [{ id: "approve", label: "Approve the change" }, { id: "defer", label: "Defer to next release" }],
    backers: 128, mergedThisWeek: 9,
  },
  {
    id: "accessmod", name: "AccessMod", owner: "University of Geneva GeoHealth group", cause: "health", also: [],
    type: "Open software", region: "Low- and middle-income countries",
    tagline: "Models how far people are from health care.",
    about: "A free, open-source WHO-supported tool that models physical access to health services: travel time to the nearest facility, coverage when facilities lack staff or equipment, and referral times between facilities. Ministries of health use it to plan where new capacity helps most.",
    url: "https://www.accessmod.org", repoUrl: "https://github.com/unige-geohealth/accessmod",
    tasks: [
      { title: "Add tests for referral-time analysis", status: "merged", category: "tests" },
      { title: "Write a guide to scaling-up scenarios", status: "review", category: "docs" },
      { title: "Speed up travel-time surface computation", status: "progress", category: "feature" },
      { title: "Validate road-speed tables on import", status: "open", category: "feature" },
      { title: "Export patient location data in a new format", status: "decision", category: "personal-data" },
    ],
    decision: "Anything touching personal data always goes to a human, so a maintainer reviews this export.",
    options: [{ id: "approve", label: "Approve with anonymisation" }, { id: "reject", label: "Reject the export" }],
    backers: 87, mergedThisWeek: 8,
  },
];

/** Builds the API's ProjectDetail for one demo project. */
export function toProjectDetail(p: DemoProject, opts: { backing: boolean; decisionOpen: boolean; resolution?: string | null }): ProjectDetail {
  const queue: QueueTask[] = p.tasks.map((t, i) => {
    const resolved = t.status === "decision" && !opts.decisionOpen;
    return {
      id: `${p.id}-t${i + 1}`,
      title: t.title,
      kind: "code",
      category: t.category,
      ...(resolved ? { state: "queued", who: "Decided by a maintainer" } : STATE[t.status]),
    };
  });
  const decisionTask = queue.find((_, i) => p.tasks[i]!.status === "decision")!;
  const decision: Decision = {
    id: `${p.id}-d1`,
    projectId: p.id,
    projectName: p.name,
    projectEmoji: emojiOf(p.cause),
    taskId: decisionTask.id,
    question: `"${decisionTask.title}". ${p.decision}`,
    options: p.options,
    status: opts.decisionOpen ? "open" : "resolved",
    resolution: opts.resolution ?? null,
    createdAt: Date.UTC(2026, 10, 12, 9, 30),
  };
  return {
    id: p.id,
    name: p.name,
    emoji: emojiOf(p.cause),
    owner: p.owner,
    cause: p.cause,
    alsoCauses: p.also,
    tagline: p.tagline,
    type: p.type,
    region: p.region,
    backing: opts.backing,
    openTasks: queue.filter((t) => t.state !== "merged").length,
    mergedThisWeek: p.mergedThisWeek,
    about: p.about,
    url: p.url,
    repoUrl: p.repoUrl,
    queue,
    openDecision: opts.decisionOpen ? decision : null,
    backers: p.backers + (opts.backing ? 1 : 0),
  };
}

export function decisionFor(p: DemoProject, status: "open" | "resolved", resolution: string | null): Decision {
  const d = toProjectDetail(p, { backing: false, decisionOpen: true }).openDecision!;
  return { ...d, status, resolution };
}

export const defaultSettings: DonorSettings = {
  causes: [],
  pct: 50,
  schedule: "overnight",
  paused: false,
  weeklyEmail: true,
  decisionAlerts: true,
};

export const baseMe: Omit<Me, "settings" | "backings"> = {
  id: "demo-donor",
  name: "Kaeden Bryer",
  email: "kaeden@example.org",
  devices: [{ id: "dev-1", name: "Kaeden's laptop (Claude Pro)", lastSeenAt: Date.UTC(2026, 10, 14, 8, 0) }],
};

/**
 * One week of demo work per project, oldest day first (7 days ending today).
 * projectMerges = merges from every donor on that project this week.
 */
export const WEEK: Record<string, { days: number[]; submitted: number; kinds: Record<"Tests" | "Docs" | "Fixes" | "Features", number>; released: boolean; projectMerges: number }> = {
  eae: { days: [0, 1, 0, 1, 0, 0, 1], submitted: 3, kinds: { Tests: 1, Docs: 0, Fixes: 1, Features: 1 }, released: true, projectMerges: 11 },
  biomass: { days: [0, 0, 1, 0, 0, 1, 0], submitted: 3, kinds: { Tests: 1, Docs: 1, Fixes: 0, Features: 0 }, released: false, projectMerges: 6 },
  off: { days: [0, 0, 0, 1, 1, 0, 0], submitted: 2, kinds: { Tests: 1, Docs: 1, Fixes: 0, Features: 0 }, released: true, projectMerges: 19 },
  farmos: { days: [0, 1, 0, 0, 1, 0, 0], submitted: 2, kinds: { Tests: 2, Docs: 0, Fixes: 0, Features: 0 }, released: true, projectMerges: 9 },
  accessmod: { days: [0, 0, 1, 0, 0, 0, 1], submitted: 3, kinds: { Tests: 1, Docs: 1, Fixes: 0, Features: 0 }, released: false, projectMerges: 8 },
};

export const platformStats = [
  { value: "214", label: "Tasks merged across Aloe" },
  { value: "1,380", label: "Donor agents active" },
  { value: String(demoProjects.length), label: "Vetted projects" },
  { value: "22 min", label: "Median maintainer time per project" },
];
