/**
 * Read models: turn database rows into the response shapes in contracts.ts.
 * Handlers stay thin, and every shape is built in exactly one place.
 */
import { and, count, desc, eq, gte, inArray, notInArray } from "drizzle-orm";
import {
  schema,
  type AloeDb,
  type CauseId,
  type Decision,
  type Me,
  type ProjectDetail,
  type ProjectSummary,
  type QueueTask,
  type TaskState,
} from "@aloe/core";
import { startOfWeek } from "./time.ts";

const { projects, tasks, backings, events, decisions, donors, devices, submissions } = schema;

type ProjectRow = typeof projects.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;

export const firstName = (name: string) => name.split(" ")[0] ?? name;

export function listProjects(db: AloeDb, donorId: string, now: number, cause?: CauseId): ProjectSummary[] {
  const rows = db.select().from(projects).orderBy(projects.createdAt, projects.name).all();
  const matching = cause ? rows.filter((p) => p.cause === cause || p.alsoCauses.includes(cause)) : rows;
  const backed = new Set(backedProjectIds(db, donorId));
  const open = countBy(
    db
      .select({ key: tasks.projectId, n: count() })
      .from(tasks)
      .where(and(eq(tasks.kind, "code"), notInArray(tasks.state, ["merged", "closed"])))
      .groupBy(tasks.projectId)
      .all(),
  );
  const merged = countBy(
    db
      .select({ key: events.projectId, n: count() })
      .from(events)
      .where(and(eq(events.type, "task.merged"), gte(events.ts, startOfWeek(now))))
      .groupBy(events.projectId)
      .all(),
  );
  return matching.map((p) => toSummary(p, backed.has(p.id), open.get(p.id) ?? 0, merged.get(p.id) ?? 0));
}

export function getProject(db: AloeDb, projectId: string, donorId: string, now: number): ProjectDetail | null {
  const p = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!p) return null;
  const summary = listProjects(db, donorId, now).find((s) => s.id === projectId)!;
  const openDecision = db
    .select()
    .from(decisions)
    .where(and(eq(decisions.projectId, projectId), eq(decisions.status, "open")))
    .orderBy(desc(decisions.createdAt))
    .get();
  const backers = db.select({ n: count() }).from(backings).where(eq(backings.projectId, projectId)).get()?.n ?? 0;

  return {
    ...summary,
    about: p.about,
    url: p.url,
    repoUrl: p.repoUrl,
    queue: projectQueue(db, projectId, now),
    openDecision: openDecision ? toDecision(openDecision, p) : null,
    backers,
  };
}

/** Active work first, then the backlog, then decisions, then the most recent merges. */
const QUEUE_ORDER: Record<TaskState, number> = {
  leased: 0,
  submitted: 1,
  verifying: 1,
  queued: 2,
  escalated: 3,
  merged: 4,
  closed: 5,
  done: 5,
};

function projectQueue(db: AloeDb, projectId: string, now: number): QueueTask[] {
  const rows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "code"), notInArray(tasks.state, ["closed"])))
    .orderBy(desc(tasks.priority), desc(tasks.updatedAt))
    .all();

  const recentMerged = rows.filter((t) => t.state === "merged").slice(0, 5);
  const shown = rows.filter((t) => t.state !== "merged").concat(recentMerged);
  shown.sort((a, b) => QUEUE_ORDER[a.state] - QUEUE_ORDER[b.state]);

  // Who holds each lease, and who authored each submission, in two small lookups.
  const deviceOwner = new Map(
    db
      .select({ deviceId: devices.id, name: donors.name })
      .from(devices)
      .innerJoin(donors, eq(devices.donorId, donors.id))
      .all()
      .map((r) => [r.deviceId, firstName(r.name)]),
  );
  const reviewers = db
    .select({ codeTaskId: submissions.taskId, leaseDeviceId: tasks.leaseDeviceId, expires: tasks.leaseExpiresAt, state: tasks.state })
    .from(tasks)
    .innerJoin(submissions, eq(tasks.reviewsSubmissionId, submissions.id))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "verify"), eq(tasks.state, "leased")))
    .all();
  const authors = db
    .select({ taskId: submissions.taskId, name: donors.name })
    .from(submissions)
    .innerJoin(donors, eq(submissions.donorId, donors.id))
    .innerJoin(tasks, eq(submissions.taskId, tasks.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(submissions.createdAt)
    .all();
  const authorOf = new Map(authors.map((a) => [a.taskId, firstName(a.name)])); // latest submission wins

  const who = (t: (typeof rows)[number]): string => {
    switch (t.state) {
      case "leased": {
        // Lazy expiry: the row still says 'leased', but anyone may claim it now.
        if ((t.leaseExpiresAt ?? 0) <= now) return "Lease expired, up for grabs";
        const owner = t.leaseDeviceId ? deviceOwner.get(t.leaseDeviceId) : undefined;
        return owner ? `${owner}'s agent` : "A donor agent";
      }
      case "submitted":
      case "verifying": {
        const r = reviewers.find((v) => v.codeTaskId === t.id && (v.expires ?? 0) > now);
        const reviewer = r?.leaseDeviceId ? deviceOwner.get(r.leaseDeviceId) : undefined;
        return reviewer ? `${reviewer}'s agent is reviewing` : "Waiting for a reviewer";
      }
      case "queued":
        return "Unclaimed";
      case "escalated":
        return "Needs a maintainer";
      default: {
        const author = authorOf.get(t.id);
        return author ? `${author}'s agent` : "Merged";
      }
    }
  };

  return shown.map((t) => ({ id: t.id, title: t.title, kind: t.kind, state: t.state, category: t.spec.category, who: who(t) }));
}

export function listDecisions(db: AloeDb, filter: { status?: "open" | "resolved"; projectIds?: string[] } = {}): Decision[] {
  const conditions = [];
  if (filter.status) conditions.push(eq(decisions.status, filter.status));
  if (filter.projectIds) conditions.push(inArray(decisions.projectId, filter.projectIds));
  const rows = db
    .select()
    .from(decisions)
    .innerJoin(projects, eq(decisions.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(decisions.createdAt))
    .all();
  return rows.map((r) => toDecision(r.decisions, r.projects));
}

export function toDecision(d: DecisionRow, p: Pick<ProjectRow, "name" | "emoji">): Decision {
  return {
    id: d.id,
    projectId: d.projectId,
    projectName: p.name,
    projectEmoji: p.emoji,
    taskId: d.taskId,
    question: d.question,
    options: d.options,
    status: d.status,
    resolution: d.resolution,
    createdAt: d.createdAt,
  };
}

export function getMe(db: AloeDb, donorId: string): Me | null {
  const d = db.select().from(donors).where(eq(donors.id, donorId)).get();
  if (!d) return null;
  const myDevices = db
    .select({ id: devices.id, name: devices.name, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.donorId, donorId))
    .orderBy(devices.createdAt)
    .all();
  return {
    id: d.id,
    name: d.name,
    email: d.email,
    settings: {
      causes: d.causes,
      pct: d.pct,
      schedule: d.schedule,
      paused: d.paused,
      weeklyEmail: d.weeklyEmail,
      decisionAlerts: d.decisionAlerts,
    },
    backings: backedProjectIds(db, donorId),
    devices: myDevices,
  };
}

export function backedProjectIds(db: AloeDb, donorId: string): string[] {
  return db
    .select({ projectId: backings.projectId })
    .from(backings)
    .where(eq(backings.donorId, donorId))
    .orderBy(backings.createdAt)
    .all()
    .map((b) => b.projectId);
}

function toSummary(p: ProjectRow, backing: boolean, openTasks: number, mergedThisWeek: number): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    owner: p.owner,
    cause: p.cause,
    alsoCauses: p.alsoCauses,
    tagline: p.tagline,
    type: p.type,
    region: p.region,
    backing,
    openTasks,
    mergedThisWeek,
  };
}

function countBy(rows: { key: string | null; n: number }[]): Map<string, number> {
  return new Map(rows.filter((r) => r.key !== null).map((r) => [r.key!, r.n]));
}
