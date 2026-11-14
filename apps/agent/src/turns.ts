/**
 * How many model turns a run may use.
 *
 * Two limits meet here: the donor's own ceiling (ALOE_MAX_TURNS, default 30,
 * protects their API bill) and the task's optional `spec.maxTurns` (lets the
 * steward say "this one is tiny, fail fast"). The smaller wins, so a task can
 * only ever tighten the donor's limit, never raise it.
 */
export const DEFAULT_MAX_TURNS = 30;

/** The donor's ceiling: explicit option, else ALOE_MAX_TURNS, else 30. Junk values fall back to 30. */
export function turnCeiling(opt: number | undefined, env: NodeJS.ProcessEnv = process.env): number {
  if (opt !== undefined) return opt;
  const fromEnv = Number(env.ALOE_MAX_TURNS);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_TURNS;
}

export function effectiveMaxTurns(spec: { maxTurns?: number }, ceiling: number): number {
  return spec.maxTurns === undefined ? ceiling : Math.min(spec.maxTurns, ceiling);
}
