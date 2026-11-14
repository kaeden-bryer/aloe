# Aloe HTTP API (contract)

All bodies are JSON and validated with the Zod schemas in `src/contracts.ts`.
Errors: `{ error, code }` (`ApiError`) with status 400 / 401 / 404 / 409 / 503 (`not_configured`).

### Per-task turn cap

`TaskSpec.maxTurns?: number` (1-50) caps model turns for that task's code and
review runs. The agent uses `min(spec.maxTurns, ALOE_MAX_TURNS)` (the env default
is 30). Use it for tiny, precisely specified tasks so they fail fast.

### Demo GitHub reset (`POST /api/demo/reset` with `{ "github": true }`)

Runs after the database reset, only when `ALOE_PUBLISH_STAGING=1`, and only for
the repo named by env `GITHUB_DEMO_REPO` (`owner/repo`). It closes open PRs from
`aloe/staging`, force-sets `aloe/demo-base` and `aloe/staging` to
`ALOE_DEMO_BASE_COMMIT`, and resets the server's git cache clone. It refuses any
other repo, any ref not starting with `aloe/`, and never touches the default
branch. A refusal or failure is reported in `github.ok = false`, never as an HTTP error.

### Staging base branch

Env `ALOE_STAGING_BASE` (e.g. `aloe/demo-base`) sets both the branch `aloe/staging`
starts from and the PR's base. Unset = the repo's default branch.

## Agent API — `Authorization: Bearer <device token>`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/agent/pair` (no auth) | `PairRequest` | `PairResponse` |
| POST | `/api/agent/claim` | `ClaimRequest` | `ClaimResponse` |
| POST | `/api/agent/tasks/:id/heartbeat` | `HeartbeatRequest` | `HeartbeatResponse` or 409 `lease_lost` |
| POST | `/api/agent/tasks/:id/release` | `{ leaseToken }` | `{ ok: true }` or 409 |
| POST | `/api/agent/tasks/:id/submit` | `SubmitRequest` | `{ submissionId, verifyTaskId }` or 409 |
| POST | `/api/agent/tasks/:id/verify` | `VerifyResultRequest` | `{ outcome }` or 409 |

### Sandbox image

`ClaimedTask.sandboxImage?: string` is the project's Docker image for every run of
its tasks (code, review, tests, hidden tests); absent means the agent's default
(`aloe-sandbox`). The agent accepts only names matching
`SANDBOX_IMAGE_PATTERN` (`/^aloe-sandbox(-[a-z0-9]+)?(:[\w.-]+)?$/`) and refuses
the task otherwise, so a server can't make donors run arbitrary images. Test-mode
containers run with `--network none`; code and review runs keep the network for the
model API.

### Hidden tests

`ClaimedTask.hiddenTests?: HiddenTests` is present **only on verify leases**
(never on code leases, never in any web response). `HiddenTests` =
`{ command: string (<=300), files: [{ path, content (<=200k) }] (<=20) }`.
`path` must be repo-relative: no leading `/` or `\`, no drive letter, no `..`
segment, nothing under `.git/`. The verifier writes the files into the patched
worktree, runs `command` in the sandbox, and reports `hiddenTestsPassed`
(`true` with note "no hidden tests" when none were sent). A `false` never
merges: routing sends it to `retry`, or to a maintainer after 3 attempts.

## Maintainer API — `x-aloe-maintainer: <key>` header

Key = env `ALOE_MAINTAINER_TOKEN` (default `aloe-maintainer-demo`), constant-time
compared; real maintainer accounts replace it later. Not donor-header auth.

| Method | Path | Body | Response |
|---|---|---|---|
| PUT | `/api/projects/:id/hidden-tests[?taskId=<code task>]` | `HiddenTests` | `HiddenTests` |
| GET | same | | `HiddenTests` or 404 |
| DELETE | same | | `{ ok: true }` |

Without `taskId` it sets the project-wide suite; with it, an override for that
one code task (the override wins on the verify lease).

## Web API — demo identity via `x-aloe-donor: <donorId>` header (default `demo-donor`)

Real auth (GitHub sign-in) replaces the header later; routes stay the same.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/causes` | | `Cause[]` |
| GET | `/api/projects?cause=<CauseId>` | | `ProjectSummary[]` |
| GET | `/api/projects/:id` | | `ProjectDetail` |
| GET | `/api/projects/:id/staging` | | `StagingStatus` (publish status of merged tasks on the fork's `aloe/staging` branch, plus the PR url; `enabled: false` when `ALOE_PUBLISH_STAGING` is off) |
| POST | `/api/projects/:id/back` | | `{ ok: true }` |
| DELETE | `/api/projects/:id/back` | | `{ ok: true }` |
| GET | `/api/me` | | `Me` |
| PUT | `/api/me/settings` | `DonorSettings` | `Me` |
| GET | `/api/me/dashboard` | | `Dashboard` |
| GET | `/api/me/weekly-email` | | `text/html`: the weekly donor email, rendered from the same `Dashboard` data (demo preview) |
| GET | `/api/me/weekly-email.txt` | | `text/plain`: the email's plain-text fallback |
| POST | `/api/me/weekly-email/send` | | `WeeklyEmailSendResponse`; 503 `not_configured` if `RESEND_API_KEY` is unset; 409 `conflict` if the donor turned `weeklyEmail` off |
| GET | `/api/decisions?status=open` | | `Decision[]` |
| POST | `/api/decisions/:id/resolve` | `ResolveDecisionRequest` | `Decision` |
| POST | `/api/demo/reset` | optional `ResetDemoRequest` (`{ github?: boolean }`) | `ResetDemoResponse`: `{ ok: true, github?: { ok, message, closedPrs, resetBranches, commit } }`. Reseeds the database and clears the publish ledger; with `github: true` it also resets the demo fork (see below) |
| GET | `/api/health` | | `{ ok: true }` |

## Maintainer API — demo identity via `x-aloe-maintainer: <token>` header

The token is compared in constant time with env `ALOE_MAINTAINER_TOKEN` (default `aloe-maintainer-demo`);
wrong or missing -> 401. In the demo a valid token may act on any project. Real GitHub sign-in
replaces it later (the check lives in one place, `requireMaintainer` in `apps/server/src/maintainer.ts`).
`INTERVIEW_QUESTIONS` (core) are the five onboarding questions.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/maintain/projects/:id/brief` | | `MaintainerBrief` |
| POST | `/api/maintain/projects/:id/onboard` | `OnboardRequest` (5 answers) | `MaintainerBrief` (stored on the project) |
| POST | `/api/maintain/projects/:id/import` | `ImportIssuesRequest` (`label?`, `limit?` max 30) | `ImportIssuesResponse` (new drafts; never tasks) |
| GET | `/api/maintain/projects/:id/drafts` | | `DraftTask[]` (pending) |
| PUT | `/api/maintain/projects/:id/drafts/:draftId` | `UpdateDraftRequest` (full `TaskSpec`) | `DraftTask` |
| POST | `/api/maintain/projects/:id/drafts/:draftId/approve` | | `ApproveDraftResponse` (creates a queued task) or 409 |
| POST | `/api/maintain/projects/:id/drafts/:draftId/reject` | | `{ ok: true }` or 409 |
| GET | `/api/maintain/projects/:id/decisions` | | `Decision[]` (this project's open escalations) |
| POST | `/api/maintain/projects/:id/decisions/:decisionId/resolve` | `ResolveDecisionRequest` | `Decision` (404 if it belongs to another project) |

Import reads open issues with Octokit (`GITHUB_TOKEN`), skips pull requests, reads the parent repo
if the project's repo is a fork, and skips issues that already have a draft. Drafts live in the
`task_drafts` table, which the agent claim route never reads.

The server also serves the built web app (`apps/web/dist`) at `/` in production.
In development, Vite proxies `/api` to the server on port 8787.
