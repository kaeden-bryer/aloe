import { describe, expect, it } from "vitest";
import { ResetDemoRequest, TaskSpec } from "./contracts.ts";

const spec = { goal: "g", acceptanceCriteria: ["c"], filesInScope: [], category: "docs", testCommand: "true" };

describe("TaskSpec.maxTurns", () => {
  it("is optional and accepts 1..50 whole numbers only", () => {
    expect(TaskSpec.safeParse(spec).success).toBe(true);
    expect(TaskSpec.safeParse({ ...spec, maxTurns: 8 }).success).toBe(true);
    for (const bad of [0, 51, 2.5, "8"]) expect(TaskSpec.safeParse({ ...spec, maxTurns: bad }).success, String(bad)).toBe(false);
  });
});

describe("ResetDemoRequest", () => {
  it("allows an empty body and a boolean github flag", () => {
    expect(ResetDemoRequest.parse({})).toEqual({});
    expect(ResetDemoRequest.parse({ github: true })).toEqual({ github: true });
    expect(ResetDemoRequest.safeParse({ github: "yes" }).success).toBe(false);
  });
});
