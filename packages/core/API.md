# Aloe HTTP API (contract)

All bodies are JSON and validated with the Zod schemas in `src/contracts.ts`.
Errors: `{ error, code }` (`ApiError`) with status 400 / 401 (`unauthorized`, no session) / 403 (`forbidden`, signed in but not allowed) / 404 / 409 / 503 (`not_configured`).

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

## Maintainer API: hidden tests — session of a maintainer of `:id`

Needs the `aloe_session` cookie of a user who maintains project `:id` (see "Sessions and roles").
401 signed out, 403 for donors and for maintainers of other projects.

| Method | Path | Body | Response |
|---|---|---|---|
| PUT | `/api/projects/:id/hidden-tests[?taskId=<code task>]` | `HiddenTests` | `HiddenTests` |
| GET | same | | `HiddenTests` or 404 |
| DELETE | same | | `{ ok: true }` |

Without `taskId` it sets the project-wide suite; with it, an override for that
one code task (the override wins on the verify lease).

## Sessions and roles

Identity is a random token in the httpOnly, SameSite=Lax cookie `aloe_session` (the server stores only
its SHA-256 and an expiry, 7 days). There is no identity header. Roles are per project: a *maintainer* is
a user (a row of the donors table) with a row in `project_maintainers` for that project. Donors only
donate compute and cannot make a project's decisions. Agent device tokens are a separate scheme (above).
Code: `apps/server/src/session.ts` (`currentUser`, `requireUser` -> 401, `requireMaintainerOf` -> 403).
GitHub sign-in (Better Auth) will replace only the demo login below; the session and role checks stay.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/auth/me` | | `AuthMe` = `{ user: {id,name,email} \| null, maintainerOf: string[] }` (always 200) |
| POST | `/api/auth/logout` | | `{ ok: true }` (deletes the session, clears the cookie) |
| GET | `/api/auth/demo-users` | | `DemoUser[]` (personas + roles). **404 unless env `ALOE_DEMO_LOGIN=1`** |
| POST | `/api/auth/demo-login` | `{ userId }` | `AuthMe`, sets the cookie. **404 unless `ALOE_DEMO_LOGIN=1`**; 404 for an unknown user |

## Web API — requires a session unless marked public

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/causes` (public) | | `Cause[]` |
| GET | `/api/projects?cause=<CauseId>` (public) | | `ProjectSummary[]` (`backing` is false when signed out) |
| GET | `/api/projects/:id` (public) | | `ProjectDetail` |
| GET | `/api/projects/:id/staging` (public) | | `StagingStatus` (publish status of merged tasks on the fork's `aloe/staging` branch, plus the PR url; `enabled: false` when `ALOE_PUBLISH_STAGING` is off). `prMerged` is true once that PR was merged on GitHub, and each item then has `releasedAt` (ms) set. Calling the route also nudges a throttled GitHub check (at most once per PR per 15 s); a server timer checks every 20 s too. A donor dashboard project counts as `released` (Shipped) when it has a release-category merge or one of the donor's merged tasks was in a merged PR |
| POST | `/api/projects/:id/back` | | `{ ok: true }` |
| DELETE | `/api/projects/:id/back` | | `{ ok: true }` |
| GET | `/api/me` | | `Me` |
| PUT | `/api/me/settings` | `DonorSettings` | `Me` |
| GET | `/api/me/dashboard` | | `Dashboard` |
| GET | `/api/me/weekly-email` | | `text/html`: the weekly donor email, rendered from the same `Dashboard` data (demo preview) |
| GET | `/api/me/weekly-email.txt` | | `text/plain`: the email's plain-text fallback |
| POST | `/api/me/weekly-email/send` | | `WeeklyEmailSendResponse`; 503 `not_configured` if `RESEND_API_KEY` is unset; 409 `conflict` if the donor turned `weeklyEmail` off |
| GET | `/api/decisions?status=open` | | `Decision[]` |
| POST | `/api/demo/reset` | optional `ResetDemoRequest` (`{ github?: boolean }`) | `ResetDemoResponse`: `{ ok: true, github?: { ok, message, closedPrs, resetBranches, commit } }`. Reseeds the database (sessions survive) and clears the publish ledger. Needs a session **and** `ALOE_DEMO_LOGIN=1` (else 404). With `github: true` the caller must also maintain the demo project (`ccf`; else 403, nothing reset) and the demo fork is reset too (see below) |
| GET | `/api/health` (public) | | `{ ok: true }` |

There is no donor-reachable "resolve a decision" route: escalations are answered only through the
maintainer route below (`POST /api/decisions/:id/resolve` was removed).

## Maintainer API — session of a maintainer of `:id` (401 signed out, 403 otherwise)

Every route under `/api/maintain/projects/:id/` requires `requireMaintainerOf(:id)`. Seeded personas:
`maintainer-ccf` ("Miko Cool", project `ccf`) and one maintainer per other project; `demo-donor`
(Kaeden Bryer) and `demo-donor-2` (Mikko Laine) are donors.
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
