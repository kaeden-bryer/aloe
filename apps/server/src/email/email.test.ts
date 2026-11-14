import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, Me, migrate, openDb, WeeklyEmailSendResponse, type AloeDb } from "@aloe/core";
import { createApp } from "../app.ts";
import { buildDashboard } from "../dashboard.ts";
import { resetAndSeed } from "../seed.ts";
import { renderWeeklyEmail } from "./render.ts";
import type { EmailSender } from "./send.ts";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
let db: AloeDb;

beforeEach(() => {
  const opened = openDb(":memory:");
  migrate(opened.sqlite);
  db = opened.db;
  resetAndSeed(db, T0);
});

const input = (now: number) => ({ donorName: "Kaeden Bryer", report: buildDashboard(db, "demo-donor", now), dashboardUrl: "http://x.test/dashboard" });

describe("renderWeeklyEmail", () => {
  it("renders seeded data with the key numbers", async () => {
    const i = input(T0);
    const out = await renderWeeklyEmail(i);
    expect(out.html).toContain("Kaeden");
    expect(out.html).toContain(i.report.weekLabel);
    for (const p of i.report.platform) expect(out.html).toContain(p.label);
    for (const p of i.report.landed.filter((l) => l.merged > 0)) expect(out.html).toContain(p.name);
    expect(out.text).toContain("ALOE AS A WHOLE");
    expect(out.text).toContain(i.report.kpis[0]!.value);
    expect(out.subject.length).toBeGreaterThan(0);
  });

  it("renders an empty week without throwing", async () => {
    // Two months on: nothing merged this week.
    const out = await renderWeeklyEmail(input(T0 + 60 * 86_400_000));
    expect(out.html).toContain("quiet week");
    expect(out.text).toContain("Nothing from your agent was merged");
  });
});

describe("weekly email routes", () => {
  const app = (emailSender?: EmailSender | null) => createApp(db, { now: () => T0, webDist: null, emailSender, actAs: (c) => c.req.header("x-test-user") ?? "demo-donor" });
  const post = (a: ReturnType<typeof app>, donor = "demo-donor") =>
    a.request("/api/me/weekly-email/send", { method: "POST", headers: { "x-test-user": donor } });

  it("serves the HTML preview and the text version", async () => {
    const a = app(null);
    const html = await a.request("/api/me/weekly-email");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(await html.text()).toContain("Open your dashboard");
    const txt = await a.request("/api/me/weekly-email.txt");
    expect(txt.headers.get("content-type")).toContain("text/plain");
  });

  it("send says not_configured (503) without an email key", async () => {
    const res = await post(app(null));
    expect(res.status).toBe(503);
    expect(ApiError.parse(await res.json()).code).toBe("not_configured");
  });

  it("send hands the right to/subject to the injected sender", async () => {
    const sent: Parameters<EmailSender["send"]>[0][] = [];
    const res = await post(app({ send: async (m) => void sent.push(m) }));
    expect(res.status).toBe(200);
    const body = WeeklyEmailSendResponse.parse(await res.json());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("kaeden@example.org");
    expect(sent[0]!.subject).toBe(body.subject);
    expect(sent[0]!.html).toContain("<html");
    expect(sent[0]!.text).toContain("Aloe weekly report");
  });

  it("send respects the weeklyEmail setting", async () => {
    const sent: unknown[] = [];
    const a = app({ send: async (m) => void sent.push(m) });
    const me = Me.parse(await (await a.request("/api/me")).json());
    await a.request("/api/me/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...me.settings, weeklyEmail: false }),
    });
    const res = await post(a);
    expect(res.status).toBe(409);
    expect(sent).toHaveLength(0);
  });
});
