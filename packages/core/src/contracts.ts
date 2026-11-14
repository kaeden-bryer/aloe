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
  /**
   * Optional cap on model turns for this task's code and review runs. The agent
   * uses min(this, its own ALOE_MAX_TURNS). Lets a tiny, well-specified task
   * (like the demo one) fail fast instead of wandering.
   */
  maxTurns: z.number().int().min(1).max(50).optional(),
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

// ---------- Hidden tests (maintainer-owned, handed only to verify leases) ----------

const pathSegments = (p: string) => p.split(/[\\/]/);

/**
 * A repo-relative path we are willing to write into a worktree. Hidden-test
 * files are written to disk by the donor's agent, so a hostile path like
 * "../../.ssh/authorized_keys" or ".git/hooks/pre-commit" must never validate.
 */
export const SafeRelativePath = z
  .string()
  .min(1)
  .max(300)
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\") && !/^[A-Za-z]:/.test(p), "must be repo-relative")
  .refine((p) => !p.includes("\0"), "must not contain NUL")
  .refine((p) => !pathSegments(p).includes(".."), "must not contain '..' segments")
  .refine((p) => pathSegments(p).filter(Boolean)[0]?.toLowerCase() !== ".git", "must not be inside .git/");

/** Tests the author of a patch never sees: the verifier writes these files in, then runs `command`. */
export const HiddenTests = z.object({
  /** Shell command run in the sandbox after the files are written, e.g. "node --test hidden/". */
  command: z.string().max(300),
  files: z.array(z.object({ path: SafeRelativePath, content: z.string().max(200_000) })).max(20),
});
export type HiddenTests = z.infer<typeof HiddenTests>;

/**
 * Which Docker image a project's tasks run in. The server picks it, but the
 * donor's machine runs it, so the agent only accepts names that look like our
 * own images (`aloe-sandbox`, `aloe-sandbox-ccf`, optionally `:tag`). Without
 * this check a hostile server could make donors pull and run any image.
 */
export const SANDBOX_IMAGE_PATTERN = /^aloe-sandbox(-[a-z0-9]+)?(:[\w.-]+)?$/;
export const DEFAULT_SANDBOX_IMAGE = "aloe-sandbox";
export const isAllowedSandboxImage = (name: string): boolean => name.length <= 100 && SANDBOX_IMAGE_PATTERN.test(name);

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
  /**
   * The project's sandbox image, when it needs one beyond the default (e.g. deps baked in).
   * Plain string here on purpose: the agent checks it with `isAllowedSandboxImage` and
   * refuses the task, instead of the whole claim response failing to parse.
   */
  sandboxImage: z.string().optional(),
  /** Only ever present on verify leases. Code leases (the patch author) never get these. */
  hiddenTests: HiddenTests.optional(),
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
    // 403: signed in, but not allowed (e.g. a donor trying a maintainer-only action).
    "forbidden",
    "not_found",
    "lease_lost",
    "illegal_transition",
    "conflict",
    // 503: an optional service (e.g. Resend email) has no API key yet.
    "not_configured",
  ]),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- Sessions and roles ----------
// "Who are you" (a session cookie) is separate from "what may you do" (a
// per-project maintainer row). GitHub sign-in will replace only the first part.

export const AuthUser = z.object({ id: z.string(), name: z.string(), email: z.string() });
export type AuthUser = z.infer<typeof AuthUser>;

/** GET /api/auth/me. `user: null` = signed out. `maintainerOf` = ids of projects this user maintains. */
export const AuthMe = z.object({ user: AuthUser.nullable(), maintainerOf: z.array(z.string()) });
export type AuthMe = z.infer<typeof AuthMe>;

/** A demo persona shown in the "Sign in as" picker (only when ALOE_DEMO_LOGIN=1). */
export const DemoUser = AuthUser.extend({
  role: z.enum(["donor", "maintainer"]),
  maintainerOf: z.array(z.string()),
});
export type DemoUser = z.infer<typeof DemoUser>;

export const DemoLoginRequest = z.object({ userId: z.string().min(1) });

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
  /** e.g. "Kaeden's agent" or "Unclaimed" */
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

/**
 * POST /api/me/weekly-email/send. The email itself is built from `Dashboard`
 * (same data as the dashboard screen), so there's no separate report shape.
 */
export const WeeklyEmailSendResponse = z.object({
  ok: z.literal(true),
  to: z.string(),
  subject: z.string(),
});
export type WeeklyEmailSendResponse = z.infer<typeof WeeklyEmailSendResponse>;

// ================= Maintainer area (steward onboarding, import, inbox) =================
// Everything under /api/maintain/*; see the "Maintainer API" section of API.md.

/**
 * The five questions the onboarding interview asks. They live in core so the
 * web form and the server's validation (exactly this many answers) can't drift.
 */
export const INTERVIEW_QUESTIONS = [
  "What does your project do, and who relies on it?",
  "What must never break or change without a maintainer's say-so?",
  "Which parts of the code are safe for an AI agent to work on freely?",
  "How do you build and test the project (commands, tools, versions)?",
  "What does a good contribution look like here (style, review habits, things you always reject)?",
] as const;

export const OnboardRequest = z.object({
  /** One answer per question in INTERVIEW_QUESTIONS, in order. Blank answers are allowed but not all blank. */
  answers: z
    .array(z.string().max(4000))
    .length(INTERVIEW_QUESTIONS.length)
    .refine((a) => a.some((x) => x.trim() !== ""), { message: "Answer at least one question" }),
});
export type OnboardRequest = z.infer<typeof OnboardRequest>;

export const MaintainerBrief = z.object({ projectId: z.string(), brief: z.string() });
export type MaintainerBrief = z.infer<typeof MaintainerBrief>;

/** Max issues pulled in one import. Keeps the steward call and the review queue small. */
export const MAX_IMPORT_ISSUES = 30;

export const ImportIssuesRequest = z.object({
  /** Only import issues carrying this GitHub label. */
  label: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(MAX_IMPORT_ISSUES).optional(),
});
export type ImportIssuesRequest = z.infer<typeof ImportIssuesRequest>;

/** A steward-written task waiting for a maintainer. Agents never see drafts. */
export const DraftTask = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceIssue: z.number().int().nullable(),
  spec: TaskSpec,
  createdAt: z.number().int(),
});
export type DraftTask = z.infer<typeof DraftTask>;

export const ImportIssuesResponse = z.object({
  drafts: z.array(DraftTask),
  /** Issues left out because they already had a draft (approved, rejected or pending). */
  skipped: z.number().int(),
  /** "owner/repo" the issues were read from (the parent if the project's repo is a fork). */
  source: z.string(),
});
export type ImportIssuesResponse = z.infer<typeof ImportIssuesResponse>;

export const UpdateDraftRequest = z.object({ spec: TaskSpec });
export type UpdateDraftRequest = z.infer<typeof UpdateDraftRequest>;

export const ApproveDraftResponse = z.object({ taskId: z.string() });
export type ApproveDraftResponse = z.infer<typeof ApproveDraftResponse>;
// ---------- Staging publish status (Phase 4: aloe/staging branch + one PR) ----------

export const PublishStatus = z.enum(["pending", "published", "failed"]);
export type PublishStatus = z.infer<typeof PublishStatus>;

/** GET /api/projects/:id/staging. Where each merged task is on its way to the fork. */
export const ResetDemoRequest = z.object({
  /** Also reset the demo fork on GitHub (needs ALOE_PUBLISH_STAGING=1 and a matching GITHUB_DEMO_REPO). */
  github: z.boolean().optional(),
});
export type ResetDemoRequest = z.infer<typeof ResetDemoRequest>;

/** POST /api/demo/reset. `github` is present only when the GitHub reset was requested. */
export const ResetDemoResponse = z.object({
  ok: z.literal(true),
  github: z
    .object({
      /** False when refused or failed; `message` says why. The database reset still happened. */
      ok: z.boolean(),
      message: z.string(),
      closedPrs: z.number().int(),
      /** Branches force-set to the pinned commit, e.g. ["aloe/demo-base", "aloe/staging"]. */
      resetBranches: z.array(z.string()),
      commit: z.string().nullable(),
    })
    .optional(),
});
export type ResetDemoResponse = z.infer<typeof ResetDemoResponse>;

export const StagingStatus = z.object({
  /** False unless the server runs with ALOE_PUBLISH_STAGING=1 and a GITHUB_TOKEN. */
  enabled: z.boolean(),
  branch: z.string(),
  /** The one open PR for this project, if it has been created. */
  prUrl: z.string().nullable(),
  /** True once that PR was merged on GitHub: its work is "released". The next publish opens a new PR. */
  prMerged: z.boolean(),
  items: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      status: PublishStatus,
      error: z.string().nullable(),
      commitSha: z.string().nullable(),
      attempts: z.number().int(),
      updatedAt: z.number().int(),
      /** ms when the PR holding this change was merged on GitHub; null = not released yet. */
      releasedAt: z.number().int().nullable(),
    }),
  ),
});
export type StagingStatus = z.infer<typeof StagingStatus>;
