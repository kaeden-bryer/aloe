/**
 * Browser sessions and roles: the ONLY place that answers "who is this
 * request from, and what may they do".
 *
 * Two separate questions, on purpose:
 *   1. Who are you?  A random token in an httpOnly cookie, stored server-side
 *      as a hash (see `sessions`). Today a demo picker creates the session;
 *      GitHub sign-in (Better Auth) will later replace ONLY `startSession`'s
 *      caller. Everything below reads the session and never cares how it began.
 *   2. What may you do?  Rows in `project_maintainers`. Donors only donate
 *      compute; the executive calls on a project belong to its maintainers.
 *
 * Agent device-token auth (apps/server/src/app.ts requireDevice) is a
 * different thing and doesn't go through here.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, lt } from "drizzle-orm";
import { schema, type AloeDb, type AuthUser } from "@aloe/core";
import { hashToken, newDeviceToken } from "./auth.ts";
import { HttpError } from "./http.ts";

const { donors, projectMaintainers, sessions } = schema;

export const SESSION_COOKIE = "aloe_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionDeps {
  db: AloeDb;
  now: () => number;
  /**
   * TEST ONLY. Lets a test act as a user without a cookie. It's a constructor
   * option rather than a header, so production code has no way to say "trust
   * this header": an HTTP client can never reach it.
   */
  actAs?: (c: Context) => string | null | undefined;
}

export function createSessionTools({ db, now, actAs }: SessionDeps) {
  const userById = (id: string): AuthUser | null =>
    db.select({ id: donors.id, name: donors.name, email: donors.email }).from(donors).where(eq(donors.id, id)).get() ?? null;

  const maintainerOf = (userId: string): string[] =>
    db.select({ p: projectMaintainers.projectId }).from(projectMaintainers).where(eq(projectMaintainers.userId, userId)).all().map((r) => r.p);

  /** The signed-in user, or null. Never throws: public routes use it to personalise, not to gate. */
  function currentUser(c: Context): AuthUser | null {
    const injected = actAs?.(c);
    if (injected) return userById(injected);
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return null;
    const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
    // Expiry is checked on read, so a stale cookie simply means "signed out".
    if (!row || row.expiresAt <= now()) return null;
    return userById(row.userId);
  }

  /** 401 if signed out. */
  function requireUser(c: Context): AuthUser {
    const user = currentUser(c);
    if (!user) throw new HttpError(401, "unauthorized", "Sign in first");
    return user;
  }

  /** 401 if signed out, 403 unless the user maintains this project. Returns the user id. */
  function requireMaintainerOf(c: Context, projectId: string): string {
    const user = requireUser(c);
    const row = db
      .select()
      .from(projectMaintainers)
      .where(and(eq(projectMaintainers.userId, user.id), eq(projectMaintainers.projectId, projectId)))
      .get();
    if (!row) throw new HttpError(403, "forbidden", "Only a maintainer of this project can do that");
    return user.id;
  }

  /** Creates a session for `userId` and sets the cookie. The caller has already decided this user may sign in. */
  function startSession(c: Context, userId: string): void {
    const ts = now();
    // Housekeeping: drop sessions that already expired so the table can't grow forever.
    db.delete(sessions).where(lt(sessions.expiresAt, ts)).run();
    const token = newDeviceToken();
    db.insert(sessions).values({ tokenHash: hashToken(token), userId, createdAt: ts, expiresAt: ts + SESSION_TTL_MS }).run();
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true, // page scripts can't read it, so XSS can't steal the session
      sameSite: "Lax", // not sent on cross-site POSTs, which is our CSRF defence
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
      secure: new URL(c.req.url).protocol === "https:" || process.env.NODE_ENV === "production",
    });
  }

  /** Deletes the server-side session (so a copied cookie stops working) and clears the cookie. */
  function endSession(c: Context): void {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }

  return { currentUser, requireUser, requireMaintainerOf, startSession, endSession, maintainerOf, userById };
}

export type SessionTools = ReturnType<typeof createSessionTools>;
