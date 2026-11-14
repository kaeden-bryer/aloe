import { describe, expect, it } from "vitest";
import type { ClaimedTask } from "@aloe/core/contracts";
import { createClient } from "./client.ts";
import { backoffMs, heartbeatDelayMs, runLoop, withJitter, type LoopDeps, type LoopOptions } from "./loop.ts";
import { FakeProvider } from "./providers/fake.ts";
import type { AgentProvider } from "./providers/types.ts";
import { fakeServer, makeTask, ManualClock, type Handler } from "./test-helpers.ts";

const SERVER = "http://aloe.test";
const leaseLost = { status: 409, body: { error: "lease lost", code: "lease_lost" } };

function setup(handlers: Record<string, Handler>, opts: { delayMs?: number } = {}) {
  const clock = new ManualClock();
  const server = fakeServer(handlers);
  const api = createClient({ serverUrl: SERVER, token: "tok", fetch: server.fetch });
  const provider = new FakeProvider({ delayMs: opts.delayMs ?? 150_000, clock });
  const logs: string[] = [];
  const deps: Required<LoopDeps> = { api, provider, clock, random: () => 0.5, log: (l: string) => logs.push(l) };
  const run = (o: Partial<LoopOptions> = {}) =>
    clock.drive(runLoop(deps, { mode: "both", schedule: "anytime", once: true, ...o }));
  return { clock, server, deps, logs, run };
}

/** Wrap a provider so the test can see the AbortSignal it was given. */
function spy(provider: AgentProvider) {
  const seen: { signal?: AbortSignal; finished: boolean } = { finished: false };
  const wrapped: AgentProvider = {
    name: "spy",
    async runCodeTask(task: ClaimedTask, signal: AbortSignal) {
      seen.signal = signal;
      const r = await provider.runCodeTask(task, signal);
      seen.finished = true;
      return r;
    },
    runVerifyTask: (task, signal) => provider.runVerifyTask(task, signal),
  };
  return { wrapped, seen };
}

describe("runLoop", () => {
  it("claims, heartbeats while working, then submits with the fencing token", async () => {
    let clockRef!: ManualClock;
    const t = setup({
      "POST /api/agent/claim": () => ({ body: { task: makeTask("code", clockRef.now()) } }),
      "POST /api/agent/tasks/:id/heartbeat": () => ({ body: { leaseExpiresAt: clockRef.now() + 300_000 } }),
      "POST /api/agent/tasks/:id/submit": () => ({ body: { submissionId: "s1", verifyTaskId: "v1" } }),
    });
    clockRef = t.clock;

    await t.run();

    expect(t.server.called("/api/agent/claim")[0]?.body).toEqual({ kinds: ["code", "verify"] });
    // 150s of work with a 5 minute lease: heartbeats at 60s and 120s.
    const beats = t.server.called("/api/agent/tasks/:id/heartbeat");
    expect(beats).toHaveLength(2);
    expect(beats.every((b) => b.body.leaseToken === 7)).toBe(true);

    const [submit] = t.server.called("/api/agent/tasks/:id/submit");
    expect(submit?.path).toBe("/api/agent/tasks/task-1/submit");
    expect(submit?.body).toMatchObject({ leaseToken: 7, model: "none", harness: "aloe-fake/1" });
    expect(submit?.body.patch).toContain("aloe-notes/task-1.md");
    expect(t.server.called("/api/agent/tasks/:id/release")).toHaveLength(0);
  });

  it("posts a verify result for verify tasks", async () => {
    let clockRef!: ManualClock;
    const t = setup(
      {
        "POST /api/agent/claim": () => ({ body: { task: makeTask("verify", clockRef.now()) } }),
        "POST /api/agent/tasks/:id/verify": () => ({ body: { outcome: "auto_merge" } }),
      },
      { delayMs: 1000 },
    );
    clockRef = t.clock;

    await t.run({ mode: "verify" });

    expect(t.server.called("/api/agent/claim")[0]?.body).toEqual({ kinds: ["verify"] });
    const [verify] = t.server.called("/api/agent/tasks/:id/verify");
    expect(verify?.body).toEqual({
      leaseToken: 7,
      testsPassed: true,
      hiddenTestsPassed: true,
      reviewVerdict: "approve",
      notes: expect.any(String),
    });
  });

  it("aborts the provider and submits nothing when a heartbeat says lease_lost", async () => {
    let clockRef!: ManualClock;
    const t = setup(
      {
        "POST /api/agent/claim": () => ({ body: { task: makeTask("code", clockRef.now()) } }),
        "POST /api/agent/tasks/:id/heartbeat": () => leaseLost,
      },
      { delayMs: 10 * 60_000 },
    );
    clockRef = t.clock;
    const { wrapped, seen } = spy(t.deps.provider);
    t.deps.provider = wrapped;

    await t.run();

    expect(seen.signal?.aborted).toBe(true);
    expect(seen.finished).toBe(false);
    expect(t.server.called("/api/agent/tasks/:id/heartbeat")).toHaveLength(1);
    expect(t.server.called("/api/agent/tasks/:id/submit")).toHaveLength(0);
    // The lease is gone, so there's nothing to release either.
    expect(t.server.called("/api/agent/tasks/:id/release")).toHaveLength(0);
    expect(t.logs.some((l) => l.includes("lease lost"))).toBe(true);
  });

  it("drops the result if submit itself comes back lease_lost", async () => {
    let clockRef!: ManualClock;
    const t = setup(
      {
        "POST /api/agent/claim": () => ({ body: { task: makeTask("code", clockRef.now()) } }),
        "POST /api/agent/tasks/:id/submit": () => leaseLost,
      },
      { delayMs: 1000 },
    );
    clockRef = t.clock;

    await t.run();

    expect(t.server.called("/api/agent/tasks/:id/submit")).toHaveLength(1);
    expect(t.server.called("/api/agent/tasks/:id/release")).toHaveLength(0);
  });

  it("sleeps retryAfterMs when there is no work, then claims again", async () => {
    let clockRef!: ManualClock;
    let claims = 0;
    const t = setup(
      {
        "POST /api/agent/claim": () =>
          ++claims === 1
            ? { body: { task: null, retryAfterMs: 7000 } }
            : { body: { task: makeTask("code", clockRef.now()) } },
        "POST /api/agent/tasks/:id/submit": () => ({ body: { submissionId: "s1", verifyTaskId: "v1" } }),
      },
      { delayMs: 1000 },
    );
    clockRef = t.clock;
    const start = t.clock.now();

    await t.run({ once: false, stopSignal: stopAfterSubmit(t) });

    expect(claims).toBe(2);
    // random() = 0.5 means zero jitter, so the first sleep is exactly retryAfterMs.
    expect(t.clock.sleeps[0]).toBe(7000);
    expect(t.clock.now() - start).toBeGreaterThanOrEqual(7000);
  });

  it("with --once, returns immediately when there is no work", async () => {
    const t = setup({ "POST /api/agent/claim": () => ({ body: { task: null, retryAfterMs: 7000 } }) });
    await t.run();
    expect(t.server.called("/api/agent/claim")).toHaveLength(1);
    expect(t.clock.sleeps).toEqual([]);
  });

  it("on stop: aborts work, releases the held lease and exits without submitting", async () => {
    let clockRef!: ManualClock;
    const stop = new AbortController();
    const t = setup(
      {
        "POST /api/agent/claim": () => ({ body: { task: makeTask("code", clockRef.now()) } }),
        // Simulate Ctrl-C arriving mid-task, right after the first heartbeat.
        "POST /api/agent/tasks/:id/heartbeat": () => {
          stop.abort();
          return { body: { leaseExpiresAt: clockRef.now() + 300_000 } };
        },
        "POST /api/agent/tasks/:id/release": () => ({ body: { ok: true } }),
      },
      { delayMs: 10 * 60_000 },
    );
    clockRef = t.clock;

    await t.run({ once: false, stopSignal: stop.signal });

    const releases = t.server.called("/api/agent/tasks/:id/release");
    expect(releases).toHaveLength(1);
    expect(releases[0]?.body).toEqual({ leaseToken: 7 });
    expect(t.server.called("/api/agent/tasks/:id/submit")).toHaveLength(0);
    expect(t.server.called("/api/agent/claim")).toHaveLength(1);
  });

  it("releases the lease when the provider fails", async () => {
    let clockRef!: ManualClock;
    const t = setup({
      "POST /api/agent/claim": () => ({ body: { task: makeTask("code", clockRef.now()) } }),
      "POST /api/agent/tasks/:id/release": () => ({ body: { ok: true } }),
    });
    clockRef = t.clock;
    t.deps.provider = {
      name: "broken",
      runCodeTask: async () => {
        throw new Error("git clone failed");
      },
      runVerifyTask: async () => {
        throw new Error("unused");
      },
    };

    await t.run();

    expect(t.server.called("/api/agent/tasks/:id/release")).toHaveLength(1);
    expect(t.logs.some((l) => l.includes("git clone failed"))).toBe(true);
  });

  it("backs off exponentially on network errors", async () => {
    let clockRef!: ManualClock;
    let claims = 0;
    const t = setup(
      {
        "POST /api/agent/claim": () =>
          ++claims <= 3 ? new Error("ECONNREFUSED") : { body: { task: makeTask("code", clockRef.now()) } },
        "POST /api/agent/tasks/:id/submit": () => ({ body: { submissionId: "s1", verifyTaskId: "v1" } }),
      },
      { delayMs: 1000 },
    );
    clockRef = t.clock;

    await t.run();

    expect(t.clock.sleeps.slice(0, 3)).toEqual([1000, 2000, 4000]);
    expect(t.server.called("/api/agent/tasks/:id/submit")).toHaveLength(1);
  });

  it("gives up on a 401 instead of retrying forever", async () => {
    const t = setup({
      "POST /api/agent/claim": () => ({ status: 401, body: { error: "bad token", code: "unauthorized" } }),
    });
    await expect(t.run()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("does not claim outside the donation window", async () => {
    const t = setup({});
    // ManualClock starts at 12:00 UTC; whatever the local zone, a window that
    // excludes the current local hour is outside. Pick one by checking.
    const hour = new Date(t.clock.now()).getHours();
    const schedule = hour >= 9 && hour < 17 ? "overnight" : "workday";
    await t.run({ schedule });
    expect(t.server.calls).toHaveLength(0);
  });
});

function stopAfterSubmit(t: ReturnType<typeof setup>): AbortSignal {
  // Stop the loop as soon as one submit lands.
  const stop = new AbortController();
  const original = t.deps.api.submit;
  t.deps.api = {
    ...t.deps.api,
    submit: async (...args) => {
      const r = await original(...args);
      stop.abort();
      return r;
    },
  };
  return stop.signal;
}

describe("timing helpers", () => {
  it("heartbeats at a third of the remaining lease, between 1s and 60s", () => {
    expect(heartbeatDelayMs(300_000)).toBe(60_000);
    expect(heartbeatDelayMs(30_000)).toBe(10_000);
    expect(heartbeatDelayMs(-5)).toBe(1_000);
  });

  it("jitters by +/-20%", () => {
    expect(withJitter(10_000, () => 0)).toBe(8_000);
    expect(withJitter(10_000, () => 0.5)).toBe(10_000);
    expect(withJitter(10_000, () => 0.999)).toBeLessThanOrEqual(12_000);
  });

  it("caps exponential backoff at 60s", () => {
    expect([1, 2, 3, 7, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 60_000, 60_000]);
  });
});
