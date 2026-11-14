/**
 * A tiny in-browser fake of the Aloe API, used when VITE_USE_MOCKS=1.
 *
 * It answers the same routes as apps/server with the same JSON shapes, so the
 * rest of the app can't tell the difference (client.ts still Zod-parses every
 * response). State lives in localStorage so a page reload keeps your choices,
 * and "Reset demo" wipes it.
 */
import { DonorSettings, ResolveDecisionRequest, type Dashboard, type Decision, type Me } from "@aloe/core/contracts";
import {
  WEEK,
  baseMe,
  causes,
  decisionFor,
  defaultSettings,
  demoProjects,
  platformStats,
  toProjectDetail,
} from "./fixtures";
import { maintainerRoute } from "./mockMaintainer";

interface MockState {
  settings: DonorSettings;
  backings: string[];
  /** projectId -> chosen option label, once a maintainer resolved the decision. */
  resolved: Record<string, string>;
}

const STORAGE_KEY = "aloe-mock-state";

const freshState = (): MockState => ({ settings: { ...defaultSettings }, backings: [], resolved: {} });

function load(): MockState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return { ...freshState(), ...(JSON.parse(raw) as MockState) };
  } catch {
    /* private mode or bad JSON: start fresh */
  }
  return freshState();
}

let state = load();

function save() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Test hook: replace the whole state (and skip localStorage). */
export function __setMockState(next: Partial<MockState>) {
  state = { ...freshState(), ...next };
}

const project = (id: string) => demoProjects.find((p) => p.id === id);
const detail = (id: string) => {
  const p = project(id)!;
  return toProjectDetail(p, {
    backing: state.backings.includes(id),
    decisionOpen: !(id in state.resolved),
    resolution: state.resolved[id] ?? null,
  });
};

function me(): Me {
  return { ...baseMe, settings: state.settings, backings: [...state.backings] };
}

function openDecisions(): Decision[] {
  return demoProjects.filter((p) => !(p.id in state.resolved)).map((p) => decisionFor(p, "open", null));
}

// ---------- Dashboard ----------

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekLabel(now: number): string {
  const today = startOfDay(now);
  const mon = new Date(today);
  mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const monMonth = mon.getMonth() === sun.getMonth() ? "" : " " + MONTH[mon.getMonth()];
  return `Mon ${mon.getDate()}${monMonth} to Sun ${sun.getDate()} ${MONTH[sun.getMonth()]}`;
}

const LIVE_STAGES = ["claimed", "working", "verify", "merge"] as const;

export function buildMockDashboard(now: number = Date.now()): Dashboard {
  const mine = state.backings.filter((id) => project(id) && WEEK[id]);
  const sum = (f: (w: (typeof WEEK)[string]) => number) => mine.reduce((a, id) => a + f(WEEK[id]!), 0);
  const merged = sum((w) => w.days.reduce((a, b) => a + b, 0));
  const submitted = sum((w) => w.submitted);
  const accept = submitted ? Math.round((merged / submitted) * 100) : 0;
  const lastWeek = Math.max(1, merged - 3);
  const pct = state.settings.pct;
  const hours = Math.round(13 * (pct / 100) * 10) / 10; // demo: 13 agent-hours would have expired

  const today = startOfDay(now);
  const dayStart = (i: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return d;
  };

  const mergedPerDay = Array.from({ length: 7 }, (_, i) => {
    const d = dayStart(i);
    const byProject: Record<string, number> = {};
    for (const id of mine) {
      const n = WEEK[id]!.days[i]!;
      if (n > 0) byProject[id] = n;
    }
    return {
      label: DAY_SHORT[d.getDay()]!,
      long: `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]!.slice(0, 3)}`,
      total: Object.values(byProject).reduce((a, b) => a + b, 0),
      byProject,
    };
  });

  const activity: Dashboard["activity"] = [];
  const at = (dayIdx: number, hour: number) => dayStart(dayIdx).getTime() + Math.round(hour * 3_600_000);
  mine.forEach((id, idx) => {
    const p = project(id)!;
    const emoji = causes.find((c) => c.id === p.cause)!.emoji;
    const task = (s: string) => p.tasks.find((t) => t.status === s)!.title;
    const push = (title: string, ts: number, status: Dashboard["activity"][number]["status"]) =>
      activity.push({ ts, title, projectName: p.name, projectEmoji: emoji, status });
    if (idx === 0 && !state.settings.paused) push(task("progress"), now, "working");
    push(task("review"), Math.min(now - 60_000, at(6, 2.2 + idx * 0.7)), "verifying");
    const lastMerge = WEEK[id]!.days.findLastIndex((n) => n > 0);
    if (lastMerge >= 0) push(task("merged"), at(lastMerge, 1.1 + idx * 0.9), "merged");
    if (!(id in state.resolved)) push(task("decision"), at(4, 0.4 + idx * 1.3), "escalated");
  });
  activity.sort((a, b) => b.ts - a.ts);

  const first = mine[0] ? project(mine[0]) : undefined;
  const live: Dashboard["live"] =
    first && !state.settings.paused && pct > 0
      ? {
          // One stage per 6 s = two 3 s polls, so the strip steps evenly during the demo.
          stage: LIVE_STAGES[Math.floor(now / 6000) % LIVE_STAGES.length]!,
          title: first.tasks.find((t) => t.status === "progress")!.title,
          projectName: first.name,
          projectEmoji: causes.find((c) => c.id === first.cause)!.emoji,
          sub: "Leased 38 min ago · lease renews every 5 min",
        }
      : null;

  return {
    weekLabel: weekLabel(now),
    live,
    kpis: [
      { label: "Merged this week", value: String(merged), sub: "+" + (merged - lastWeek) + " vs last week" },
      { label: "Acceptance rate", value: accept + "%", sub: merged + " of " + submitted + " submissions passed verification" },
      { label: "Quota donated", value: hours + " h", sub: pct + "% of unused · your work interrupted 0 times" },
      { label: "Streak", value: "4 weeks", sub: "In a row with merged work" },
    ],
    mergedPerDay,
    landed: mine.map((id) => {
      const w = WEEK[id]!;
      const p = project(id)!;
      const m = w.days.reduce((a, b) => a + b, 0);
      return {
        projectId: id,
        name: p.name,
        emoji: causes.find((c) => c.id === p.cause)!.emoji,
        merged: m,
        share: m / w.projectMerges,
        released: w.released,
      };
    }),
    activity: activity.slice(0, 8),
    workByKind: (["Tests", "Docs", "Fixes", "Features"] as const).map((label) => ({ label, n: sum((w) => w.kinds[label]) })),
    waiting: openDecisions().filter((d) => mine.includes(d.projectId)),
    platform: platformStats,
  };
}

// ---------- Router ----------

type Reply = { status: number; json: unknown };
const ok = (json: unknown): Reply => ({ status: 200, json });
const notFound = (what: string): Reply => ({ status: 404, json: { error: `${what} not found`, code: "not_found" } });
const badRequest = (error: string): Reply => ({ status: 400, json: { error, code: "bad_request" } });

function route(method: string, url: URL, body: unknown): Reply {
  const path = url.pathname;
  let m: RegExpMatchArray | null;

  // Maintainer area: decisions reuse the donor-side state; the rest lives in mockMaintainer.ts.
  if ((m = path.match(/^\/api\/maintain\/projects\/([^/]+)\/decisions(?:\/([^/]+)\/resolve)?$/))) {
    if (!project(m[1]!)) return notFound("Project");
    if (!m[2]) return ok(openDecisions().filter((d) => d.projectId === m![1]));
    return route(method, new URL(`/api/decisions/${m[2]}/resolve`, url), body);
  }
  const maintained = maintainerRoute(method, path, body, (id) => !!project(id));
  if (maintained) return maintained;

  if (method === "GET" && path === "/api/causes") return ok(causes);
  if (method === "GET" && path === "/api/projects") {
    const cause = url.searchParams.get("cause");
    const list = demoProjects
      .filter((p) => !cause || p.cause === cause || p.also.includes(cause as never))
      .map((p) => {
        // ProjectSummary is ProjectDetail minus the detail-only fields.
        const { about: _a, url: _u, repoUrl: _r, queue: _q, openDecision: _d, backers: _b, ...summary } = detail(p.id);
        return summary;
      });
    return ok(list);
  }
  if ((m = path.match(/^\/api\/projects\/([^/]+)$/)) && method === "GET") {
    return project(m[1]!) ? ok(detail(m[1]!)) : notFound("Project");
  }
  if ((m = path.match(/^\/api\/projects\/([^/]+)\/back$/))) {
    const id = m[1]!;
    if (!project(id)) return notFound("Project");
    if (method === "POST" && !state.backings.includes(id)) state.backings.push(id);
    if (method === "DELETE") state.backings = state.backings.filter((b) => b !== id);
    save();
    return ok({ ok: true });
  }
  if (method === "GET" && path === "/api/me") return ok(me());
  if (method === "PUT" && path === "/api/me/settings") {
    const parsed = DonorSettings.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.message);
    state.settings = parsed.data;
    save();
    return ok(me());
  }
  if (method === "GET" && path === "/api/me/dashboard") return ok(buildMockDashboard());
  if (method === "GET" && path === "/api/decisions") return ok(openDecisions());
  if ((m = path.match(/^\/api\/decisions\/([^/]+)\/resolve$/)) && method === "POST") {
    const p = demoProjects.find((x) => `${x.id}-d1` === m![1]);
    if (!p) return notFound("Decision");
    if (p.id in state.resolved) return { status: 409, json: { error: "Decision already resolved", code: "conflict" } };
    const req = ResolveDecisionRequest.safeParse(body);
    const option = req.success ? p.options.find((o) => o.id === req.data.optionId) : undefined;
    if (!option) return badRequest("Unknown option");
    state.resolved[p.id] = option.label;
    save();
    return ok(decisionFor(p, "resolved", option.label));
  }
  if (method === "POST" && path === "/api/demo/reset") {
    state = freshState();
    save();
    return ok({ ok: true });
  }
  return notFound("Route");
}

export async function mockFetch(method: string, path: string, body?: unknown): Promise<Reply> {
  // A short delay so loading states and optimistic updates behave like the real thing.
  await new Promise((r) => setTimeout(r, 120));
  const reply = route(method, new URL(path, "http://mock.local"), body);
  // Round-trip through JSON so callers never share objects with the mock's state.
  return { status: reply.status, json: JSON.parse(JSON.stringify(reply.json)) };
}
