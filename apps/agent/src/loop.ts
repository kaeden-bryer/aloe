/**
 * The donor agent's main loop.
 *
 * Pull model: the agent only ever makes outbound HTTP requests ("got any
 * work?"), like a GitHub self-hosted runner or a BOINC client. Donors don't
 * open ports or expose their machine; the server never calls in.
 *
 *   window open? -> claim -> [heartbeat while the provider works] -> submit / verify
 *
 * Everything with side effects (HTTP, time, the model) is injected, so the
 * tests can run the whole loop against a fake server and a virtual clock.
 */
import type { ClaimedTask, ClaimResponse, Schedule, TaskKind } from "@aloe/core/contracts";
import { isLeaseLost, isTransient, type AgentApi } from "./client.ts";
import { systemClock, type Clock } from "./clock.ts";
import type { AgentProvider } from "./providers/types.ts";
import { msUntilWindowOpens } from "./window.ts";

export type Mode = "code" | "verify" | "both";

export interface LoopDeps {
  api: AgentApi;
  provider: AgentProvider;
  clock?: Clock;
  /** Returns [0, 1). Injected so jitter is deterministic in tests. */
  random?: () => number;
  log?: (line: string) => void;
}

export interface LoopOptions {
  mode: Mode;
  schedule: Schedule;
  /** Process at most one task, then return. Returns at once if there is no work. */
  once?: boolean;
  ignoreWindow?: boolean;
  /** Abort to shut down: stops claiming, aborts current work, releases the lease. */
  stopSignal?: AbortSignal;
}

export type TaskOutcome = "submitted" | "lease_lost" | "stopped" | "failed";

const MAX_HEARTBEAT_MS = 60_000;
const MIN_HEARTBEAT_MS = 1_000;
const WINDOW_RECHECK_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;
const SUBMIT_ATTEMPTS = 5;

/** Reasons we abort a provider; `signal.reason` tells the loop which one happened. */
class LeaseLost extends Error {
  override name = "LeaseLost";
}
class StopRequested extends Error {
  override name = "StopRequested";
}

export function kindsForMode(mode: Mode): TaskKind[] {
  return mode === "both" ? ["code", "verify"] : [mode];
}

/**
 * Spread `ms` by +/-20%. Without jitter, every agent that got "no work, retry
 * in 10s" at the same moment would come back at the same moment too, hitting
 * the server in synchronized waves (a "thundering herd").
 */
export function withJitter(ms: number, random: () => number): number {
  return Math.round(ms * (0.8 + 0.4 * random()));
}

/** Exponential backoff: 1s, 2s, 4s ... capped at 60s. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

/**
 * How long to wait before the next heartbeat: a third of the lease time left,
 * so two heartbeats can fail and we still renew in time; never more than 60s.
 */
export function heartbeatDelayMs(remainingMs: number): number {
  return Math.max(MIN_HEARTBEAT_MS, Math.min(MAX_HEARTBEAT_MS, Math.floor(remainingMs / 3)));
}

export async function runLoop(deps: LoopDeps, opts: LoopOptions): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const random = deps.random ?? Math.random;
  const log = deps.log ?? ((line: string) => console.log(line));
  const stop = opts.stopSignal ?? new AbortController().signal;
  const kinds = kindsForMode(opts.mode);
  let failures = 0;

  log(`agent started: provider=${deps.provider.name} kinds=${kinds.join(",")} schedule=${opts.schedule}`);

  while (!stop.aborted) {
    if (!opts.ignoreWindow) {
      const wait = msUntilWindowOpens(opts.schedule, new Date(clock.now()));
      if (wait > 0) {
        if (opts.once) {
          log(`outside the ${opts.schedule} window; nothing to do (--once)`);
          return;
        }
        const nap = Math.min(wait, WINDOW_RECHECK_MS);
        log(`outside the ${opts.schedule} window; checking again in ${fmt(nap)}`);
        await clock.sleep(nap, stop);
        continue;
      }
    }

    let claim: ClaimResponse;
    try {
      claim = await deps.api.claim(kinds);
      failures = 0;
    } catch (err) {
      // A 401 or a malformed response won't fix itself; let the CLI report it.
      if (!isTransient(err)) throw err;
      failures++;
      const delay = withJitter(backoffMs(failures), random);
      log(`claim failed (${errMsg(err)}); retrying in ${fmt(delay)}`);
      await clock.sleep(delay, stop);
      continue;
    }

    if (claim.task === null) {
      if (opts.once) {
        log("no work available");
        return;
      }
      await clock.sleep(withJitter(claim.retryAfterMs, random), stop);
      continue;
    }

    await processTask(claim.task, { ...deps, clock, random, log }, stop);
    if (opts.once) return;
  }
  log("agent stopped");
}

type ResolvedDeps = Required<LoopDeps>;

/** Run one claimed task to completion. Never throws; returns what happened. */
export async function processTask(task: ClaimedTask, deps: ResolvedDeps, stop: AbortSignal): Promise<TaskOutcome> {
  const { api, log } = deps;
  const tag = `[${task.kind} ${task.id}]`;
  log(`${tag} claimed "${task.title}" (lease token ${task.leaseToken})`);

  // One AbortController per task. Both "lease lost" and "donor pressed Ctrl-C"
  // abort it; the provider just watches one signal and doesn't need to know why.
  const work = new AbortController();
  const onStop = () => work.abort(new StopRequested("stop requested"));
  if (stop.aborted) onStop();
  else stop.addEventListener("abort", onStop, { once: true });

  const lease = { expiresAt: task.leaseExpiresAt, lost: false };
  const heartbeatDone = new AbortController();
  const heartbeats = heartbeatLoop(task, lease, work, heartbeatDone.signal, deps, tag);

  let outcome: TaskOutcome;
  try {
    outcome = await doWork(task, deps, work.signal, lease, tag);
  } catch (err) {
    const reason = work.signal.reason;
    if (lease.lost || reason instanceof LeaseLost) {
      log(`${tag} lease lost; result dropped`);
      outcome = "lease_lost";
    } else if (reason instanceof StopRequested) {
      log(`${tag} stopped before finishing`);
      outcome = "stopped";
    } else {
      log(`${tag} failed: ${errMsg(err)}`);
      outcome = "failed";
    }
  } finally {
    // Always stop heartbeating, whatever happened, or a finished task would
    // keep its lease alive forever.
    heartbeatDone.abort();
    await heartbeats;
    stop.removeEventListener("abort", onStop);
  }

  // Give the task back so another donor can pick it up now rather than
  // waiting for the lease to expire. Pointless if the lease is already gone.
  if ((outcome === "stopped" || outcome === "failed") && !lease.lost) {
    try {
      await api.release(task.id, task.leaseToken);
      log(`${tag} released`);
    } catch (err) {
      log(`${tag} release failed (${errMsg(err)}); the lease will expire on its own`);
    }
  }
  return outcome;
}

async function doWork(
  task: ClaimedTask,
  deps: ResolvedDeps,
  signal: AbortSignal,
  lease: { lost: boolean },
  tag: string,
): Promise<TaskOutcome> {
  const { api, provider, log } = deps;

  // Fencing token: every write carries task.leaseToken. If our lease expired
  // and someone else claimed the task, the server sees a stale token and
  // answers 409 lease_lost, so our late result can't overwrite theirs.
  // withRetry refuses to send once the lease is known lost: the server would
  // reject it anyway, but the agent should not even try.
  const send = async (what: string, request: () => Promise<unknown>) => {
    await withRetry(request, deps, signal, `${tag} ${what}`, lease);
    log(`${tag} ${what} ok`);
  };

  if (task.kind === "code") {
    const result = await provider.runCodeTask(task, signal);
    if (!result.patch.trim()) throw new Error("provider produced an empty patch");
    await send("submit", () => api.submit(task.id, { leaseToken: task.leaseToken, ...result }));
  } else {
    if (!task.review) throw new Error("verify task has no submission to review");
    const result = await provider.runVerifyTask(task, signal);
    log(`${tag} verdict=${result.reviewVerdict} tests=${result.testsPassed ? "pass" : "fail"}`);
    await send("verify", () => api.verify(task.id, { leaseToken: task.leaseToken, ...result }));
  }
  return "submitted";
}

/**
 * Retry transient failures (network, 5xx) a few times. We keep heartbeating
 * meanwhile, so the lease stays ours while we retry. A 409 lease_lost is final.
 */
async function withRetry(
  request: () => Promise<unknown>,
  deps: ResolvedDeps,
  signal: AbortSignal,
  label: string,
  lease: { lost: boolean },
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    if (lease.lost) throw new LeaseLost();
    try {
      await request();
      return;
    } catch (err) {
      if (isLeaseLost(err)) {
        lease.lost = true;
        throw new LeaseLost();
      }
      if (!isTransient(err) || attempt >= SUBMIT_ATTEMPTS) throw err;
      const delay = withJitter(backoffMs(attempt), deps.random);
      deps.log(`${label} failed (${errMsg(err)}); retrying in ${fmt(delay)}`);
      await deps.clock.sleep(delay, signal);
    }
  }
}

/**
 * Renew the lease until `done` aborts. A lease is a lock with an expiry: if
 * this machine sleeps or crashes, heartbeats stop, the lease runs out and the
 * server hands the task to someone else. No server-side sweeper needed.
 */
async function heartbeatLoop(
  task: ClaimedTask,
  lease: { expiresAt: number; lost: boolean },
  work: AbortController,
  done: AbortSignal,
  deps: ResolvedDeps,
  tag: string,
): Promise<void> {
  const { api, clock, log } = deps;
  // Note: leaseExpiresAt is the server's clock; we assume clocks are roughly
  // in sync. The 60s cap on a 5 minute lease leaves plenty of slack.
  while (!done.aborted) {
    await clock.sleep(heartbeatDelayMs(lease.expiresAt - clock.now()), done);
    if (done.aborted) return;
    try {
      const res = await api.heartbeat(task.id, task.leaseToken);
      lease.expiresAt = res.leaseExpiresAt;
    } catch (err) {
      // Transient failure while the lease is still valid: keep trying. The
      // next delay shrinks with the remaining time, so we retry sooner.
      if (isTransient(err) && clock.now() < lease.expiresAt) {
        log(`${tag} heartbeat failed (${errMsg(err)}); retrying`);
        continue;
      }
      // 409 lease_lost (or anything else definitive, or the lease ran out):
      // stop the provider. Its work is wasted, but submitting it is impossible.
      log(`${tag} heartbeat rejected: ${errMsg(err)}`);
      lease.lost = true;
      work.abort(new LeaseLost("lease lost"));
      return;
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmt(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`;
}
