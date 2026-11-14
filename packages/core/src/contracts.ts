/**
 * Zod contracts shared by the server, the donor agent and the web app.
 *
 * Why Zod and not just TypeScript types? Types vanish at runtime. A donor's
 * agent is code we don't control talking to our server over the network, so
 * the server must validate every request body at runtime. Zod gives us both:
 * `z.infer<>` produces the compile-time type, and `.parse()` checks the real
 * JSON. One definition, two guarantees.
 */
import { z } from "zod";
import { TASK_STATES } from "./states.ts";

// ---------- Shared enums ----------

export const CauseId = z.enum(["climate", "electric", "eco", "farming", "health"]);
export type CauseId = z.infer<typeof CauseId>;

export const TaskKind = z.enum(["code", "verify"]);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskStateSchema = z.enum(TASK_STATES);

/**
 * What kind of change a task asks for. The routing policy (routing.ts) uses
 * this to decide how much human review the result needs.
 */
export const TaskCategory = z.enum([
  "tests",
  "docs",
  "lint",
  "deps",
  "feature",
  "interface",
  "security",
  "personal-data",
  "release",
]);
export type TaskCategory = z.infer<typeof TaskCategory>;

export const Schedule = z.enum(["overnight", "workday", "anytime"]);
export type Schedule = z.infer<typeof Schedule>;

// ---------- Task spec (written by the steward, approved by a maintainer) ----------

/**
 * The only description of the work a donor agent ever sees. Raw issue text is
 * untrusted (anyone can write an issue), so the steward rewrites it into this
 * structure and a maintainer approves the queue before agents see it.
 */
export const TaskSpec = z.object({
  goal: z.string().min(1).max(2000),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(12),
  filesInScope: z.array(z.string().max(300)).max(50),
  category: TaskCategory,
  /** Shell command the verifier runs inside the sandbox, e.g. "npm test". */
  testCommand: z.string().max(300),
  sourceIssue: z.number().int().positive().optional(),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

// ---------- Agent <-> server API ----------

export const PairRequest = z.object({
  pairingCode: z.string().min(1),
  donorId: z.string().min(1),
  deviceName: z.string().min(1).max(100),
});
export const PairResponse = z.object({
  deviceId: z.string(),
  /** Bearer token for all later agent calls. Shown once; the server stores a hash. */
  token: z.string(),
});

export const ClaimRequest = z.object({
  kinds: z.array(TaskKind).min(1).default(["code", "verify"]),
});
export type ClaimRequest = z.infer<typeof ClaimRequest>;

/** For verify tasks: the submission under review. */
export const SubmissionForReview = z.object({
  submissionId: z.string(),
  patch: z.string(),
  summary: z.string(),
});

export const ClaimedTask = z.object({
  id: z.string(),
  kind: TaskKind,
  projectId: z.string(),
  repoUrl: z.string(),
  title: z.string(),
  spec: TaskSpec,
  /** Fencing token: include it in every heartbeat and submission for this lease. */
  leaseToken: z.number().int(),
  leaseExpiresAt: z.number().int(),
  review: SubmissionForReview.optional(),
});
export type ClaimedTask = z.infer<typeof ClaimedTask>;

export const ClaimResponse = z.union([
  z.object({ task: ClaimedTask }),
  z.object({ task: z.null(), retryAfterMs: z.number().int().nonnegative() }),
]);
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const HeartbeatRequest = z.object({ leaseToken: z.number().int() });
export const HeartbeatResponse = z.object({ leaseExpiresAt: z.number().int() });

export const SubmitRequest = z.object({
  leaseToken: z.number().int(),
  patch: z.string().max(2_000_000),
  summary: z.string().max(5000),
  /** Pinned for reproducibility, as BOINC does: which model and harness produced this. */
  model: z.string().max(100),
  harness: z.string().max(100),
});
export type SubmitRequest = z.infer<typeof SubmitRequest>;

export const ReviewVerdict = z.enum(["approve", "reject", "unsure"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const VerifyResultRequest = z.object({
  leaseToken: z.number().int(),
  testsPassed: z.boolean(),
  hiddenTestsPassed: z.boolean(),
  reviewVerdict: ReviewVerdict,
  notes: z.string().max(5000),
});
export type VerifyResultRequest = z.infer<typeof VerifyResultRequest>;

// ---------- Web app API ----------

export const DonorSettings = z.object({
  causes: z.array(CauseId),
  pct: z.number().int().min(0).max(100),
  schedule: Schedule,
  paused: z.boolean(),
  weeklyEmail: z.boolean(),
  decisionAlerts: z.boolean(),
});
export type DonorSettings = z.infer<typeof DonorSettings>;

export const ResolveDecisionRequest = z.object({
  optionId: z.string().min(1),
  note: z.string().max(2000).optional(),
});

export const ApiError = z.object({
  error: z.string(),
  code: z.enum([
    "bad_request",
    "unauthorized",
    "not_found",
    "lease_lost",
    "illegal_transition",
    "conflict",
  ]),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- Web app response shapes ----------
// The server builds these; the web app renders them. Keeping them here means
// the two builders can work in parallel against one agreed shape.

export const Cause = z.object({
  id: CauseId,
  emoji: z.string(),
  name: z.string(),
  blurb: z.string(),
});
export type Cause = z.infer<typeof Cause>;

export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  owner: z.string(),
  cause: CauseId,
  alsoCauses: z.array(CauseId),
  tagline: z.string(),
  type: z.string(),
  region: z.string(),
  backing: z.boolean(),
  openTasks: z.number().int(),
  mergedThisWeek: z.number().int(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const QueueTask = z.object({
  id: z.string(),
  title: z.string(),
  kind: TaskKind,
  state: TaskStateSchema,
  category: TaskCategory,
  /** e.g. "Aino's agent" or "Unclaimed" */
  who: z.string(),
});
export type QueueTask = z.infer<typeof QueueTask>;

export const Decision = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectEmoji: z.string(),
  taskId: z.string().nullable(),
  question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  status: z.enum(["open", "resolved"]),
  resolution: z.string().nullable(),
  createdAt: z.number().int(),
});
export type Decision = z.infer<typeof Decision>;

export const ProjectDetail = ProjectSummary.extend({
  about: z.string(),
  url: z.string(),
  repoUrl: z.string(),
  queue: z.array(QueueTask),
  openDecision: Decision.nullable(),
  backers: z.number().int(),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const Me = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  settings: DonorSettings,
  backings: z.array(z.string()),
  devices: z.array(z.object({ id: z.string(), name: z.string(), lastSeenAt: z.number().int().nullable() })),
});
export type Me = z.infer<typeof Me>;

export const LiveStage = z.enum(["claimed", "working", "verify", "merge"]);

export const Dashboard = z.object({
  weekLabel: z.string(),
  /** What the donor's agent is doing right now, or null if idle. */
  live: z
    .object({
      stage: LiveStage,
      title: z.string(),
      projectName: z.string(),
      projectEmoji: z.string(),
      sub: z.string(),
    })
    .nullable(),
  kpis: z.array(z.object({ label: z.string(), value: z.string(), sub: z.string() })),
  /** Last 7 days, oldest first. */
  mergedPerDay: z.array(
    z.object({
      label: z.string(),
      long: z.string(),
      total: z.number().int(),
      byProject: z.record(z.string(), z.number().int()),
    }),
  ),
  landed: z.array(
    z.object({
      projectId: z.string(),
      name: z.string(),
      emoji: z.string(),
      merged: z.number().int(),
      /** Fraction 0..1 of the project's merges this week that came from this donor. */
      share: z.number(),
      released: z.boolean(),
    }),
  ),
  activity: z.array(
    z.object({
      ts: z.number().int(),
      title: z.string(),
      projectName: z.string(),
      projectEmoji: z.string(),
      status: z.enum(["merged", "verifying", "working", "escalated", "retry"]),
    }),
  ),
  workByKind: z.array(z.object({ label: z.string(), n: z.number().int() })),
  waiting: z.array(Decision),
  platform: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type Dashboard = z.infer<typeof Dashboard>;
