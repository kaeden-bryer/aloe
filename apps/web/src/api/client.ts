/**
 * Typed fetch wrapper for the web API (see packages/core/API.md).
 *
 * Every response is parsed with the matching Zod schema. TypeScript types
 * disappear at runtime, so if the server ever sends a shape we don't expect,
 * we want a loud error here, not a confusing `undefined` deep inside a screen.
 *
 * Import only from "@aloe/core/contracts": the package's main entry pulls in
 * better-sqlite3, which must never end up in the browser bundle.
 */
import { z } from "zod";
import {
  ApiError,
  Cause,
  Dashboard,
  Decision,
  Me,
  ProjectDetail,
  ProjectSummary,
  type CauseId,
  WeeklyEmailSendResponse,
  type DonorSettings,
} from "@aloe/core/contracts";

/** The demo identity. Real sign-in replaces this header later. */
export const DONOR_ID = "demo-donor";

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "1";

const Ok = z.object({ ok: z.literal(true) });

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiError["code"],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  let status: number;
  let json: unknown;

  if (USE_MOCKS) {
    // Loaded lazily so the fixtures never ship in a real-mode build.
    const { mockFetch } = await import("./mock");
    ({ status, json } = await mockFetch(method, path, body));
  } else {
    const res = await fetch(path, {
      method,
      headers: {
        "x-aloe-donor": DONOR_ID,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    json = res.status === 204 ? null : await res.json().catch(() => null);
  }

  if (status < 200 || status >= 300) {
    const err = ApiError.safeParse(json);
    throw new ApiRequestError(
      err.success ? err.data.error : `${method} ${path} failed with ${status}`,
      status,
      err.success ? err.data.code : undefined,
    );
  }
  return schema.parse(json);
}

export const api = {
  causes: () => request("GET", "/api/causes", z.array(Cause)),
  projects: (cause?: CauseId) =>
    request("GET", cause ? `/api/projects?cause=${cause}` : "/api/projects", z.array(ProjectSummary)),
  project: (id: string) => request("GET", `/api/projects/${encodeURIComponent(id)}`, ProjectDetail),
  back: (id: string) => request("POST", `/api/projects/${encodeURIComponent(id)}/back`, Ok),
  unback: (id: string) => request("DELETE", `/api/projects/${encodeURIComponent(id)}/back`, Ok),
  me: () => request("GET", "/api/me", Me),
  saveSettings: (settings: DonorSettings) => request("PUT", "/api/me/settings", Me, settings),
  dashboard: () => request("GET", "/api/me/dashboard", Dashboard),
  decisions: () => request("GET", "/api/decisions?status=open", z.array(Decision)),
  resolveDecision: (id: string, optionId: string, note?: string) =>
    request("POST", `/api/decisions/${encodeURIComponent(id)}/resolve`, Decision, { optionId, note }),
  sendWeeklyEmail: () => request("POST", "/api/me/weekly-email/send", WeeklyEmailSendResponse),
  resetDemo: () => request("POST", "/api/demo/reset", Ok),
};
