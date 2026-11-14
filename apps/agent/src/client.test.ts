import { describe, expect, it } from "vitest";
import { ApiClientError, createClient, isTransient, NetworkError, ProtocolError } from "./client.ts";
import { fakeServer } from "./test-helpers.ts";

describe("api client", () => {
  it("sends the bearer token and parses responses", async () => {
    let auth: string | null = null;
    const server = fakeServer({ "POST /api/agent/claim": () => ({ body: { task: null, retryAfterMs: 5000 } }) });
    const api = createClient({
      serverUrl: "http://aloe.test/",
      token: "secret",
      fetch: (url, init) => {
        auth = new Headers(init?.headers).get("authorization");
        return server.fetch(url, init);
      },
    });
    expect(await api.claim(["code"])).toEqual({ task: null, retryAfterMs: 5000 });
    expect(auth).toBe("Bearer secret");
  });

  it("turns an ApiError body into a typed error", async () => {
    const server = fakeServer({
      "POST /api/agent/tasks/:id/heartbeat": () => ({ status: 409, body: { error: "stale token", code: "lease_lost" } }),
    });
    const api = createClient({ serverUrl: "http://aloe.test", token: "t", fetch: server.fetch });
    const err = await api.heartbeat("t1", 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 409, code: "lease_lost" });
    expect(isTransient(err)).toBe(false);
  });

  it("rejects malformed success bodies (validate at the boundary)", async () => {
    const server = fakeServer({ "POST /api/agent/claim": () => ({ body: { task: { id: 42 } } }) });
    const api = createClient({ serverUrl: "http://aloe.test", token: "t", fetch: server.fetch });
    await expect(api.claim(["code"])).rejects.toBeInstanceOf(ProtocolError);
  });

  it("classifies network failures and 5xx as transient", async () => {
    const server = fakeServer({
      "POST /api/agent/claim": () => new Error("ECONNREFUSED"),
      "GET /api/health": () => ({ status: 503, body: "down" }),
    });
    const api = createClient({ serverUrl: "http://aloe.test", token: "t", fetch: server.fetch });
    const netErr = await api.claim(["code"]).catch((e: unknown) => e);
    expect(netErr).toBeInstanceOf(NetworkError);
    expect(isTransient(netErr)).toBe(true);
    const httpErr = await api.health().catch((e: unknown) => e);
    expect(httpErr).toMatchObject({ status: 503, code: null });
    expect(isTransient(httpErr)).toBe(true);
  });

  it("validates outgoing bodies too", async () => {
    const server = fakeServer({});
    const api = createClient({ serverUrl: "http://aloe.test", token: "t", fetch: server.fetch });
    const huge = "x".repeat(2_000_001);
    await expect(
      api.submit("t1", { leaseToken: 1, patch: huge, summary: "", model: "m", harness: "h" }),
    ).rejects.toThrow();
    expect(server.calls).toHaveLength(0);
  });
});
