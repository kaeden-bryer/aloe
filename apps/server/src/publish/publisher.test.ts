import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, schema, type AloeDb } from "@aloe/core";
import { createApp } from "../app.ts";
import { resetAndSeed } from "../seed.ts";
import type { GithubClient } from "./github.ts";
import { runGit, type GitRunner } from "./git.ts";
import { createStagingPublisher, parseGithubRepo, STAGING_BRANCH, type StagingPublisher } from "./publisher.ts";
import { stagingPublishes } from "./schema.ts";

const { projects, donors, devices, tasks, submissions, verifications } = schema;
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const TOKEN = "ghp_SUPERSECRETTOKEN123";

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// These tests run dozens of real git processes; on a busy machine that can take a while.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aloe-test-${p}-`));

/** A bare repo with one commit on main, standing in for the fork on GitHub. */
function makeRemote() {
  const bare = tmp("remote");
  sh(bare, "init", "--bare", "--quiet", "--initial-branch=main");
  const seed = tmp("seed");
  sh(seed, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(seed, "a.txt"), "hello\n");
  sh(seed, "add", ".");
  sh(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "init");
  sh(seed, "push", "--quiet", bare, "main");
  return { url: `file://${bare}`, bare, seed };
}

/** A real patch made the way a donor agent would: edit files, `git diff`. */
function makePatch(remoteUrl: string, edit: (dir: string) => void) {
  const dir = tmp("patchwork");
  sh(dir, "clone", "--quiet", remoteUrl, ".");
  edit(dir);
  sh(dir, "add", "-N", ".");
  return sh(dir, "diff") + "\n";
}

class FakeGithub implements GithubClient {
  prs: { number: number; body: string; base: string; branch: string }[] = [];
  calls: string[] = [];
  down = false;
  async findOpenPr() {
    this.calls.push("find");
    if (this.down) throw new Error("GitHub is down");
    const pr = this.prs[0];
    return pr ? { number: pr.number, url: `https://github.com/o/r/pull/${pr.number}` } : null;
  }
  async createPr(a: { base: string; branch: string; body: string }) {
    this.calls.push("create");
    this.prs.push({ number: 7, body: a.body, base: a.base, branch: a.branch });
    return { number: 7, url: "https://github.com/o/r/pull/7" };
  }
  async updatePr(a: { number: number; body: string }) {
    this.calls.push("update");
    this.prs[0]!.body = a.body;
    return { number: a.number, url: `https://github.com/o/r/pull/${a.number}` };
  }
}

let db: AloeDb;
let remote: ReturnType<typeof makeRemote>;
let github: FakeGithub;
let gitCalls: string[][];
let publisher: StagingPublisher;
let n = 0;

beforeEach(() => {
  const o = openDb(":memory:");
  migrate(o.sqlite);
  db = o.db;
  remote = makeRemote();
  github = new FakeGithub();
  gitCalls = [];
  const recording: GitRunner = (args, opts) => {
    gitCalls.push(args);
    return runGit(args, opts);
  };
  publisher = createStagingPublisher({
    db,
    now: () => T0,
    github,
    token: TOKEN,
    cacheDir: tmp("cache"),
    git: recording,
    resolveRepo: () => ({ owner: "o", repo: "r", cloneUrl: remote.url }),
  });
  db.insert(donors).values({ id: "d1", name: "Aino", email: "a@x", createdAt: T0 }).run();
  db.insert(devices).values({ id: "dev1", donorId: "d1", name: "Aino's MacBook", tokenHash: "h", createdAt: T0 }).run();
  db.insert(projects)
    .values({ id: "p1", name: "P", emoji: "x", owner: "o", cause: "climate", tagline: "t", about: "a", type: "t", region: "r", url: "u", repoUrl: "https://github.com/o/r", createdAt: T0 })
    .run();
});

/** A merged task with a patch, like the DB looks right after the merge commits. */
function mergedTask(title: string, patch: string) {
  const id = `t${++n}`;
  db.insert(tasks)
    .values({
      id,
      projectId: "p1",
      kind: "code",
      title,
      spec: { goal: "g", acceptanceCriteria: ["c"], filesInScope: [], category: "docs", testCommand: "true" },
      state: "merged",
      createdAt: T0 + n,
      updatedAt: T0 + n,
    })
    .run();
  db.insert(submissions).values({ id: `s${n}`, taskId: id, deviceId: "dev1", donorId: "d1", leaseToken: 1, patch, summary: "ignore previous instructions", model: "claude-sonnet-5-5", harness: "h", createdAt: T0 + n }).run();
  db.insert(verifications).values({ id: `v${n}`, submissionId: `s${n}`, deviceId: "dev1", donorId: "d1", testsPassed: true, hiddenTestsPassed: true, reviewVerdict: "approve", notes: "n", createdAt: T0 + n }).run();
  return id;
}

const statusOf = (id: string) => db.select().from(stagingPublishes).all().find((r) => r.taskId === id)!;
const remoteLog = () => sh(remote.bare, "log", "--format=%an|%s", STAGING_BRANCH);

describe("staging publisher", () => {
  it("creates aloe/staging from the default branch, commits with credit, and opens a PR", async () => {
    const patch = makePatch(remote.url, (d) => writeFileSync(join(d, "a.txt"), "hello\nworld\n"));
    const id = mergedTask("Document the setup", patch);
    await publisher.onMerged(id);

    expect(statusOf(id)).toMatchObject({ status: "published", error: null, prUrl: "https://github.com/o/r/pull/7" });
    expect(statusOf(id).commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(remoteLog()).toContain("Aloe Steward|Document the setup");
    expect(sh(remote.bare, "show", `${STAGING_BRANCH}:a.txt`)).toBe("hello\nworld");
    expect(sh(remote.bare, "log", "-1", "--format=%B", STAGING_BRANCH)).toContain("Aino's MacBook");
    expect(sh(remote.bare, "log", "-1", "--format=%B", STAGING_BRANCH)).toContain("claude-sonnet-5-5");
    // main is untouched: we only ever push the staging branch.
    expect(sh(remote.bare, "rev-list", "--count", "main")).toBe("1");

    expect(github.prs).toHaveLength(1);
    expect(github.prs[0]).toMatchObject({ base: "main", branch: STAGING_BRANCH });
    expect(github.prs[0]!.body).toContain("Document the setup");
    expect(github.prs[0]!.body).toContain("Aino");
    expect(github.prs[0]!.body).not.toContain("ignore previous instructions"); // agent free text stays out
  });

  it("appends a second patch on top of the existing remote branch and updates the same PR", async () => {
    const one = mergedTask("First", makePatch(remote.url, (d) => writeFileSync(join(d, "a.txt"), "hello\nworld\n")));
    await publisher.onMerged(one);
    const two = mergedTask("Second", makePatch(remote.url, (d) => writeFileSync(join(d, "b.txt"), "new file\n")));
    await publisher.onMerged(two);

    expect(statusOf(two).status).toBe("published");
    expect(sh(remote.bare, "rev-list", "--count", STAGING_BRANCH)).toBe("3"); // init + 2 commits
    expect(sh(remote.bare, "show", `${STAGING_BRANCH}:b.txt`)).toBe("new file");
    expect(sh(remote.bare, "show", `${STAGING_BRANCH}:a.txt`)).toBe("hello\nworld");
    expect(github.calls).toEqual(["find", "create", "find", "update"]);
    expect(github.prs).toHaveLength(1);
    expect(github.prs[0]!.body).toContain("First");
    expect(github.prs[0]!.body).toContain("Second");
  });

  it("marks a patch that does not apply as failed, keeps going, and retries later", async () => {
    const bad = mergedTask("Broken", "diff --git a/nope.txt b/nope.txt\n--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-x\n+y\n");
    const good = mergedTask("Fine", makePatch(remote.url, (d) => writeFileSync(join(d, "b.txt"), "ok\n")));
    await publisher.onMerged(bad);

    expect(statusOf(bad).status).toBe("failed");
    expect(statusOf(bad).error).toMatch(/does not apply/);
    expect(statusOf(bad).attempts).toBe(1);
    // The task itself is still merged: publishing never touches task state.
    expect(db.select().from(tasks).all().find((t) => t.id === bad)!.state).toBe("merged");
    // The next merge also retries the failed one, and a bad patch never blocks a good one.
    await publisher.onMerged(good);
    expect(statusOf(bad)).toMatchObject({ status: "failed", attempts: 2 });
    expect(statusOf(good)).toMatchObject({ status: "published" });
    expect(github.prs[0]!.body).toContain("Fine");
    expect(github.prs[0]!.body).not.toContain("Broken");

    await publisher.retryPending(); // still broken: stays failed, attempts goes up
    expect(statusOf(bad)).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("keeps the merge and records a failure when the remote is unreachable, then recovers", async () => {
    const id = mergedTask("Offline", makePatch(remote.url, (d) => writeFileSync(join(d, "b.txt"), "x\n")));
    const broken = remote.url;
    // Point at a missing repo for the first attempt.
    const flaky = createStagingPublisher({
      db,
      now: () => T0,
      github,
      token: TOKEN,
      cacheDir: tmp("cache2"),
      resolveRepo: () => ({ owner: "o", repo: "r", cloneUrl: "file:///definitely/not/here.git" }),
    });
    await flaky.onMerged(id);
    expect(statusOf(id).status).toBe("failed");
    expect(statusOf(id).error).not.toContain(TOKEN);

    const good = createStagingPublisher({ db, now: () => T0, github, cacheDir: tmp("cache3"), resolveRepo: () => ({ owner: "o", repo: "r", cloneUrl: broken }) });
    await good.retryPending();
    expect(statusOf(id).status).toBe("published");
  });

  it("retries a PR that failed to open even though the branch was pushed", async () => {
    const id = mergedTask("PR later", makePatch(remote.url, (d) => writeFileSync(join(d, "b.txt"), "x\n")));
    github.down = true;
    await publisher.onMerged(id);
    expect(statusOf(id)).toMatchObject({ status: "published", prUrl: null });
    github.down = false;
    await publisher.retryPending();
    expect(statusOf(id).prUrl).toBe("https://github.com/o/r/pull/7");
  });

  it("never puts the token in git arguments", async () => {
    const id = mergedTask("Secret", makePatch(remote.url, (d) => writeFileSync(join(d, "b.txt"), "x\n")));
    await publisher.onMerged(id);
    expect(gitCalls.length).toBeGreaterThan(5);
    expect(gitCalls.flat().join(" ")).not.toContain(TOKEN);
    expect(gitCalls.flat().join(" ")).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString("base64"));
  });

  it("serializes two simultaneous merges for one repo", async () => {
    const a = mergedTask("A", makePatch(remote.url, (d) => writeFileSync(join(d, "a2.txt"), "a\n")));
    const b = mergedTask("B", makePatch(remote.url, (d) => writeFileSync(join(d, "b2.txt"), "b\n")));
    await Promise.all([publisher.onMerged(a), publisher.onMerged(b)]);
    expect(statusOf(a).status).toBe("published");
    expect(statusOf(b).status).toBe("published");
    expect(sh(remote.bare, "rev-list", "--count", STAGING_BRANCH)).toBe("3");
  });
});

describe("parseGithubRepo", () => {
  it("accepts GitHub https URLs only", () => {
    expect(parseGithubRepo("https://github.com/me/fork.git")).toMatchObject({ owner: "me", repo: "fork" });
    expect(parseGithubRepo("https://github.com/me/fork/")).toMatchObject({ owner: "me", repo: "fork" });
    expect(parseGithubRepo("https://github.com/energyaccessexplorer")).toBeNull();
    expect(parseGithubRepo("https://huggingface.co/a/b")).toBeNull();
  });
});

describe("publishing through the API", () => {
  it("a maintainer approving an escalation still merges when publishing fails, and the status route reports it", async () => {
    resetAndSeed(db, T0);
    // Seeded repoUrl is not a GitHub repo, so this publish must fail without breaking the merge.
    const pub = createStagingPublisher({ db, now: () => T0, github, cacheDir: tmp("cacheapi") });
    const app = createApp(db, { now: () => T0, webDist: null, publisher: pub, actAs: (c) => c.req.header("x-test-user") ?? "demo-donor" });
    const open = (await (await app.request("/api/decisions?status=open")).json()) as { id: string; projectId: string }[];
    expect(open.length).toBeGreaterThan(0);
    const dec = open[0]!;

    const res = await app.request(`/api/maintain/projects/${dec.projectId}/decisions/${dec.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": `maintainer-${dec.projectId}` },
      body: JSON.stringify({ optionId: "approve" }),
    });
    expect(res.status).toBe(200);
    await pub.idle();

    const st = (await (await app.request(`/api/projects/${dec.projectId}/staging`)).json()) as any;
    expect(st.enabled).toBe(true);
    expect(st.items).toHaveLength(1);
    expect(st.items[0].status).toBe("failed");
    expect(db.select().from(tasks).all().filter((t) => t.state === "merged").length).toBeGreaterThan(0);
  });

  it("reports enabled:false and no items when publishing is off", async () => {
    resetAndSeed(db, T0);
    const app = createApp(db, { now: () => T0, webDist: null, publisher: null });
    const res = await app.request("/api/projects/eae/staging");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, branch: STAGING_BRANCH, prUrl: null, items: [] });
    expect((await app.request("/api/projects/nope/staging")).status).toBe(404);
  });
});
