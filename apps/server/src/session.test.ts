/**
 * Real cookie sessions end to end (no `actAs` hook): sign in, roles, expiry, logout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AuthMe, Decision, DemoUser, migrate, openDb, schema, type AloeDb } from "@aloe/core";
import { z } from "zod";
import { createApp } from "./app.ts";
import { resetAndSeed } from "./seed.ts";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
let clock = T0;
let db: AloeDb;
let app: ReturnType<typeof createApp>;

function build(demoLogin = true) {
  app = createApp(db, { now: () => clock, pairingCode: "pc", webDist: null, demoLogin });
}

beforeEach(() => {
  const opened = openDb(":memory:");
  migrate(opened.sqlite);
  db = opened.db;
  clock = T0;
  resetAndSeed(db, T0);
  build();
});

/** A tiny cookie jar: remembers aloe_session from Set-Cookie like a browser would. */
function browser() {
  let cookie = "";
  return {
    async call(method: string, path: string, body?: unknown) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.startsWith("aloe_session=;") || /max-age=0/i.test(set) ? "" : set.split(";")[0]!;
      return { status: res.status, body: (await res.json().catch(() => null)) as any, set };
    },
    signIn(userId: string) {
      return this.call("POST", "/api/auth/demo-login", { userId });
    },
    get cookie() {
      return cookie;
    },
  };
}

describe("sessions", () => {
  it("is signed out by default: /me says so, donor routes 401, public routes work", async () => {
    const b = browser();
    expect((await b.call("GET", "/api/auth/me")).body).toEqual({ user: null, maintainerOf: [] });
    for (const path of ["/api/me", "/api/me/dashboard", "/api/me/weekly-email", "/api/decisions"]) {
      expect((await b.call("GET", path)).status, path).toBe(401);
    }
    expect((await b.call("PUT", "/api/me/settings", {})).status).toBe(401);
    expect((await b.call("POST", "/api/projects/eae/back")).status).toBe(401);
    expect((await b.call("POST", "/api/demo/reset")).status).toBe(401);
    for (const path of ["/api/causes", "/api/projects", "/api/projects/eae", "/api/health"]) {
      expect((await b.call("GET", path)).status, path).toBe(200);
    }
  });

  it("ignores the old x-aloe-donor header", async () => {
    const res = await app.request("/api/me", { headers: { "x-aloe-donor": "demo-donor" } });
    expect(res.status).toBe(401);
  });

  it("demo-login sets a httpOnly, SameSite=Lax cookie and stores only a hash", async () => {
    const b = browser();
    const res = await b.signIn("demo-donor");
    expect(res.status).toBe(200);
    expect(AuthMe.parse(res.body)).toMatchObject({ user: { id: "demo-donor" }, maintainerOf: [] });
    expect(res.set).toMatch(/^aloe_session=/);
    expect(res.set).toMatch(/HttpOnly/i);
    expect(res.set).toMatch(/SameSite=Lax/i);
    expect(res.set).toMatch(/Path=\//i);
    const token = b.cookie.split("=")[1]!;
    const rows = db.select().from(schema.sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect((await b.call("GET", "/api/me")).status).toBe(200);
  });

  it("demo-login can be limited to known users and is 404 unless ALOE_DEMO_LOGIN is on", async () => {
    expect((await browser().signIn("ghost")).status).toBe(404);
    build(false);
    const b = browser();
    expect((await b.signIn("demo-donor")).status).toBe(404);
    expect((await b.call("GET", "/api/auth/demo-users")).status).toBe(404);
    expect((await b.call("GET", "/api/auth/me")).status).toBe(200); // me/logout always exist
  });

  it("lists personas with their roles", async () => {
    const users = z.array(DemoUser).parse((await browser().call("GET", "/api/auth/demo-users")).body);
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    expect(byId["demo-donor"]).toMatchObject({ name: "Kaeden Bryer", role: "donor" });
    expect(byId["demo-donor-2"]).toMatchObject({ role: "donor" });
    expect(byId["maintainer-ccf"]).toMatchObject({ name: "Miko Cool", role: "maintainer", maintainerOf: ["ccf"] });
    expect(byId["donor-priya"]).toBeUndefined(); // history-only donors aren't personas
  });

  it("sessions expire", async () => {
    const b = browser();
    await b.signIn("demo-donor");
    clock += 8 * 24 * 60 * 60 * 1000;
    expect((await b.call("GET", "/api/me")).status).toBe(401);
  });

  it("logout deletes the session server-side, so a copied cookie stops working", async () => {
    const b = browser();
    await b.signIn("demo-donor");
    const copied = b.cookie;
    expect((await b.call("POST", "/api/auth/logout")).status).toBe(200);
    expect(b.cookie).toBe("");
    expect(db.select().from(schema.sessions).all()).toHaveLength(0);
    const replay = await app.request("/api/me", { headers: { cookie: copied } });
    expect(replay.status).toBe(401);
  });

  it("a demo reset keeps you signed in", async () => {
    const b = browser();
    await b.signIn("demo-donor");
    expect((await b.call("POST", "/api/demo/reset")).status).toBe(200);
    expect((await b.call("GET", "/api/me")).status).toBe(200);
    build(false);
    expect((await b.call("POST", "/api/demo/reset")).status).toBe(404);
  });
});

describe("who may resolve a decision", () => {
  const openEae = () => {
    const d = db.select().from(schema.decisions).all().find((x) => x.projectId === "eae" && x.status === "open")!;
    return `/api/maintain/projects/eae/decisions/${d.id}/resolve`;
  };

  it("donors get 403, another project's maintainer 403, the right maintainer succeeds", async () => {
    const url = openEae();
    const donor = browser();
    await donor.signIn("demo-donor");
    expect((await donor.call("POST", url, { optionId: "approve" })).status).toBe(403);

    const other = browser();
    await other.signIn("maintainer-ccf");
    expect((await other.call("POST", url, { optionId: "approve" })).status).toBe(403);

    const anon = browser();
    expect((await anon.call("POST", url, { optionId: "approve" })).status).toBe(401);

    const right = browser();
    await right.signIn("maintainer-eae");
    const res = await right.call("POST", url, { optionId: db.select().from(schema.decisions).all().find((x) => x.projectId === "eae" && x.status === "open")!.options[0]!.id });
    expect(res.status).toBe(200);
    expect(Decision.parse(res.body).status).toBe("resolved");
  });

  it("maintainer routes and hidden-test routes are 403 for donors", async () => {
    const donor = browser();
    await donor.signIn("demo-donor");
    expect((await donor.call("GET", "/api/maintain/projects/eae/brief")).status).toBe(403);
    expect((await donor.call("GET", "/api/maintain/projects/eae/decisions")).status).toBe(403);
    expect((await donor.call("GET", "/api/projects/eae/hidden-tests")).status).toBe(403);
    const m = browser();
    await m.signIn("maintainer-eae");
    expect((await m.call("GET", "/api/maintain/projects/eae/brief")).status).toBe(200);
    expect((await m.call("GET", "/api/projects/eae/hidden-tests")).status).toBe(200);
    expect((await m.call("GET", "/api/maintain/projects/ccf/brief")).status).toBe(403);
    expect(AuthMe.parse((await m.call("GET", "/api/auth/me")).body).maintainerOf).toEqual(["eae"]);
  });

  it("the old donor resolve route no longer exists", async () => {
    const b = browser();
    await b.signIn("maintainer-eae");
    expect((await b.call("POST", "/api/decisions/anything/resolve", { optionId: "x" })).status).toBe(404);
  });
});
