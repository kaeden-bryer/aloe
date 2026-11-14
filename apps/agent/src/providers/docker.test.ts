import { describe, expect, it } from "vitest";
import { dockerRunArgs, resolveSandboxImage, type SandboxOptions } from "./docker.ts";

const base: SandboxOptions = {
  image: "aloe-sandbox",
  mode: "code",
  worktree: "/w",
  taskDir: "/t",
  signal: new AbortController().signal,
};

describe("dockerRunArgs", () => {
  it("cuts the network for test runs only (code and review need the model API)", () => {
    expect(dockerRunArgs({ ...base, mode: "test", shellCommand: "true" }, "n")).toEqual(
      expect.arrayContaining(["--network", "none"]),
    );
    expect(dockerRunArgs({ ...base, mode: "code" }, "n")).not.toContain("--network");
    expect(dockerRunArgs({ ...base, mode: "review" }, "n")).not.toContain("--network");
  });

  it("never gives the API key to test runs", () => {
    expect(dockerRunArgs({ ...base, mode: "test", shellCommand: "true" }, "n")).not.toContain("ANTHROPIC_API_KEY");
    expect(dockerRunArgs(base, "n")).toContain("ANTHROPIC_API_KEY");
  });

  it("puts the image before the command, after the entrypoint override", () => {
    const args = dockerRunArgs({ ...base, mode: "test", image: "aloe-sandbox-ccf", shellCommand: "ccf-link && jest" }, "n");
    expect(args.slice(-5)).toEqual(["--entrypoint", "sh", "aloe-sandbox-ccf", "-c", "ccf-link && jest"]);
  });
});

describe("resolveSandboxImage", () => {
  it("uses the project's image when allowed, else the fallback", () => {
    expect(resolveSandboxImage({ sandboxImage: "aloe-sandbox-ccf" })).toBe("aloe-sandbox-ccf");
    expect(resolveSandboxImage({ sandboxImage: "aloe-sandbox-ccf:2026.11" })).toBe("aloe-sandbox-ccf:2026.11");
    expect(resolveSandboxImage({})).toBe("aloe-sandbox");
    expect(resolveSandboxImage({}, "mine")).toBe("mine");
  });

  it("refuses anything that is not an aloe-sandbox image", () => {
    for (const bad of ["ubuntu", "evil.example.com/aloe-sandbox", "aloe-sandbox-ccf; rm -rf /", "aloe-sandbox@sha256:abc", "-v/:/host", "", "Aloe-sandbox"]) {
      expect(() => resolveSandboxImage({ sandboxImage: bad }), bad).toThrow(/refusing sandbox image/);
    }
  });
});
