import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { ApiError, LeaseFailure } from "@aloe/core";

type ErrorCode = ApiError["code"];

/** Thrown anywhere in a handler; `app.onError` turns it into an ApiError body. */
export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function errorBody(code: ErrorCode, error: string): ApiError {
  return { error, code };
}

/**
 * Parse and validate a JSON body. This is the trust boundary: agents run on
 * machines we don't control, so nothing past this line sees unchecked input.
 * An empty body counts as `{}` so schemas with defaults (ClaimRequest) work.
 */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "bad_request", "Body must be valid JSON");
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new HttpError(400, "bad_request", z.prettifyError(result.error));
  return result.data;
}

/** Map a lease-engine failure to the HTTP status the API contract promises. */
export function leaseFailure(f: LeaseFailure): HttpError {
  switch (f.reason) {
    case "not_found":
      return new HttpError(404, "not_found", "Task not found");
    case "lease_lost":
      return new HttpError(409, "lease_lost", "Your lease on this task is no longer valid");
    case "illegal_transition":
      return new HttpError(409, "illegal_transition", "That action is not allowed in the task's current state");
  }
}

const CHECK_RESPONSES = process.env.NODE_ENV !== "production";

/**
 * Send JSON, checking it against its contract first outside production. A
 * server bug then fails loudly here instead of confusing the web app.
 */
export function send<S extends z.ZodType>(c: Context, schema: S, data: z.input<S>) {
  return c.json(CHECK_RESPONSES ? schema.parse(data) : data);
}
