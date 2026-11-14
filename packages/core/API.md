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
| GET | `/api/projects/:id/staging` | | `StagingStatus` (publish status of merged tasks on the fork's `aloe/staging` branch, plus the PR url; `enabled: false` when `ALOE_PUBLISH_STAGING` is off) |
| POST | `/api/projects/:id/back` | | `{ ok: true }` |
| DELETE | `/api/projects/:id/back` | | `{ ok: true }` |
| GET | `/api/me` | | `Me` |
| PUT | `/api/me/settings` | `DonorSettings` | `Me` |
| GET | `/api/me/dashboard` | | `Dashboard` |
| GET | `/api/decisions?status=open` | | `Decision[]` |
| POST | `/api/decisions/:id/resolve` | `ResolveDecisionRequest` | `Decision` |
| POST | `/api/demo/reset` | | `{ ok: true }` (reseeds the database) |
| GET | `/api/health` | | `{ ok: true }` |

The server also serves the built web app (`apps/web/dist`) at `/` in production.
In development, Vite proxies `/api` to the server on port 8787.
