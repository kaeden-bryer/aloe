import { describe, expect, it } from "vitest";
import { buildCodePrompt, parseReviewReply } from "./prompt.ts";
import { makeTask } from "./test-helpers.ts";

describe("prompts", () => {
  it("builds the code prompt from the TaskSpec only", () => {
    const prompt = buildCodePrompt(makeTask("code", 0).spec);
    expect(prompt).toContain("Goal: Add unit tests for parseRainfall()");
    expect(prompt).toContain("- Tests cover empty input");
    expect(prompt).toContain("Test command: npm test");
  });

  it("parses strict JSON review replies, fenced or not", () => {
    expect(parseReviewReply('{"verdict":"approve","notes":"ok"}')).toEqual({ verdict: "approve", notes: "ok" });
    expect(parseReviewReply('```json\n{"verdict":"reject","notes":"no tests"}\n```').verdict).toBe("reject");
  });

  it("treats anything unparsable as unsure, never approve", () => {
    expect(parseReviewReply("Looks good to me!").verdict).toBe("unsure");
    expect(parseReviewReply('{"verdict":"yes","notes":"x"}').verdict).toBe("unsure");
  });
});
