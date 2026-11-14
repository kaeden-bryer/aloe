/**
 * The task lifecycle, written down as data.
 *
 * Every state change in the system goes through `assertTransition`, so an
 * impossible move (say, `merged -> leased`) fails loudly instead of quietly
 * corrupting the queue. The dashboard's "Claimed / Working / Verify / Merge"
 * strip is just a view of these states.
 *
 * Code tasks:   queued -> leased -> submitted -> verifying -> merged | escalated | queued | closed
 * Verify tasks: queued -> leased -> done
 *
 * `leased -> queued` covers a client releasing a task or its lease expiring.
 */
export const TASK_STATES = [
  "queued",
  "leased",
  "submitted",
  "verifying",
  "escalated",
  "merged",
  "closed",
  "done",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  queued: ["leased", "closed"],
  leased: ["submitted", "done", "queued"],
  submitted: ["verifying", "queued"],
  verifying: ["merged", "escalated", "queued", "closed"],
  escalated: ["merged", "queued", "closed"],
  merged: [],
  closed: [],
  done: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`Illegal task transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** States in which a task is finished and will never be leased again. */
export const TERMINAL_STATES: readonly TaskState[] = ["merged", "closed", "done"];
