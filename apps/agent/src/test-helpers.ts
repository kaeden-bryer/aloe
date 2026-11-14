/**
 * Test doubles: a virtual clock and a fake Aloe server behind a fake fetch.
 * No real server, no real sleeping.
 */
import type { ClaimedTask, TaskKind } from "@aloe/core/contracts";
import type { Clock } from "./clock.ts";
import type { FetchLike } from "./client.ts";

/** Let every pending promise callback and fake fetch run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

interface Timer {
  at: number;
  resolve: () => void;
}

/**
 * Virtual time. `sleep` registers a timer; `drive` runs a promise to
 * completion, jumping straight to the next timer whenever the code under
 * test is idle. Ten minutes of heartbeats take a few milliseconds.
 */
export class ManualClock implements Clock {
  private timers: Timer[] = [];
  /** Every sleep duration requested, in order. */
  readonly sleeps: number[] = [];

  constructor(private t = Date.UTC(2026, 10, 14, 12, 0, 0)) {}

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer: Timer = { at: this.t + ms, resolve };
      this.timers.push(timer);
      signal?.addEventListener(
        "abort",
        () => {
          this.timers = this.timers.filter((x) => x !== timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  async drive<T>(promise: Promise<T>, maxSteps = 10_000): Promise<T> {
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let step = 0; step < maxSteps; step++) {
      await flush();
      if (settled) return promise;
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers.shift();
      if (!next) throw new Error("deadlock: promise pending but no timers scheduled");
      this.t = Math.max(this.t, next.at);
      next.resolve();
    }
    throw new Error("drive: too many steps (infinite loop?)");
  }
}

export interface Call {
  method: string;
  /** Path with task ids replaced by ":id", e.g. "/api/agent/tasks/:id/submit". */
  route: string;
  path: string;
  body: any;
}

type Reply = { status?: number; body: unknown } | Error;
export type Handler = (body: any, call: Call) => Reply;

/** A fake server: map "METHOD /route" to a handler; records every call. */
export function fakeServer(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const route = path.replace(/\/tasks\/[^/]+\//, "/tasks/:id/");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { method, route, path, body };
    calls.push(call);
    const handler = handlers[`${method} ${route}`];
    if (!handler) return json(404, { error: `no route ${method} ${route}`, code: "not_found" });
    const reply = handler(body, call);
    if (reply instanceof Error) throw reply; // simulate a network failure
    return json(reply.status ?? 200, reply.body);
  };
  const called = (route: string) => calls.filter((c) => c.route === route);
  return { fetch, calls, called };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function makeTask(kind: TaskKind, now: number, overrides: Partial<ClaimedTask> = {}): ClaimedTask {
  return {
    id: kind === "code" ? "task-1" : "verify-1",
    kind,
    projectId: "proj-1",
    repoUrl: "https://example.org/repo.git",
    title: "Add tests for the rainfall parser",
    spec: {
      goal: "Add unit tests for parseRainfall()",
      acceptanceCriteria: ["Tests cover empty input"],
      filesInScope: ["src/rainfall.ts"],
      category: "tests",
      testCommand: "npm test",
    },
    leaseToken: 7,
    leaseExpiresAt: now + 5 * 60_000,
    review: kind === "verify" ? { submissionId: "sub-1", patch: "diff --git a/x b/x\n", summary: "did it" } : undefined,
    ...overrides,
  };
}
