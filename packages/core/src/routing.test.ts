import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, route, TRUSTED_AFTER, type RouteInput } from "./routing.ts";
import type { TaskCategory } from "./contracts.ts";

/** A fully green result; each test changes only what it is about. */
const green = (over: Partial<RouteInput> = {}): RouteInput => ({
  category: "tests",
  testsPassed: true,
  hiddenTestsPassed: true,
  reviewVerdict: "approve",
  authorVerifiedCount: 0,
  attempts: 1,
  ...over,
});

const ALWAYS_HUMAN: TaskCategory[] = ["interface", "security", "personal-data", "release"];
const LOW_RISK: TaskCategory[] = ["tests", "docs", "lint", "deps"];

describe("route()", () => {
  describe("rule 1: some categories always go to a human", () => {
    it.each(ALWAYS_HUMAN)("%s -> maintainer even when everything passes and the author is trusted", (category) => {
      expect(route(green({ category, authorVerifiedCount: 100 }))).toBe("maintainer");
    });

    it.each(ALWAYS_HUMAN)("%s -> maintainer (not retry) even when tests fail early", (category) => {
      expect(route(green({ category, testsPassed: false, attempts: 1 }))).toBe("maintainer");
    });
  });

  describe("rule 2: an unsure verifier escalates", () => {
    it.each([...LOW_RISK, "feature" as const])("%s + unsure -> maintainer", (category) => {
      expect(route(green({ category, reviewVerdict: "unsure", authorVerifiedCount: 100 }))).toBe("maintainer");
    });

    it("unsure wins over failed tests (no pointless retry)", () => {
      expect(route(green({ reviewVerdict: "unsure", testsPassed: false, attempts: 1 }))).toBe("maintainer");
    });
  });

  describe("rule 3: failures retry until MAX_ATTEMPTS, then escalate", () => {
    const failures: [string, Partial<RouteInput>][] = [
      ["tests failed", { testsPassed: false }],
      ["hidden tests failed", { hiddenTestsPassed: false }],
      ["verdict reject", { reviewVerdict: "reject" }],
    ];

    it.each(failures)("%s below the limit -> retry", (_, over) => {
      expect(route(green({ ...over, attempts: MAX_ATTEMPTS - 1 }))).toBe("retry");
    });

    it.each(failures)("%s at the limit -> maintainer", (_, over) => {
      expect(route(green({ ...over, attempts: MAX_ATTEMPTS }))).toBe("maintainer");
    });

    it("a failed feature by a trusted donor still retries", () => {
      expect(route(green({ category: "feature", reviewVerdict: "reject", authorVerifiedCount: 100 }))).toBe("retry");
    });
  });

  describe("rule 4: low-risk categories auto-merge", () => {
    it.each(LOW_RISK)("%s -> auto_merge", (category) => {
      expect(route(green({ category }))).toBe("auto_merge");
    });
  });

  describe("rule 5: features depend on the author's track record", () => {
    it("untrusted author -> maintainer", () => {
      expect(route(green({ category: "feature", authorVerifiedCount: TRUSTED_AFTER - 1 }))).toBe("maintainer");
    });

    it("exactly TRUSTED_AFTER verified results -> spot_check", () => {
      expect(route(green({ category: "feature", authorVerifiedCount: TRUSTED_AFTER }))).toBe("spot_check");
    });
  });
});
