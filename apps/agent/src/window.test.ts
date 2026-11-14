import { describe, expect, it } from "vitest";
import { isInWindow, msUntilWindowOpens } from "./window.ts";

// Dates built from local-time parts, matching how the window logic reads them.
const at = (h: number, m = 0) => new Date(2026, 10, 14, h, m);
const HOUR = 3_600_000;

describe("donation windows", () => {
  it("overnight wraps midnight (22:00-07:00)", () => {
    expect(isInWindow("overnight", at(22))).toBe(true);
    expect(isInWindow("overnight", at(23, 59))).toBe(true);
    expect(isInWindow("overnight", at(0))).toBe(true);
    expect(isInWindow("overnight", at(6, 59))).toBe(true);
    expect(isInWindow("overnight", at(7))).toBe(false);
    expect(isInWindow("overnight", at(12))).toBe(false);
    expect(isInWindow("overnight", at(21, 59))).toBe(false);
  });

  it("workday is 09:00-17:00", () => {
    expect(isInWindow("workday", at(8, 59))).toBe(false);
    expect(isInWindow("workday", at(9))).toBe(true);
    expect(isInWindow("workday", at(16, 59))).toBe(true);
    expect(isInWindow("workday", at(17))).toBe(false);
  });

  it("anytime is always open", () => {
    for (const h of [0, 6, 12, 18, 23]) expect(isInWindow("anytime", at(h))).toBe(true);
  });

  it("computes the wait until the window opens", () => {
    expect(msUntilWindowOpens("overnight", at(23))).toBe(0);
    expect(msUntilWindowOpens("overnight", at(12))).toBe(10 * HOUR);
    expect(msUntilWindowOpens("workday", at(8))).toBe(HOUR);
    // After 17:00 the next workday window is tomorrow morning.
    expect(msUntilWindowOpens("workday", at(18))).toBe(15 * HOUR);
  });
});
