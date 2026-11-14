# Aloe HTTP API (contract)

All bodies are JSON and validated with the Zod schemas in `src/contracts.ts`.
Errors: `{ error, code }` (`ApiError`) with status 400 / 401 / 404 / 409 / 503 (`not_configured`).

## Agent API — `Authorization: Bearer <device token>`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/agent/pair` (no auth) | `PairRequest` | `PairResponse` |
| POST | `/api/agent/claim` | `ClaimRequest` | `ClaimResponse` |
| POST | `/api/agent/tasks/:id/heartbeat` | `HeartbeatRequest` | `HeartbeatResponse` or 409 `lease_lost` |
| POST | `/api/agent/tasks/:id/release` | `{ leaseToken }` | `{ ok: true }` or 409 |
| POST | `/api/agent/tasks/:id/submit` | `SubmitRequest` | `{ submissionId, verifyTaskId }` or 409 |
| POST | `/api/agent/tasks/:id/verify` | `VerifyResultRequest` | `{ outcome }` or 409 |

### Hidden tests

`ClaimedTask.hiddenTests?: HiddenTests` is present **only on verify leases**
(never on code leases, never in any web response). `HiddenTests` =
`{ command: string (<=300), files: [{ path, content (<=200k) }] (<=20) }`.
`path` must be repo-relative: no leading `/` or `\`, no drive letter, no `..`
segment, nothing under `.git/`. The verifier writes the files into the patched
worktree, runs `command` in the sandbox, and reports `hiddenTestsPassed`
(`true` with note "no hidden tests" when none were sent). A `false` never
merges: routing sends it to `retry`, or to a maintainer after 3 attempts.

## Maintainer API — `x-aloe-maintainer-key: <key>` header

Key = env `ALOE_MAINTAINER_KEY` (default `aloe-maintainer-demo`), constant-time
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
| POST | `/api/demo/reset` | | `{ ok: true }` (reseeds the database) |
| GET | `/api/health` | | `{ ok: true }` |

The server also serves the built web app (`apps/web/dist`) at `/` in production.
In development, Vite proxies `/api` to the server on port 8787.
