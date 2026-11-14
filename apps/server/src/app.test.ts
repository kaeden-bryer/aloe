import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiError,
  ClaimResponse,
  Dashboard,
  Decision,
  DEFAULT_LEASE_MS,
  Me,
  migrate,
  openDb,
  PairResponse,
  ProjectDetail,
  ProjectSummary,
  type AloeDb,
} from "@aloe/core";
import { createApp } from "./app.ts";
import { resetAndSeed } from "./seed.ts";

// A fixed clock (Saturday 14 November 2026, noon UTC) that tests move by hand.
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
let clock = T0;
let db: AloeDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const opened = openDb(":memory:");
  migrate(opened.sqlite);
  db = opened.db;
  clock = T0;
  resetAndSeed(db, T0);
  app = createApp(db, { now: () => clock, pairingCode: "test-code", webDist: null });
});

type Init = { token?: string; donor?: string; method?: string };
async function call(path: string, body?: unknown, init: Init = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.donor) headers["x-aloe-donor"] = init.donor;
  const res = await app.request(path, {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function pair(donorId: string, deviceName = `${donorId}-laptop`) {
  const res = await call("/api/agent/pair", { pairingCode: "test-code", donorId, deviceName });
  expect(res.status).toBe(200);
  return PairResponse.parse(res.body).token;
}

async function claim(token: string, kinds?: ("code" | "verify")[]) {
  const res = await call("/api/agent/claim", kinds ? { kinds } : {}, { token });
  expect(res.status).toBe(200);
  return ClaimResponse.parse(res.body).task;
}

const work = { patch: "diff --git a/x b/x", summary: "Done", model: "claude-sonnet-5-5", harness: "aloe-agent/test" };
const pass = { testsPassed: true, hiddenTestsPassed: true, reviewVerdict: "approve", notes: "LGTM" };

describe("agent flow", () => {
  it("pair -> claim -> heartbeat -> submit -> another donor verifies -> merged on the dashboard", async () => {
    const aino = await pair("demo-donor");
    const mikko = await pair("demo-donor-2");

    const task = (await claim(aino, ["code"]))!;
    expect(task.kind).toBe("code");
    expect(task.spec.category).toBe("tests"); // the seed puts a low-risk task first

    clock += 60_000;
    const hb = await call(`/api/agent/tasks/${task.id}/heartbeat`, { leaseToken: task.leaseToken }, { token: aino });
    expect(hb).toEqual({ status: 200, body: { leaseExpiresAt: clock + DEFAULT_LEASE_MS } });

    const live = Dashboard.parse((await call("/api/me/dashboard")).body).live;
    expect(live).toMatchObject({ stage: "working", title: task.title });

    clock += 60_000;
    const sub = await call(`/api/agent/tasks/${task.id}/submit`, { leaseToken: task.leaseToken, ...work }, { token: aino });
    expect(sub.status).toBe(200);

    // Aino may not review her own work; Mikko gets it first because verify tasks outrank code.
    expect((await claim(aino, ["verify"]))).toBeNull();
    const review = (await claim(mikko))!;
    expect(review.id).toBe(sub.body.verifyTaskId);
    expect(review.review).toMatchObject({ submissionId: sub.body.submissionId, patch: work.patch });

    clock += 60_000;
    const verdict = await call(`/api/agent/tasks/${review.id}/verify`, { leaseToken: review.leaseToken, ...pass }, { token: mikko });
    expect(verdict).toEqual({ status: 200, body: { outcome: "auto_merge" } });

    const dash = Dashboard.parse((await call("/api/me/dashboard")).body);
    expect(dash.activity[0]).toMatchObject({ title: task.title, status: "merged" });
    expect(dash.mergedPerDay.at(-1)!.byProject[task.projectId]).toBeGreaterThanOrEqual(1);

    const project = ProjectDetail.parse((await call(`/api/projects/${task.projectId}`)).body);
    expect(project.queue.find((q) => q.id === task.id)).toMatchObject({ state: "merged", who: "Aino's agent" });
  });

  it("an interface task escalates, and a maintainer's approval merges it", async () => {
    const aino = await pair("demo-donor");
    const mikko = await pair("demo-donor-2");
    await claim(aino, ["code"]); // the tests task; leave it leased

    const risky = (await claim(aino, ["code"]))!;
    expect(risky.spec.category).toBe("interface");
    await call(`/api/agent/tasks/${risky.id}/submit`, { leaseToken: risky.leaseToken, ...work }, { token: aino });
    const review = (await claim(mikko, ["verify"]))!;
    const verdict = await call(`/api/agent/tasks/${review.id}/verify`, { leaseToken: review.leaseToken, ...pass }, { token: mikko });
    expect(verdict.body).toEqual({ outcome: "maintainer" });

    const open = z.array(Decision).parse((await call("/api/decisions?status=open")).body);
    const decision = open.find((d) => d.taskId === risky.id)!;
    expect(decision.question).toContain(risky.title);

    const resolved = await call(`/api/decisions/${decision.id}/resolve`, { optionId: "approve" });
    expect(Decision.parse(resolved.body)).toMatchObject({ status: "resolved", resolution: "Approve and merge" });
    const again = await call(`/api/decisions/${decision.id}/resolve`, { optionId: "approve" });
    expect(again.status).toBe(409);

    const project = ProjectDetail.parse((await call(`/api/projects/${risky.projectId}`)).body);
    expect(project.queue.find((q) => q.id === risky.id)?.state).toBe("merged");
  });

  it("does not hand out work while the donor is paused", async () => {
    const aino = await pair("demo-donor");
    const me = Me.parse((await call("/api/me")).body);
    const put = await call("/api/me/settings", { ...me.settings, paused: true }, { method: "PUT" });
    expect(Me.parse(put.body).settings.paused).toBe(true);

    const res = ClaimResponse.parse((await call("/api/agent/claim", {}, { token: aino })).body);
    expect(res).toMatchObject({ task: null });
  });
});

describe("agent auth and errors", () => {
  it("returns 401 without a token, with an unknown token, or with a wrong pairing code", async () => {
    const none = await call("/api/agent/claim", {});
    expect(none.status).toBe(401);
    expect(ApiError.parse(none.body).code).toBe("unauthorized");

    expect((await call("/api/agent/claim", {}, { token: "aloe_not-a-real-token" })).status).toBe(401);
    expect((await call("/api/agent/tasks/x/heartbeat", { leaseToken: 1 })).status).toBe(401);

    const badPair = await call("/api/agent/pair", { pairingCode: "nope", donorId: "demo-donor", deviceName: "x" });
    expect(badPair.status).toBe(401);
    const unknownDonor = await call("/api/agent/pair", { pairingCode: "test-code", donorId: "ghost", deviceName: "x" });
    expect(unknownDonor.status).toBe(404);
  });

  it("returns 409 lease_lost for a stale token after the lease is re-issued", async () => {
    const aino = await pair("demo-donor");
    const mikko = await pair("demo-donor-2");
    const task = (await claim(aino, ["code"]))!;

    const wrongToken = await call(`/api/agent/tasks/${task.id}/heartbeat`, { leaseToken: task.leaseToken + 1 }, { token: aino });
    expect(wrongToken.status).toBe(409);
    expect(ApiError.parse(wrongToken.body).code).toBe("lease_lost");

    // Aino's laptop sleeps past the lease; Mikko (who also backs this project) picks it up.
    await call(`/api/projects/${task.projectId}/back`, {}, { donor: "demo-donor-2" });
    clock += DEFAULT_LEASE_MS + 1;
    const taken = (await claim(mikko, ["code"]))!;
    expect(taken.id).toBe(task.id);
    expect(taken.leaseToken).toBe(task.leaseToken + 1);

    const stale = await call(`/api/agent/tasks/${task.id}/submit`, { leaseToken: task.leaseToken, ...work }, { token: aino });
    expect(stale).toEqual({ status: 409, body: { error: expect.any(String), code: "lease_lost" } });
  });

  it("validates request bodies at the boundary", async () => {
    const aino = await pair("demo-donor");
    const task = (await claim(aino, ["code"]))!;
    const res = await call(`/api/agent/tasks/${task.id}/submit`, { leaseToken: "one", patch: 5 }, { token: aino });
    expect(res.status).toBe(400);
    expect(ApiError.parse(res.body).code).toBe("bad_request");

    const notJson = await app.request("/api/agent/pair", { method: "POST", body: "{oops" });
    expect(notJson.status).toBe(400);
  });

  it("returns 404 for an unknown task", async () => {
    const aino = await pair("demo-donor");
    const res = await call("/api/agent/tasks/task_missing/heartbeat", { leaseToken: 1 }, { token: aino });
    expect(res.status).toBe(404);
  });
});

describe("web API", () => {
  it("GET /api/projects returns ProjectSummary[] and filters by cause", async () => {
    const all = z.array(ProjectSummary).parse((await call("/api/projects")).body);
    expect(all.map((p) => p.id).sort()).toEqual(["accessmod", "biomass", "ccf", "eae", "farmos", "off"]);
    expect(all.filter((p) => p.backing).map((p) => p.id).sort()).toEqual(["eae", "farmos"]);
    expect(all.every((p) => p.openTasks >= 3)).toBe(true);

    // Open Food Facts lists health as a secondary cause.
    const health = z.array(ProjectSummary).parse((await call("/api/projects?cause=health")).body);
    expect(health.map((p) => p.id).sort()).toEqual(["accessmod", "off"]);
    expect((await call("/api/projects?cause=bogus")).status).toBe(400);
  });

  it("seeds the Cloud Carbon Footprint project with 5 queued tasks, hidden tests per task, and a sandbox image", async () => {
    const detail = ProjectDetail.parse((await call("/api/projects/ccf")).body);
    expect(detail.repoUrl).toContain("kaeden-bryer/cloud-carbon-footprint");
    expect(detail.queue.filter((t) => t.state === "queued")).toHaveLength(5);
    // Hidden tests are never in a web response.
    expect(JSON.stringify(detail)).not.toContain("hidden_");

    // Back it, claim its top code task, and check the lease carries the image but no hidden tests.
    await call("/api/projects/ccf/back", {}, { donor: "demo-donor-2" });
    const token = await pair("demo-donor-2");
    const task = await claim(token, ["code"]);
    expect(task?.projectId).toBe("ccf");
    expect(task?.sandboxImage).toBe("aloe-sandbox-ccf");
    expect(task?.hiddenTests).toBeUndefined();
  });

  it("serves causes, project details, me and the dashboard in their contract shapes", async () => {
    expect((await call("/api/causes")).body).toHaveLength(5);
    const eae = ProjectDetail.parse((await call("/api/projects/eae")).body);
    expect(eae.openDecision?.question).toContain("Change the default weights");
    expect((await call("/api/projects/nope")).status).toBe(404);

    const me = Me.parse((await call("/api/me")).body);
    expect(me).toMatchObject({ name: "Aino Virtanen", email: "aino@example.org" });

    const dash = Dashboard.parse((await call("/api/me/dashboard")).body);
    expect(dash.weekLabel).toBe("Mon 9 to Sun 15 November");
    expect(dash.mergedPerDay).toHaveLength(7);
    expect(dash.activity.length).toBeGreaterThan(0);
    expect(dash.waiting.map((d) => d.projectId).sort()).toEqual(["eae", "farmos"]);

    expect((await call("/api/me", undefined, { donor: "ghost" })).status).toBe(401);
  });

  it("backs and un-backs a project", async () => {
    expect((await call("/api/projects/off/back", {})).body).toEqual({ ok: true });
    expect(Me.parse((await call("/api/me")).body).backings).toContain("off");
    await call("/api/projects/off/back", undefined, { method: "DELETE" });
    expect(Me.parse((await call("/api/me")).body).backings).not.toContain("off");
  });

  it("resets the demo", async () => {
    await call("/api/projects/off/back", {});
    expect((await call("/api/demo/reset", {})).body).toEqual({ ok: true });
    expect(Me.parse((await call("/api/me")).body).backings.sort()).toEqual(["eae", "farmos"]);
  });

  it("answers unknown API routes with a JSON 404", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(ApiError.parse(res.body).code).toBe("not_found");
  });
});

// ---------- hidden tests ----------

describe("hidden tests", () => {
  const KEY = { "x-aloe-maintainer": "aloe-maintainer-demo" };
  const suite = { command: "node hidden/check.mjs", files: [{ path: "hidden/check.mjs", content: "process.exit(0)" }] };
  const put = (projectId: string, body: unknown, query = "", headers: Record<string, string> = KEY) =>
    app.request(`/api/projects/${projectId}/hidden-tests${query}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("a code lease never receives hidden tests, a verify lease does", async () => {
    const aino = await pair("demo-donor");
    const mikko = await pair("demo-donor-2");

    const task = (await claim(aino, ["code"]))!;
    expect((await put(task.projectId, suite)).status).toBe(200);
    expect(task.hiddenTests).toBeUndefined();

    const second = (await claim(aino, ["code"]))!; // a code lease claimed after the tests exist
    expect(second.hiddenTests).toBeUndefined();
    expect(JSON.stringify(second)).not.toContain("hidden/check.mjs");

    await call(`/api/agent/tasks/${task.id}/submit`, { leaseToken: task.leaseToken, ...work }, { token: aino });
    const review = (await claim(mikko, ["verify"]))!;
    expect(review.kind).toBe("verify");
    expect(review.hiddenTests).toEqual(suite);
  });

  it("a task-level override beats the project-level suite", async () => {
    const aino = await pair("demo-donor");
    const mikko = await pair("demo-donor-2");
    const task = (await claim(aino, ["code"]))!;
    const override = { command: "node only-this.mjs", files: [] };
    await put(task.projectId, suite);
    expect((await put(task.projectId, override, `?taskId=${task.id}`)).status).toBe(200);
    await call(`/api/agent/tasks/${task.id}/submit`, { leaseToken: task.leaseToken, ...work }, { token: aino });
    expect((await claim(mikko, ["verify"]))!.hiddenTests).toEqual(override);
  });

  it("is maintainer-only and validates file paths", async () => {
    expect((await put("eae", suite, "", {})).status).toBe(401);
    expect((await put("eae", suite, "", { "x-aloe-maintainer": "wrong" })).status).toBe(401);
    for (const path of ["../x", "/etc/passwd", ".git/hooks/pre-commit", "a/../../b", "C:\\x"]) {
      expect((await put("eae", { command: "true", files: [{ path, content: "" }] })).status, path).toBe(400);
    }
    expect((await put("nope", suite)).status).toBe(404);
    expect((await put("eae", suite, "?taskId=ghost")).status).toBe(404);
  });

  it("reads back with the key and never shows up in web responses", async () => {
    await put("eae", suite);
    expect((await app.request("/api/projects/eae/hidden-tests")).status).toBe(401);
    const got = await app.request("/api/projects/eae/hidden-tests", { headers: KEY });
    expect(await got.json()).toEqual(suite);

    for (const path of ["/api/projects/eae", "/api/projects", "/api/me/dashboard", "/api/decisions"]) {
      expect(JSON.stringify((await call(path)).body), path).not.toContain("check.mjs");
    }
  });

  it("the seed gives the demo project a hidden test", async () => {
    const got = await app.request("/api/projects/eae/hidden-tests", { headers: KEY });
    expect(got.status).toBe(200);
  });
});

describe("demo reset", () => {
  it("keeps paired agents logged in across a reset", async () => {
    const aino = await pair("demo-donor");
    expect((await call("/api/demo/reset", {})).status).toBe(200);
    expect((await call("/api/agent/claim", {}, { token: aino })).status).toBe(200);
  });
});
