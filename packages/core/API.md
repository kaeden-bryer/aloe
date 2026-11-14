# Aloe HTTP API (contract)

All bodies are JSON and validated with the Zod schemas in `src/contracts.ts`.
Errors: `{ error, code }` (`ApiError`) with status 400 / 401 / 404 / 409.

## Agent API — `Authorization: Bearer <device token>`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/agent/pair` (no auth) | `PairRequest` | `PairResponse` |
| POST | `/api/agent/claim` | `ClaimRequest` | `ClaimResponse` |
| POST | `/api/agent/tasks/:id/heartbeat` | `HeartbeatRequest` | `HeartbeatResponse` or 409 `lease_lost` |
| POST | `/api/agent/tasks/:id/release` | `{ leaseToken }` | `{ ok: true }` or 409 |
| POST | `/api/agent/tasks/:id/submit` | `SubmitRequest` | `{ submissionId, verifyTaskId }` or 409 |
| POST | `/api/agent/tasks/:id/verify` | `VerifyResultRequest` | `{ outcome }` or 409 |

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
| GET | `/api/decisions?status=open` | | `Decision[]` |
| POST | `/api/decisions/:id/resolve` | `ResolveDecisionRequest` | `Decision` |
| POST | `/api/demo/reset` | | `{ ok: true }` (reseeds the database) |
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
