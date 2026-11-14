/**
 * The steward's escalation policy as a pure function.
 *
 * Pure = no database, no network, no clock: same input, same output. That makes
 * it trivial to unit-test and easy to explain to judges, and it is exactly the
 * table from the executive summary:
 *
 *   Fully automatic                 tests, docs, lint, deps that pass CI
 *   Automatic, sampled human audit  feature work inside one module, hidden tests pass
 *   Always a human                  interface, security, personal data, release
 *   Human when uncertain            verifiers unsure, flaky/failed hidden tests on risky work
 *
 */
import type { ReviewVerdict, TaskCategory } from "./contracts.ts";

export type RouteOutcome = "auto_merge" | "spot_check" | "maintainer" | "retry";

export interface RouteInput {
  category: TaskCategory;
  testsPassed: boolean;
  hiddenTestsPassed: boolean;
  reviewVerdict: ReviewVerdict;
  /** How many verified results the authoring donor already has. */
  authorVerifiedCount: number;
  /** How many times this task has been attempted (claims). */
  attempts: number;
}

/** After this many failed attempts, stop retrying and ask a human. */
export const MAX_ATTEMPTS = 3;

/** Donors with at least this many verified results get spot checks instead of full review. */
export const TRUSTED_AFTER = 5;

const ALWAYS_HUMAN: ReadonlySet<TaskCategory> = new Set(["interface", "security", "personal-data", "release"]);
const LOW_RISK: ReadonlySet<TaskCategory> = new Set(["tests", "docs", "lint", "deps"]);

/**
 * Rules, in order:
 * 1. category in {interface, security, personal-data, release} -> 'maintainer' (always, even if all checks pass)
 * 2. reviewVerdict 'unsure' -> 'maintainer'
 * 3. tests or hidden tests failed, or verdict 'reject' -> attempts >= MAX_ATTEMPTS ? 'maintainer' : 'retry'
 * 4. category in {tests, docs, lint, deps} -> 'auto_merge'
 * 5. category 'feature' -> authorVerifiedCount >= TRUSTED_AFTER ? 'spot_check' : 'maintainer'
 */
export function route(input: RouteInput): RouteOutcome {
  // Rule 1 comes first on purpose: green tests are not enough when a change
  // touches a public interface, security, personal data or a release.
  if (ALWAYS_HUMAN.has(input.category)) return "maintainer";
  if (input.reviewVerdict === "unsure") return "maintainer";

  const failed = !input.testsPassed || !input.hiddenTestsPassed || input.reviewVerdict === "reject";
  if (failed) return input.attempts >= MAX_ATTEMPTS ? "maintainer" : "retry";

  if (LOW_RISK.has(input.category)) return "auto_merge";

  // Only 'feature' is left. Trusted donors earn sampled audits instead of full review.
  return input.authorVerifiedCount >= TRUSTED_AFTER ? "spot_check" : "maintainer";
}

/**
 * One plain-language sentence on why `route()` sent work to a maintainer.
 * Shown to the human in the decision card, so they know what to look at.
 */
export function explainEscalation(input: RouteInput): string {
  if (ALWAYS_HUMAN.has(input.category)) {
    return `Changes in the '${input.category}' category always go to a maintainer, even when every check passes.`;
  }
  if (input.reviewVerdict === "unsure") return "The reviewing agent was unsure, so a maintainer decides.";
  const failed = !input.testsPassed || !input.hiddenTestsPassed || input.reviewVerdict === "reject";
  if (failed) return `It failed verification after ${input.attempts} attempts, so a maintainer takes a look.`;
  return "Feature work from a donor without a long verified track record gets a full maintainer review.";
}
