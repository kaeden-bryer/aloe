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
- [x] [claude] Known gaps: steward not wired to routes yet; hidden tests are a TODO (verifier reuses the visible tests); (all three closed 14 Nov: steward routes, hidden tests, real providers)
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
- [x] [claude] Hidden tests: store them on the server per project, hand them only to verify leases, run them in the sandbox (`hidden_tests` table, per project + per-task override; `x-aloe-maintainer` routes; verify leases only)
- [x] [claude] Demo fallback: `--provider local-claude` (your own `claude` login, your machine only) (opt-in `ALOE_ALLOW_LOCAL_CLAUDE=1`; verified with real code + review runs)

## Phase 4 · Steward

- [x] [claude] Onboarding: maintainer interview screen (5 questions) → `interviewToBrief` → project brief (`/maintain/:projectId` → Brief tab)
- [x] [claude] Import open issues via Octokit → `issuesToTaskSpecs` → queue shown to the maintainer for approval before any agent sees it (Import & approve tab; drafts table, agents never see drafts)
- [x] [claude] On merge: apply the patch to a `aloe/staging` branch on the fork and open or update one PR (built + tested against a local remote; **off** until you set `ALOE_PUBLISH_STAGING=1`, see notes below)
- [x] [claude] Maintainer decision inbox (admin view) listing open escalations across a project (Decisions tab)

## Phase 5 · Reports

- [ ] **[you]** Resend account + `RESEND_API_KEY` (optional; the demo can render the email in the browser)
- [x] [claude] Weekly donor email with React Email, built from the same data as the dashboard (Settings → "Preview this week's email"; sending needs `RESEND_API_KEY`)
- [x] [claude] Share card image for "Share your week" (Dashboard → Share your week → PNG download/copy/share)

## Phase 6 · Demo day

- [x] [claude] Roles: sessions + per-project maintainers, demo "Sign in as" picker (Kaeden Bryer = donor, Miko Cool = CCF maintainer); donors see decisions read-only
- [x] [claude] Repeatable demo: "Reset demo + GitHub" (DB + fork's `aloe/*` branches + PR), fast pinned demo task, PR targets `aloe/demo-base`, "View PR on GitHub" link
- [ ] [claude] "Overnight, sped up" mode: a server flag that compresses the donation window and lease times
- [ ] [claude] Demo script page or seed preset matching the 3-minute story
- [ ] **[you]** Rehearse: project onboards → donor picks "Climate, Helsinki" → agents work → one decision → email arrives
- [ ] Later, not for the hackathon: GitHub sign-in (Better Auth), deploy (Fly.io or Railway with a volume), Postgres, reputation, DPGA registry import

---

## How to hand work to Claude Code

Open Claude Code in `~/GitHub/aloe` and say, for example:

> Read CLAUDE.md and CHECKLIST.md. Do the next unchecked [claude] items in Phase 3, using subagents for independent parts. Stop and tell me when you need something marked [you].

---

## Notes from the 14 Nov overnight build (Phases 3–5)

What landed (all on `main`, not pushed; 182 tests green, web build OK):

- **Real agents:** `claude-sdk` ran CCF task 2 for real: code ~65 s, verify ~40 s (review approve, visible + hidden tests pass with `--network none`), task **merged**. Two model runs total.
- **Sandbox:** `aloe-sandbox-ccf` image (deps baked; `docker/sandbox-ccf/build.sh`). Projects can name a sandbox image; agents only accept names matching `aloe-sandbox(-x)`. Test containers run with no network and a kill timeout.
- **Maintainer console:** `/maintain/:projectId` (link on each project page). Demo auth: header `x-aloe-maintainer`, env `ALOE_MAINTAINER_TOKEN` (default `aloe-maintainer-demo`). Issue import needs the project's `repoUrl` to be a github.com URL; for a fork it reads the parent's issues.
- **Reports:** weekly email preview at Settings → "Preview this week's email"; share card on the Dashboard.

Your turn (**[you]**):

1. Click through once: `pnpm seed && pnpm dev`, then the CCF project page → "Maintain this project", and the weekly-email preview.
2. To publish merged work to your fork for real: your `GITHUB_TOKEN` needs Contents + Pull requests read/write on the fork. Set `ALOE_PUBLISH_STAGING=1`, merge a CCF task, then check `GET /api/projects/ccf/staging`. It pushes `aloe/staging` and opens one PR **on your fork**.
3. Optional: `RESEND_API_KEY` to really send the email.
4. Rebuild `aloe-sandbox-ccf` (`docker/sandbox-ccf/build.sh`) if the fork's `yarn.lock` changes.

Known rough edges: the seed gives the CCF infinite-loop task the highest priority, so it's claimed first (bump task 2 for a quick demo). That task has only been tested at the timeout level, not run for real. There are two small GitHub client modules (`apps/server/src/github.ts` for issue import, `apps/server/src/publish/github.ts` for PRs) that could be merged later. The publisher creates its own `staging_publishes` table instead of going through `migrate.ts`.

---

## Demo runbook (5 minutes per judge), verified against the real fork on 15 Nov

**`.env` for demo day** (on top of what's there): `ALOE_DEMO_LOGIN=1`, `ALOE_PUBLISH_STAGING=1`,
`ALOE_STAGING_BASE=aloe/demo-base`, `ALOE_IDLE_RETRY_MS=1000`. With publishing on, every merge
pushes to `aloe/staging` on your fork and updates one PR into `aloe/demo-base`. `trunk` is never touched.

**Before judges arrive:** `pnpm dev`, then sign in as **Miko Cool** → Settings → **Reset demo + GitHub**.
Start both agents with `--provider claude-sdk`: Kaeden codes, Mikko verifies, and both back only CCF.
Let one full run go through, then reset again, so the agents' clone caches and the Docker image are warm.

**Per judge:**
1. Signed in as **Kaeden Bryer**, the dashboard shows the live strip. The agents pick up "Classify Amazon Q Business Pro index hours as unknown". It reaches *merged* in about 60 s warm (84 s cold), and the **View PR on GitHub** link appears on the CCF project page.
2. The agents take the interface task. It escalates about 65 s later. Kaeden's dashboard shows "Waiting on a maintainer" with no buttons. The server also refuses donors (403).
3. Switch to **Miko Cool** → maintainer console → Decisions → **Approve and merge**. The same PR gets a second commit within seconds.
4. Open the PR on GitHub: the commits credit each donor and model. Merge it live if you like; it lands on `aloe/demo-base`.
5. Stop the agents (Ctrl-C hands work back), then as Miko: **Reset demo + GitHub**. That takes about 10 s: it closes the PR, puts both `aloe/*` branches back to the pin, and reseeds the DB. Restart the agents for the next judge.

Real test (15 Nov): reset 9 s → demo task merged at +84 s (cold clone) → PR #1 opened (`aloe/staging` → `aloe/demo-base`) → interface task escalated at +149 s → donor approve refused (403) → Miko approved → PR updated to 2 commits → reset closed PR #1, both branches back at `f584c54`, `trunk` untouched.

Notes: the demo task's usage type is invented for the demo (say so if asked). Don't press reset while a publish is in flight. Keep a screen recording of one good run as a fallback.
