import { describe, expect, it } from "vitest";
import { effectiveMaxTurns, turnCeiling } from "./turns.ts";

describe("turn cap", () => {
  it("uses the smaller of spec.maxTurns and the donor ceiling", () => {
    expect(effectiveMaxTurns({ maxTurns: 8 }, 30)).toBe(8);
    expect(effectiveMaxTurns({ maxTurns: 50 }, 30)).toBe(30);
    expect(effectiveMaxTurns({}, 30)).toBe(30);
  });
  it("the ceiling comes from the option, then ALOE_MAX_TURNS, then 30; junk is ignored", () => {
    expect(turnCeiling(5, { ALOE_MAX_TURNS: "9" })).toBe(5);
    expect(turnCeiling(undefined, { ALOE_MAX_TURNS: "9" })).toBe(9);
    expect(turnCeiling(undefined, {})).toBe(30);
    expect(turnCeiling(undefined, { ALOE_MAX_TURNS: "lots" })).toBe(30);
    expect(turnCeiling(undefined, { ALOE_MAX_TURNS: "-2" })).toBe(30);
  });
});
