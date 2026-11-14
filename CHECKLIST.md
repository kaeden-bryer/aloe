# Aloe build checklist

Visual version: [Aloe: Architecture and Build Checklist](https://claude.ai/artifact/QRo7ar4vRe31iLA5HY1e3A) (Whiteboard)
Design: [Aloe design canvas](https://claude.ai/artifact/WpEPx4FMvxoiuBoubEv6mf) ·
Plan: [Executive summary](https://claude.ai/artifact/1e1zZKGxh1exFN7NXyQYNX)

Legend: **[you]** = only you can do it (accounts, keys, your Mac, Docker) ·
**[claude]** = Claude Code can do it on its own.

---

## Phase 1 · Walking skeleton (built 14 Nov)

- [x] [claude] Monorepo, shared contracts (`packages/core`)
- [x] [claude] Lease engine with fencing tokens + escalation policy, with tests
- [x] [claude] Hono server, all API routes, seed data from the design
- [x] [claude] Donor/verifier agent CLI with a `fake` provider
- [x] [claude] Web app ported from the design (mock mode + real API)
- [x] [claude] End-to-end check: two fake agents → 6 submissions, 5 verifications, 1 escalation resolved; 112 tests passing
- [ ] [claude] Known gaps: steward not wired to routes yet; hidden tests are a TODO (verifier reuses the visible tests);
      `claude-sdk` / `local-claude` providers and the Docker image are written but have never been run

## Phase 2 · Get it running on your Mac  **[you]**

Run these in a terminal. Anything that fails, paste into Claude Code.

```bash
# 0. Prerequisites (skip what you have)
node -v                          # needs 22 or newer
corepack enable                  # gives you pnpm (or: npm i -g pnpm)
# Docker Desktop: https://www.docker.com/products/docker-desktop/  (needed in Phase 3)

# 1. Install and configure
cd ~/GitHub/aloe
pnpm install
cp .env.example .env             # fill keys in later phases

# 2. Start everything
pnpm seed                        # creates apps/server/aloe.db with demo data
pnpm dev                         # server :8787 + web http://localhost:5173
```

- [x] Open http://localhost:5173 and click through landing → onboarding → dashboard
- [x] Run two fake donor agents (two new terminal tabs, from `~/GitHub/aloe`):

```bash
# Tab A: Aino, writes code
ALOE_HOME=~/.aloe/aino  pnpm --filter @aloe/agent pair --donor demo-donor   --code aloe-demo --name "Aino's MacBook"
ALOE_HOME=~/.aloe/aino  pnpm --filter @aloe/agent start --mode code --ignore-window

# Tab B: Mikko, verifies Aino's work (never his own)
ALOE_HOME=~/.aloe/mikko pnpm --filter @aloe/agent pair --donor demo-donor-2 --code aloe-demo --name "Mikko's laptop"
ALOE_HOME=~/.aloe/mikko pnpm --filter @aloe/agent start --mode verify --ignore-window
```

  (Stop an agent with Ctrl-C: it hands its task back first. pnpm then prints
  `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ... SIGINT`; that's just pnpm reporting the Ctrl-C, not a bug.
  "Reset demo" and `pnpm seed` keep paired agents, so you only pair once.)
- [ ] Watch the dashboard's live strip move: Claimed → Working → Verify → Merge
- [ ] Resolve one escalated decision from the dashboard (the demo's "one human click")
- [x] Hero video: open the design canvas, download its background video and poster, and save them as
      `apps/web/public/hero.mp4` and `apps/web/public/hero-poster.jpg`
- [x] First commit and push:

```bash
git add -A
git commit -m "Walking skeleton: core, server, agent, web"
gh repo create aloe --private --source=. --push    # or create it on github.com and git push
```

## Phase 3 · Real agents

- [x] **[you]** Create an Anthropic API key in the Claude Console with a monthly spend limit; put it in `.env` as `ANTHROPIC_API_KEY`
- [x] **[you]** `docker build -t aloe-sandbox docker/sandbox`
- [x] **[you]** Fork a small transit or climate repo with a working test command to be the demo project; set `GITHUB_DEMO_REPO` and a fine-grained `GITHUB_TOKEN` (access to that fork only) in `.env`
- [x] [claude] Point one seeded project's `repoUrl` at the fork and write 3–5 small, real `TaskSpec`s for it (tests, docs, one interface change to force an escalation): project `ccf` (Cloud Carbon Footprint), image `aloe-sandbox-ccf` (`docker/sandbox-ccf/build.sh`)
- [x] [claude] Run one task end to end with `--provider claude-sdk`; fix whatever breaks (CCF task 2: code ~65 s, verify ~40 s, merged)
- [ ] [claude] Hidden tests: store them on the server per project, hand them only to verify leases, run them in the sandbox
- [ ] [claude] Demo fallback: `--provider local-claude` (your own `claude` login, your machine only)

## Phase 4 · Steward

- [ ] [claude] Onboarding: maintainer interview screen (5 questions) → `interviewToBrief` → project brief
- [ ] [claude] Import open issues via Octokit → `issuesToTaskSpecs` → queue shown to the maintainer for approval before any agent sees it
- [ ] [claude] On merge: apply the patch to a `aloe/staging` branch on the fork and open or update one PR
- [ ] [claude] Maintainer decision inbox (admin view) listing open escalations across a project

## Phase 5 · Reports

- [ ] **[you]** Resend account + `RESEND_API_KEY` (optional; the demo can render the email in the browser)
- [ ] [claude] Weekly donor email with React Email, built from the same data as the dashboard
- [ ] [claude] Share card image for "Share your week"

## Phase 6 · Demo day

- [ ] [claude] "Overnight, sped up" mode: a server flag that compresses the donation window and lease times
- [ ] [claude] Demo script page or seed preset matching the 3-minute story
- [ ] **[you]** Rehearse: project onboards → donor picks "Climate, Helsinki" → agents work → one decision → email arrives
- [ ] Later, not for the hackathon: GitHub sign-in (Better Auth), deploy (Fly.io or Railway with a volume), Postgres, reputation, DPGA registry import

---

## How to hand work to Claude Code

Open Claude Code in `~/GitHub/aloe` and say, for example:

> Read CLAUDE.md and CHECKLIST.md. Do the next unchecked [claude] items in Phase 3, using subagents for independent parts. Stop and tell me when you need something marked [you].
