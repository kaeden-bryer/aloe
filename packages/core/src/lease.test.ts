import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { backings, decisions, devices, donors, events, projects, tasks } from "./schema.ts";
import { claimTask, heartbeat, recordVerification, releaseTask, submitWork } from "./lease.ts";
import { assertTransition, IllegalTransitionError } from "./states.ts";
import type { TaskCategory, TaskKind } from "./contracts.ts";
import { MAX_ATTEMPTS, TRUSTED_AFTER } from "./routing.ts";

// A fixed clock. Every call passes `now` explicitly, so tests never depend on wall time.
const T0 = 1_750_000_000_000;

function setup() {
  const { db, sqlite } = openDb(":memory:");
  migrate(sqlite);

  db.insert(projects)
    .values({
      id: "p1",
      name: "Test Project",
      emoji: "🌱",
      owner: "Owner",
      cause: "eco",
      tagline: "t",
      about: "a",
      type: "Open software",
      region: "Global",
      url: "https://example.org",
      repoUrl: "https://github.com/example/p1",
      createdAt: T0,
    })
    .run();
  for (const id of ["alice", "bob"]) {
    db.insert(donors).values({ id, name: id, email: `${id}@example.org`, createdAt: T0 }).run();
    // Both back p1, so both may take its code tasks.
    db.insert(backings).values({ donorId: id, projectId: "p1", createdAt: T0 }).run();
  }
  // Alice has two machines; Bob has one.
  const deviceRows = [
    { id: "a1", donorId: "alice" },
    { id: "a2", donorId: "alice" },
    { id: "b1", donorId: "bob" },
  ];
  for (const d of deviceRows) {
    db.insert(devices).values({ ...d, name: d.id, tokenHash: `hash-${d.id}`, createdAt: T0 }).run();
  }

  let n = 0;
  const addTask = (category: TaskCategory, priority = 0) => {
    const id = `t${++n}`;
    db.insert(tasks)
      .values({
        id,
        projectId: "p1",
        kind: "code",
        title: `Task ${id} (${category})`,
        spec: { goal: "Do it", acceptanceCriteria: ["Works"], filesInScope: ["src/x.ts"], category, testCommand: "npm test" },
        priority,
        createdAt: T0 + n, // later tasks are newer, so ties break oldest-first
        updatedAt: T0 + n,
      })
      .run();
    return id;
  };

  const claim = (deviceId: string, now: number, kinds: TaskKind[] = ["code", "verify"], leaseMs?: number) =>
    claimTask(db, { deviceId, donorId: deviceId === "b1" ? "bob" : "alice", kinds, now, leaseMs });

  const getTask = (id: string) => db.select().from(tasks).where(eq(tasks.id, id)).get()!;

  return { db, sqlite, addTask, claim, getTask };
}

const work = { patch: "diff --git a/x b/x", summary: "Did it", model: "test-model", harness: "test" };
const pass = { testsPassed: true, hiddenTestsPassed: true, reviewVerdict: "approve" as const, notes: "LGTM" };

/** Alice claims and submits `taskId`; returns the verify task Bob should get. */
function aliceSubmits(env: ReturnType<typeof setup>, now: number) {
  const claimed = env.claim("a1", now, ["code"])!;
  const res = submitWork(env.db, { taskId: claimed.id, deviceId: "a1", donorId: "alice", now: now + 1, leaseToken: claimed.leaseToken, ...work });
  if (!res.ok) throw new Error(`submit failed: ${res.reason}`);
  return { codeTaskId: claimed.id, ...res };
}

describe("claimTask", () => {
  it("never hands the same task to two claimers", () => {
    const env = setup();
    env.addTask("tests");
    env.addTask("docs");

    const first = env.claim("a1", T0);
    const second = env.claim("b1", T0);
    const third = env.claim("a2", T0);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
    expect(third).toBeNull();
  });

  it("returns the highest priority first and increments token and attempts", () => {
    const env = setup();
    env.addTask("tests", 1);
    const important = env.addTask("docs", 5);

    const claimed = env.claim("a1", T0)!;
    expect(claimed.id).toBe(important);
    expect(claimed.leaseToken).toBe(1);
    expect(claimed.repoUrl).toBe("https://github.com/example/p1");
    expect(env.getTask(important)).toMatchObject({ state: "leased", leaseDeviceId: "a1", attempts: 1 });
  });

  it("puts verify tasks ahead of every code task", () => {
    const env = setup();
    env.addTask("tests", 0);
    env.addTask("docs", 900); // very important code task
    const { verifyTaskId } = aliceSubmits(env, T0);

    const next = env.claim("b1", T0 + 10)!;
    expect(next.id).toBe(verifyTaskId);
    expect(next.kind).toBe("verify");
    expect(next.review?.patch).toBe(work.patch);
  });

  it("lazily expires leases: after expiry another device can claim and the token increments", () => {
    const env = setup();
    const id = env.addTask("tests");

    const first = env.claim("a1", T0, ["code"], 1_000)!;
    expect(env.claim("b1", T0 + 999, ["code"])).toBeNull(); // still live

    const second = env.claim("b1", T0 + 1_001, ["code"])!;
    expect(second.id).toBe(id);
    expect(second.leaseToken).toBe(first.leaseToken + 1);
    expect(env.getTask(id)).toMatchObject({ state: "leased", leaseDeviceId: "b1", attempts: 2 });
  });

  it("returns null when nothing is claimable", () => {
    const env = setup();
    expect(env.claim("a1", T0)).toBeNull();
  });
});

describe("fencing tokens", () => {
  it("rejects a stale holder's heartbeat and submit after its task was re-claimed", () => {
    const env = setup();
    const id = env.addTask("tests");
    const stale = env.claim("a1", T0, ["code"], 1_000)!;
    const fresh = env.claim("b1", T0 + 2_000, ["code"])!;

    // Alice's laptop wakes up holding token 1.
    expect(heartbeat(env.db, { taskId: id, deviceId: "a1", leaseToken: stale.leaseToken, now: T0 + 2_001 })).toEqual({
      ok: false,
      reason: "lease_lost",
    });
    const staleSubmit = submitWork(env.db, {
      taskId: id,
      deviceId: "a1",
      donorId: "alice",
      now: T0 + 2_002,
      leaseToken: stale.leaseToken,
      ...work,
    });
    expect(staleSubmit).toEqual({ ok: false, reason: "lease_lost" });

    // Bob, the current holder, is unaffected.
    const hb = heartbeat(env.db, { taskId: id, deviceId: "b1", leaseToken: fresh.leaseToken, now: T0 + 2_003, leaseMs: 5_000 });
    expect(hb).toEqual({ ok: true, leaseExpiresAt: T0 + 2_003 + 5_000 });
  });

  it("rejects the right token from the wrong device, an expired lease, and unknown tasks", () => {
    const env = setup();
    const id = env.addTask("tests");
    const c = env.claim("a1", T0, ["code"], 1_000)!;

    expect(heartbeat(env.db, { taskId: id, deviceId: "a2", leaseToken: c.leaseToken, now: T0 + 1 })).toMatchObject({ reason: "lease_lost" });
    expect(heartbeat(env.db, { taskId: id, deviceId: "a1", leaseToken: c.leaseToken, now: T0 + 1_000 })).toMatchObject({ reason: "lease_lost" });
    expect(heartbeat(env.db, { taskId: "nope", deviceId: "a1", leaseToken: 1, now: T0 })).toEqual({ ok: false, reason: "not_found" });
  });

  it("lets the holder release a task back to the queue", () => {
    const env = setup();
    const id = env.addTask("tests");
    const c = env.claim("a1", T0)!;

    expect(releaseTask(env.db, { taskId: id, deviceId: "a1", leaseToken: c.leaseToken, now: T0 + 1 })).toEqual({ ok: true });
    expect(env.getTask(id)).toMatchObject({ state: "queued", leaseDeviceId: null, leaseExpiresAt: null });
    expect(env.claim("b1", T0 + 2)!.leaseToken).toBe(2);
  });
});

describe("verification", () => {
  it("never offers a verify task to the author's donor, on any of their devices", () => {
    const env = setup();
    env.addTask("tests");
    const { verifyTaskId } = aliceSubmits(env, T0);

    expect(env.claim("a1", T0 + 10, ["verify"])).toBeNull();
    expect(env.claim("a2", T0 + 10, ["verify"])).toBeNull();
    expect(env.getTask(verifyTaskId)).toMatchObject({ state: "queued", excludedDonorId: "alice" });
    expect(env.claim("b1", T0 + 10, ["verify"])!.id).toBe(verifyTaskId);
  });

  it("full flow: submit -> verify -> merged, crediting the author", () => {
    const env = setup();
    env.addTask("tests");
    const { codeTaskId, verifyTaskId } = aliceSubmits(env, T0);
    expect(env.getTask(codeTaskId).state).toBe("verifying");

    const v = env.claim("b1", T0 + 10)!;
    const res = recordVerification(env.db, { taskId: v.id, deviceId: "b1", donorId: "bob", now: T0 + 20, leaseToken: v.leaseToken, ...pass });

    expect(res).toEqual({ ok: true, outcome: "auto_merge", codeTaskId });
    expect(env.getTask(codeTaskId).state).toBe("merged");
    expect(env.getTask(verifyTaskId).state).toBe("done");
    expect(env.db.select().from(donors).where(eq(donors.id, "alice")).get()!.verifiedCount).toBe(1);
    const types = env.db.select().from(events).all().map((e) => e.type);
    expect(types).toEqual(["task.claimed", "task.submitted", "task.claimed", "task.verified", "task.merged"]);
  });

  it("an 'interface' task is escalated with a decisions row, even when everything passes", () => {
    const env = setup();
    env.addTask("interface");
    const { codeTaskId } = aliceSubmits(env, T0);
    const v = env.claim("b1", T0 + 10)!;
    const res = recordVerification(env.db, { taskId: v.id, deviceId: "b1", donorId: "bob", now: T0 + 20, leaseToken: v.leaseToken, ...pass });

    expect(res).toMatchObject({ ok: true, outcome: "maintainer" });
    expect(env.getTask(codeTaskId).state).toBe("escalated");
    const rows = env.db.select().from(decisions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: codeTaskId, projectId: "p1", status: "open" });
    expect(rows[0]!.options.map((o) => o.id)).toContain("approve");
  });

  it("a trusted author's feature is merged with a sampled audit", () => {
    const env = setup();
    env.db.update(donors).set({ verifiedCount: TRUSTED_AFTER }).where(eq(donors.id, "alice")).run();
    env.addTask("feature");
    aliceSubmits(env, T0);
    const v = env.claim("b1", T0 + 10)!;
    const res = recordVerification(env.db, { taskId: v.id, deviceId: "b1", donorId: "bob", now: T0 + 20, leaseToken: v.leaseToken, ...pass });

    expect(res).toMatchObject({ outcome: "spot_check" });
    expect(env.db.select().from(events).where(eq(events.type, "audit.sampled")).all()).toHaveLength(1);
  });

  it("failed tests send the task back to the queue, and it can be claimed again", () => {
    const env = setup();
    env.addTask("tests");
    const { codeTaskId } = aliceSubmits(env, T0);
    const v = env.claim("b1", T0 + 10)!;
    const res = recordVerification(env.db, {
      taskId: v.id,
      deviceId: "b1",
      donorId: "bob",
      now: T0 + 20,
      leaseToken: v.leaseToken,
      ...pass,
      testsPassed: false,
    });

    expect(res).toMatchObject({ ok: true, outcome: "retry" });
    expect(env.getTask(codeTaskId)).toMatchObject({ state: "queued", leaseDeviceId: null });
    const again = env.claim("a1", T0 + 30, ["code"])!;
    expect(again.id).toBe(codeTaskId);
    expect(again.leaseToken).toBe(2);
  });

  it(`escalates after ${MAX_ATTEMPTS} failed attempts`, () => {
    const env = setup();
    env.addTask("tests");
    let outcome: string | undefined;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const now = T0 + i * 100;
      aliceSubmits(env, now);
      const v = env.claim("b1", now + 10)!;
      const res = recordVerification(env.db, { taskId: v.id, deviceId: "b1", donorId: "bob", now: now + 20, leaseToken: v.leaseToken, ...pass, reviewVerdict: "reject" });
      outcome = res.ok ? res.outcome : res.reason;
    }
    expect(outcome).toBe("maintainer");
  });
});

describe("state machine", () => {
  it("throws on an illegal transition", () => {
    expect(() => assertTransition("merged", "leased")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("queued", "merged")).toThrow(/queued -> merged/);
  });

  it("refuses to treat a verify task as a code submission", () => {
    const env = setup();
    env.addTask("tests");
    aliceSubmits(env, T0);
    const v = env.claim("b1", T0 + 10)!;
    const res = submitWork(env.db, { taskId: v.id, deviceId: "b1", donorId: "bob", now: T0 + 11, leaseToken: v.leaseToken, ...work });
    expect(res).toEqual({ ok: false, reason: "illegal_transition" });
  });

  it("does not accept the same verification twice", () => {
    const env = setup();
    env.addTask("tests");
    aliceSubmits(env, T0);
    const v = env.claim("b1", T0 + 10)!;
    const input = { taskId: v.id, deviceId: "b1", donorId: "bob", now: T0 + 20, leaseToken: v.leaseToken, ...pass };
    expect(recordVerification(env.db, input).ok).toBe(true);
    expect(recordVerification(env.db, input)).toEqual({ ok: false, reason: "lease_lost" });
  });
});

describe("backing", () => {
  it("only gives code tasks from projects the donor backs", () => {
    const env = setup();
    env.db.insert(projects)
      .values({ ...env.db.select().from(projects).where(eq(projects.id, "p1")).get()!, id: "p2", name: "Other" })
      .run();
    const t1 = env.addTask("tests");
    env.db.update(tasks).set({ projectId: "p2", priority: 100 }).where(eq(tasks.id, t1)).run();
    const t2 = env.addTask("tests");
    // t1 has higher priority, but Alice doesn't back p2, so she gets t2.
    expect(env.claim("a1", T0, ["code"])?.id).toBe(t2);
  });

  it("gives a donor who backs nothing verify work only", () => {
    const env = setup();
    env.db.delete(backings).where(eq(backings.donorId, "bob")).run();
    env.addTask("tests");
    expect(env.claim("b1", T0, ["code"])).toBeNull();
    const { verifyTaskId } = aliceSubmits(env, T0);
    expect(env.claim("b1", T0 + 10, ["code", "verify"])?.id).toBe(verifyTaskId);
  });
});
