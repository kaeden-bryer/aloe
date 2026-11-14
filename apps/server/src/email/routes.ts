/**
 * Weekly email routes. Kept in their own file so app.ts only needs one line to mount them.
 * The email's data comes from buildDashboard, the same function behind GET /api/me/dashboard.
 */
import type { Context, Hono } from "hono";
import type { AloeDb } from "@aloe/core";
import { WeeklyEmailSendResponse } from "@aloe/core";
import { buildDashboard } from "../dashboard.ts";
import { HttpError, send } from "../http.ts";
import { getMe } from "../views.ts";
import { renderWeeklyEmail } from "./render.ts";
import { resendSenderFromEnv, type EmailSender } from "./send.ts";

export interface WeeklyEmailDeps {
  db: AloeDb;
  now: () => number;
  /** Throws 401 for unknown donors and returns the donor id. */
  requireDonor: (c: Context) => string;
  /**
   * Injected so tests never reach Resend. `undefined` = look at RESEND_API_KEY
   * on each request (.env is loaded after imports, see index.ts); `null` = not configured.
   */
  emailSender?: EmailSender | null;
  from?: string;
}

export function mountWeeklyEmail(app: Hono<any>, deps: WeeklyEmailDeps) {
  const { db, now, requireDonor } = deps;

  async function build(c: Context) {
    const donorId = requireDonor(c);
    const me = getMe(db, donorId)!;
    // Links in the email point at the app the request came from (or a configured public URL).
    const base = process.env.ALOE_PUBLIC_URL || new URL(c.req.url).origin;
    const email = await renderWeeklyEmail({
      donorName: me.name,
      report: buildDashboard(db, donorId, now()),
      dashboardUrl: `${base}/dashboard`,
    });
    return { me, email };
  }

  app.get("/api/me/weekly-email", async (c) => c.html((await build(c)).email.html));

  app.get("/api/me/weekly-email.txt", async (c) => c.text((await build(c)).email.text));

  app.post("/api/me/weekly-email/send", async (c) => {
    const sender = deps.emailSender === undefined ? resendSenderFromEnv() : deps.emailSender;
    // Check "is email set up at all" first, so the demo shows a clear message.
    if (!sender) throw new HttpError(503, "not_configured", "Email isn't set up yet: add RESEND_API_KEY to .env to send real emails.");
    const { me, email } = await build(c);
    if (!me.settings.weeklyEmail) throw new HttpError(409, "conflict", "Weekly report email is turned off in Settings.");
    await sender.send({
      from: deps.from ?? process.env.ALOE_EMAIL_FROM ?? "Aloe <onboarding@resend.dev>",
      to: me.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    return send(c, WeeklyEmailSendResponse, { ok: true, to: me.email, subject: email.subject });
  });
}
