/**
 * Builds the donor dashboard from real rows. Most numbers come from the
 * append-only events table: it already records who did what and when, so the
 * dashboard is just a few queries and some counting.
 */
import { and, count, desc, eq, gt, gte } from "drizzle-orm";
import { schema, type AloeDb, type Dashboard, type TaskCategory } from "@aloe/core";
import { backedProjectIds, listDecisions } from "./views.ts";
import { addDays, ago, dayLabels, startOfDay, startOfWeek, weekLabel, DAY_MS } from "./time.ts";

const { events, tasks, projects, devices, decisions, submissions, donors } = schema;

type ActivityStatus = Dashboard["activity"][number]["status"];

/** Event types that show up in the activity feed, and how each reads. */
const FEED_STATUS: Record<string, (kind: string, data: Record<string, unknown>) => ActivityStatus> = {
  "task.claimed": (kind) => (kind === "verify" ? "verifying" : "working"),
  "task.submitted": () => "verifying",
  "task.merged": () => "merged",
  "task.escalated": () => "escalated",
  "task.retry": () => "retry",
  // A verifier's feed shows what their review decided.
  "task.verified": (_, data) =>
    data.outcome === "maintainer" ? "escalated" : data.outcome === "retry" ? "retry" : "merged",
};

const KIND_BUCKETS: { label: string; categories: TaskCategory[] }[] = [
  { label: "Tests", categories: ["tests"] },
  { label: "Docs", categories: ["docs"] },
  { label: "Fixes", categories: ["lint", "deps", "security"] },
  { label: "Features", categories: ["feature", "interface", "personal-data", "release"] },
];

export function buildDashboard(db: AloeDb, donorId: string, now: number): Dashboard {
  const donor = db.select().from(donors).where(eq(donors.id, donorId)).get();
  const weekStart = startOfWeek(now);
  const lastWeekStart = addDays(weekStart, -7);

  const projectInfo = new Map(db.select().from(projects).all().map((p) => [p.id, p]));
  const taskInfo = new Map(
    db
      .select({ id: tasks.id, title: tasks.title, kind: tasks.kind, spec: tasks.spec })
      .from(tasks)
      .all()
      .map((t) => [t.id, t]),
  );
  const mine = db.select().from(events).where(eq(events.donorId, donorId)).orderBy(desc(events.ts)).all();
  const ofType = (type: string, from = 0, to = Infinity) => mine.filter((e) => e.type === type && e.ts >= from && e.ts < to);

  const merges = ofType("task.merged");
  const mergedThisWeek = ofType("task.merged", weekStart);
  const mergedLastWeek = ofType("task.merged", lastWeekStart, weekStart);
  const submittedThisWeek = ofType("task.submitted", weekStart);
  const verifiedThisWeek = ofType("task.verified", weekStart);

  // ---- chart: the last 7 days, oldest first ----
  const today = startOfDay(now);
  const mergedPerDay = [6, 5, 4, 3, 2, 1, 0].map((back) => {
    const from = addDays(today, -back);
    const dayMerges = ofType("task.merged", from, addDays(from, 1));
    const byProject: Record<string, number> = {};
    for (const e of dayMerges) if (e.projectId) byProject[e.projectId] = (byProject[e.projectId] ?? 0) + 1;
    return { ...dayLabels(from), total: dayMerges.length, byProject };
  });

  // ---- KPIs ----
  const diff = mergedThisWeek.length - mergedLastWeek.length;
  const accepted = Math.min(mergedThisWeek.length, submittedThisWeek.length);
  const hours = agentHours(mine, weekStart);
  const streak = weekStreak(merges.map((e) => e.ts), weekStart);
  const kpis = [
    {
      label: "Merged this week",
      value: String(mergedThisWeek.length),
      sub: diff === 0 ? "Same as last week" : `${diff > 0 ? "+" : ""}${diff} vs last week`,
    },
    submittedThisWeek.length
      ? {
          label: "Acceptance rate",
          value: `${Math.round((accepted / submittedThisWeek.length) * 100)}%`,
          sub: `${accepted} of ${submittedThisWeek.length} submissions passed verification`,
        }
      : { label: "Acceptance rate", value: "–", sub: "No submissions yet this week" },
    { label: "Quota donated", value: `${hours.toFixed(1)} h`, sub: `${donor?.pct ?? 0}% of your unused quota` },
    { label: "Streak", value: `${streak} week${streak === 1 ? "" : "s"}`, sub: "In a row with merged work" },
  ];

  // ---- per-project impact ----
  const backed = backedProjectIds(db, donorId);
  const allMergesThisWeek = db
    .select({ projectId: events.projectId, taskId: events.taskId })
    .from(events)
    .where(and(eq(events.type, "task.merged"), gte(events.ts, weekStart)))
    .all();
  const landedIds = [...new Set([...backed, ...mergedThisWeek.map((e) => e.projectId!).filter(Boolean)])];
  const landed = landedIds.flatMap((projectId) => {
    const p = projectInfo.get(projectId);
    if (!p) return [];
    const projectMerges = allMergesThisWeek.filter((m) => m.projectId === projectId);
    const merged = mergedThisWeek.filter((e) => e.projectId === projectId).length;
    return [
      {
        projectId,
        name: p.name,
        emoji: p.emoji,
        merged,
        share: projectMerges.length ? merged / projectMerges.length : 0,
        released: projectMerges.some((m) => m.taskId && taskInfo.get(m.taskId)?.spec.category === "release"),
      },
    ];
  });

  // ---- activity: newest event per task ----
  const seen = new Set<string>();
  const activity: Dashboard["activity"] = [];
  for (const e of mine) {
    const toStatus = FEED_STATUS[e.type];
    const t = e.taskId ? taskInfo.get(e.taskId) : undefined;
    const p = e.projectId ? projectInfo.get(e.projectId) : undefined;
    if (!toStatus || !t || !p || seen.has(t.id)) continue;
    seen.add(t.id);
    activity.push({ ts: e.ts, title: t.title, projectName: p.name, projectEmoji: p.emoji, status: toStatus(t.kind, e.data) });
    if (activity.length === 8) break;
  }

  // ---- what kind of work this week ----
  const categoryOf = (e: { taskId: string | null }) => (e.taskId ? taskInfo.get(e.taskId)?.spec.category : undefined);
  const workByKind = [
    ...KIND_BUCKETS.map((b) => ({
      label: b.label,
      n: submittedThisWeek.filter((e) => b.categories.includes(categoryOf(e)!)).length,
    })),
    { label: "Reviews", n: verifiedThisWeek.length },
  ];

  return {
    weekLabel: weekLabel(now),
    live: liveStatus(db, donorId, now),
    kpis,
    mergedPerDay,
    landed,
    activity,
    workByKind,
    waiting: listDecisions(db, { status: "open", projectIds: backed }),
    platform: platformStats(db, now),
  };
}

/** What the donor's agent is doing right now. */
function liveStatus(db: AloeDb, donorId: string, now: number): Dashboard["live"] {
  const leased = db
    .select({ task: tasks, project: projects, deviceName: devices.name })
    .from(tasks)
    .innerJoin(devices, eq(tasks.leaseDeviceId, devices.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(devices.donorId, donorId), eq(tasks.state, "leased"), gt(tasks.leaseExpiresAt, now)))
    .orderBy(desc(tasks.updatedAt))
    .get();
  if (leased) {
    const claimed = db
      .select({ ts: events.ts })
      .from(events)
      .where(and(eq(events.taskId, leased.task.id), eq(events.type, "task.claimed")))
      .orderBy(desc(events.ts))
      .get();
    return {
      stage: leased.task.kind === "verify" ? "verify" : "working",
      title: leased.task.title,
      projectName: leased.project.name,
      projectEmoji: leased.project.emoji,
      sub: `${leased.deviceName} · leased ${claimed ? ago(claimed.ts, now) : "recently"} · lease renews every 5 min`,
    };
  }

  // Nothing leased: is the donor's latest submission waiting on a reviewer?
  const waiting = db
    .select({ task: tasks, project: projects, submissionId: submissions.id })
    .from(submissions)
    .innerJoin(tasks, eq(submissions.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(submissions.donorId, donorId), eq(tasks.state, "verifying")))
    .orderBy(desc(submissions.createdAt))
    .get();
  if (!waiting) return null;

  const reviewer = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.reviewsSubmissionId, waiting.submissionId), eq(tasks.state, "leased"), gt(tasks.leaseExpiresAt, now)))
    .get();
  return {
    stage: "verify",
    title: waiting.task.title,
    projectName: waiting.project.name,
    projectEmoji: waiting.project.emoji,
    sub: reviewer ? "Another donor's agent is verifying your work" : "Waiting for another donor's agent to verify it",
  };
}

function platformStats(db: AloeDb, now: number): Dashboard["platform"] {
  const n = (q: { n: number } | undefined) => (q?.n ?? 0).toLocaleString("en-US");
  return [
    { label: "Tasks merged across Aloe", value: n(db.select({ n: count() }).from(tasks).where(and(eq(tasks.kind, "code"), eq(tasks.state, "merged"))).get()) },
    { label: "Donor agents active today", value: n(db.select({ n: count() }).from(devices).where(gte(devices.lastSeenAt, now - DAY_MS)).get()) },
    { label: "Vetted projects", value: n(db.select({ n: count() }).from(projects).get()) },
    { label: "Decisions waiting on maintainers", value: n(db.select({ n: count() }).from(decisions).where(eq(decisions.status, "open")).get()) },
  ];
}

/**
 * Agent time donated this week: for every submission or verification, the
 * time since the same task was claimed. An estimate, but an honest one.
 */
function agentHours(mine: (typeof events.$inferSelect)[], weekStart: number): number {
  let ms = 0;
  for (const done of mine) {
    if ((done.type !== "task.submitted" && done.type !== "task.verified") || done.ts < weekStart) continue;
    // `mine` is newest first, so this finds the latest claim before the result.
    const claim = mine.find((e) => e.type === "task.claimed" && e.taskId === done.taskId && e.ts <= done.ts);
    if (claim) ms += done.ts - claim.ts;
  }
  return ms / 3_600_000;
}

/** Consecutive weeks with at least one merge, counting back from this week (or last, if this one is empty so far). */
function weekStreak(mergeTimes: number[], weekStart: number): number {
  const weeks = new Set(mergeTimes.map((ts) => startOfWeek(ts)));
  let cursor = weeks.has(weekStart) ? weekStart : addDays(weekStart, -7);
  let streak = 0;
  while (weeks.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}
