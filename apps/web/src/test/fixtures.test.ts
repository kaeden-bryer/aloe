/**
 * The mock API must speak exactly the contract the real server does, or mock
 * mode would hide bugs. So every fixture and every mock route's response is
 * parsed with the real Zod schemas from @aloe/core/contracts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Cause, Dashboard, Decision, Me, ProjectDetail, ProjectSummary } from "@aloe/core/contracts";
import { causes, demoProjects, toProjectDetail } from "../api/fixtures";
import { __setMockState, buildMockDashboard, mockFetch } from "../api/mock";

const get = async (path: string) => (await mockFetch("GET", path)).json;

describe("fixtures", () => {
  it("causes parse", () => {
    expect(() => z.array(Cause).parse(causes)).not.toThrow();
  });

  it.each(demoProjects.map((p) => [p.id, p] as const))("project %s parses in every state", (_id, p) => {
    for (const backing of [true, false]) {
      for (const decisionOpen of [true, false]) {
        ProjectDetail.parse(toProjectDetail(p, { backing, decisionOpen, resolution: decisionOpen ? null : "Approve" }));
      }
    }
  });
});

describe("mock API routes", () => {
  beforeEach(() => __setMockState({}));

  it("GET routes return contract-shaped JSON", async () => {
    z.array(Cause).parse(await get("/api/causes"));
    const list = z.array(ProjectSummary).parse(await get("/api/projects"));
    expect(list).toHaveLength(5);
    // Summary must not leak detail-only fields.
    expect(list[0]).not.toHaveProperty("queue");
    expect(z.array(ProjectSummary).parse(await get("/api/projects?cause=health")).map((p) => p.id)).toEqual(["off", "accessmod"]);
    ProjectDetail.parse(await get("/api/projects/eae"));
    Me.parse(await get("/api/me"));
    z.array(Decision).parse(await get("/api/decisions?status=open"));
  });

  it("an empty dashboard and a full one both parse", () => {
    expect(Dashboard.parse(buildMockDashboard()).landed).toHaveLength(0);
    __setMockState({ backings: demoProjects.map((p) => p.id) });
    const full = Dashboard.parse(buildMockDashboard(Date.UTC(2026, 10, 14, 12)));
    expect(full.landed).toHaveLength(5);
    expect(full.mergedPerDay).toHaveLength(7);
    expect(full.waiting).toHaveLength(5);
  });

  it("backing, settings and decisions change state", async () => {
    await mockFetch("POST", "/api/projects/farmos/back");
    expect(Me.parse(await get("/api/me")).backings).toEqual(["farmos"]);

    const bad = await mockFetch("PUT", "/api/me/settings", { pct: 500 });
    expect(bad.status).toBe(400);

    const resolved = await mockFetch("POST", "/api/decisions/farmos-d1/resolve", { optionId: "approve" });
    expect(Decision.parse(resolved.json).status).toBe("resolved");
    expect(ProjectDetail.parse(await get("/api/projects/farmos")).openDecision).toBeNull();
    expect((await mockFetch("POST", "/api/decisions/farmos-d1/resolve", { optionId: "approve" })).status).toBe(409);

    await mockFetch("POST", "/api/demo/reset");
    expect(Me.parse(await get("/api/me")).backings).toEqual([]);
  });

  it("unknown project is a 404 ApiError", async () => {
    const r = await mockFetch("GET", "/api/projects/nope");
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ code: "not_found" });
  });
});
