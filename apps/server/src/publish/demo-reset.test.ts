import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, schema, type AloeDb } from "@aloe/core";
import { createApp } from "../app.ts";
import { resetAndSeed } from "../seed.ts";
import { clearLedger, createDemoResetter, isSafeDemoRef, type DemoResetConfig, type PrCloser } from "./demo-reset.ts";
import { cloneDirFor, runGit, type GitRunner } from "./git.ts";
import { ensurePublishTable, stagingPublishes } from "./schema.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const TOKEN = "ghp_RESETSECRET999";
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aloe-reset-${p}-`));

/** Bare repo standing in for the fork: `main` has two commits, and an aloe/staging branch with a third. */
function makeRemote() {
  const bare = tmp("remote");
  sh(bare, "init", "--bare", "--quiet", "--initial-branch=main");
  const seed = tmp("seed");
  sh(seed, "init", "--quiet", "--initial-branch=main");
  const commit = (f: string) => {
    writeFileSync(join(seed, f), f);
    sh(seed, "add", ".");
    sh(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", f);
  };
  commit("one");
  const pinned = sh(seed, "rev-parse", "HEAD");
  commit("two");
  sh(seed, "push", "--quiet", bare, "main");
  sh(seed, "checkout", "--quiet", "-b", "aloe/staging");
  commit("staged");
  sh(seed, "push", "--quiet", bare, "aloe/staging");
  return { bare, url: `file://${bare}`, pinned, main: sh(bare, "rev-parse", "main") };
}

class FakePrs implements PrCloser {
  open = [{ number: 7 }, { number: 9 }];
  closed: number[] = [];
  async listOpenPrs() {
    return this.open;
  }
  async closePr(a: { number: number }) {
    this.closed.push(a.number);
  }
}

let db: AloeDb;
let remote: ReturnType<typeof makeRemote>;
let prs: FakePrs;
let gitCalls: string[][];
let cacheDir: string;

beforeEach(() => {
  const o = openDb(":memory:");
  migrate(o.sqlite);
  db = o.db;
  remote = makeRemote();
  prs = new FakePrs();
  gitCalls = [];
  cacheDir = tmp("cache");
  db.insert(schema.projects)
    .values({ id: "p1", name: "P", emoji: "x", owner: "o", cause: "climate", tagline: "t", about: "a", type: "t", region: "r", url: "u", repoUrl: "https://github.com/o/r", createdAt: T0 })
    .run();
});

function resetter(over: Partial<DemoResetConfig> = {}) {
  const recording: GitRunner = (args, opts) => {
    gitCalls.push(args);
    return runGit(args, opts);
  };
  return createDemoResetter({
    db,
    enabled: true,
    demoRepo: "o/r",
    baseCommit: remote.pinned,
    token: TOKEN,
    github: prs,
    cacheDir,
    git: recording,
    resolveRepo: (u) => (u === "https://github.com/o/r" ? { owner: "o", repo: "r", cloneUrl: remote.url } : null),
    ...over,
  });
}
const ledgerRow = () => {
  ensurePublishTable(db);
  return db.insert(stagingPublishes).values({ taskId: "t1", projectId: "p1", submissionId: "s1", status: "published", createdAt: T0, updatedAt: T0 }).run();
};

describe("demo reset: happy path", () => {
  it("closes PRs, force-sets both aloe branches to the pinned commit, clears the ledger and the cache clone", async () => {
    ledgerRow();
    const clone = cloneDirFor(cacheDir, remote.url, "r");
    mkdirSync(clone, { recursive: true });
    const res = await resetter().reset();

    expect(res).toMatchObject({ ok: true, closedPrs: 2, resetBranches: ["aloe/demo-base", "aloe/staging"], commit: remote.pinned });
    expect(prs.closed).toEqual([7, 9]);
    expect(sh(remote.bare, "rev-parse", "aloe/demo-base")).toBe(remote.pinned);
    expect(sh(remote.bare, "rev-parse", "aloe/staging")).toBe(remote.pinned); // was ahead; force moved it back
    expect(sh(remote.bare, "rev-parse", "main")).toBe(remote.main); // default branch untouched
    expect(db.select().from(stagingPublishes).all()).toHaveLength(0);
    expect(existsSync(clone)).toBe(false);
  });

  it("never puts the token in git arguments", async () => {
    await resetter().reset();
    expect(gitCalls.length).toBeGreaterThan(3);
    const all = gitCalls.flat().join(" ");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString("base64"));
  });

  it("scrubs the token from failure messages", async () => {
    const boom: GitRunner = async () => {
      throw new Error(`git push failed: bad credentials ${TOKEN}`);
    };
    const res = await resetter({ git: boom }).reset();
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(TOKEN);
  });
});

describe("demo reset: hard safety refusals", () => {
  const untouched = () => {
    expect(prs.closed).toEqual([]);
    expect(sh(remote.bare, "rev-parse", "aloe/staging")).not.toBe(remote.pinned);
    expect(sh(remote.bare, "rev-parse", "main")).toBe(remote.main);
  };

  it("refuses when ALOE_PUBLISH_STAGING is not on", async () => {
    const res = await resetter({ enabled: false }).reset();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/ALOE_PUBLISH_STAGING/);
    untouched();
  });

  it("refuses when GITHUB_DEMO_REPO is unset", async () => {
    expect((await resetter({ demoRepo: undefined }).reset()).ok).toBe(false);
    untouched();
  });

  it("refuses a repo that is not GITHUB_DEMO_REPO, even if a project uses it", async () => {
    const res = await resetter({ demoRepo: "someone-else/precious" }).reset();
    expect(res).toMatchObject({ ok: false, closedPrs: 0, resetBranches: [] });
    untouched();
  });

  it("refuses a base branch that is not under aloe/ (e.g. the fork's trunk)", async () => {
    for (const branch of ["main", "trunk", "aloe", "aloe/../main", "refs/heads/aloe/x", "aloe/x/"]) {
      const res = await resetter({ baseBranch: branch }).reset();
      expect(res.ok, branch).toBe(false);
    }
    untouched();
  });

  it("refuses when an aloe/ branch is somehow the repo's default branch", async () => {
    sh(remote.bare, "symbolic-ref", "HEAD", "refs/heads/aloe/staging");
    const res = await resetter().reset();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/default branch/);
    expect(sh(remote.bare, "rev-parse", "main")).toBe(remote.main);
  });

  it("refuses a malformed commit pin", async () => {
    expect((await resetter({ baseCommit: "main" }).reset()).ok).toBe(false);
    expect((await resetter({ baseCommit: "--force" }).reset()).ok).toBe(false);
    untouched();
  });

  it("leaves the ledger alone when it refuses", async () => {
    ledgerRow();
    await resetter({ enabled: false }).reset();
    expect(db.select().from(stagingPublishes).all()).toHaveLength(1);
  });

  it("isSafeDemoRef only allows plain aloe/ names", () => {
    expect(isSafeDemoRef("aloe/staging")).toBe(true);
    expect(isSafeDemoRef("aloe/demo-base")).toBe(true);
    for (const r of ["main", "aloe", "aloe/", "xaloe/a", "aloe/a b", "aloe/..", "aloe/a..b", "aloe/a;rm", "aloe/x.lock", "/aloe/x"]) expect(isSafeDemoRef(r), r).toBe(false);
  });
});

describe("DB reset and the API", () => {
  it("resetAndSeed clears the publish ledger", () => {
    resetAndSeed(db, T0);
    ledgerRow();
    resetAndSeed(db, T0);
    expect(db.select().from(stagingPublishes).all()).toHaveLength(0);
  });

  it("clearLedger works on a database that has no ledger table yet", () => {
    expect(() => clearLedger(db)).not.toThrow();
  });

  it("POST /api/demo/reset without a body only resets the DB; with {github:true} it also reports the GitHub result", async () => {
    const reset = vi.fn(async () => ({ ok: true, message: "done", closedPrs: 1, resetBranches: ["aloe/demo-base", "aloe/staging"], commit: "a".repeat(40) }));
    const app = createApp(db, { now: () => T0, webDist: null, publisher: null, demoResetter: { reset } });
    const plain = await app.request("/api/demo/reset", { method: "POST" });
    expect(await plain.json()).toEqual({ ok: true });
    expect(reset).not.toHaveBeenCalled();

    const full = await app.request("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ github: true }) });
    expect(full.status).toBe(200);
    expect(await full.json()).toMatchObject({ ok: true, github: { ok: true, closedPrs: 1 } });
    expect(reset).toHaveBeenCalledOnce();

    const bad = await app.request("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ github: "yes" }) });
    expect(bad.status).toBe(400);
  });
});
