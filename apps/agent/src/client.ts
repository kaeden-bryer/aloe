/**
 * A tiny typed client for the agent half of the Aloe API (see packages/core/API.md).
 *
 * "Validate at the boundary": every response body goes through a Zod schema
 * before the rest of the agent sees it, and every request body is checked
 * before it leaves. If the server and agent ever disagree about a shape, we
 * fail here with a clear message instead of somewhere deep in the loop.
 */
import { z } from "zod";
import {
  ApiError,
  ClaimResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  PairRequest,
  PairResponse,
  SubmitRequest,
  VerifyResultRequest,
  type TaskKind,
} from "@aloe/core/contracts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ApiErrorCode = ApiError["code"];

/** The server answered with a non-2xx status. `code` is set when the body was a valid ApiError. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** We never got an HTTP answer (server down, DNS, timeout). Always worth retrying. */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/** The server answered 2xx but with a body we don't understand. A bug, not a blip. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** Errors that may go away if we wait and try again. */
export function isTransient(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiClientError) return err.status >= 500 || err.status === 429;
  return false;
}

export function isLeaseLost(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "lease_lost";
}

// Small response shapes that API.md describes but contracts.ts doesn't name.
const OkResponse = z.object({ ok: z.literal(true) });
const SubmitResponse = z.object({ submissionId: z.string(), verifyTaskId: z.string() });
const VerifyResponse = z.object({ outcome: z.string() });

export interface ClientOptions {
  serverUrl: string;
  /** Device token from pairing. Omit only for `pair` and `health`. */
  token?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createClient(opts: ClientOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.serverUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 30_000;

  /** `requestSchema`, when given, checks the body before it is sent. */
  async function call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    requestSchema?: z.ZodType,
  ): Promise<T> {
    if (requestSchema) body = requestSchema.parse(body);
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;

    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new NetworkError(`${method} ${path}: ${(err as Error).message}`, { cause: err });
    }

    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // Leave json undefined; the checks below report it.
    }

    if (!res.ok) {
      const parsed = ApiError.safeParse(json);
      if (parsed.success) {
        throw new ApiClientError(res.status, parsed.data.code, `${method} ${path}: ${parsed.data.error}`);
      }
      throw new ApiClientError(res.status, null, `${method} ${path}: HTTP ${res.status}`);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ProtocolError(`${method} ${path}: unexpected response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  const task = (id: string, action: string) => `/api/agent/tasks/${encodeURIComponent(id)}/${action}`;

  return {
    pair: (req: z.input<typeof PairRequest>) =>
      call("POST", "/api/agent/pair", PairResponse, req, PairRequest),

    claim: (kinds: TaskKind[]) => call("POST", "/api/agent/claim", ClaimResponse, { kinds }),

    heartbeat: (taskId: string, leaseToken: number) =>
      call("POST", task(taskId, "heartbeat"), HeartbeatResponse, { leaseToken }, HeartbeatRequest),

    release: (taskId: string, leaseToken: number) =>
      call("POST", task(taskId, "release"), OkResponse, { leaseToken }),

    submit: (taskId: string, body: SubmitRequest) =>
      call("POST", task(taskId, "submit"), SubmitResponse, body, SubmitRequest),

    verify: (taskId: string, body: VerifyResultRequest) =>
      call("POST", task(taskId, "verify"), VerifyResponse, body, VerifyResultRequest),

    health: () => call("GET", "/api/health", OkResponse),
  };
}

export type AgentApi = ReturnType<typeof createClient>;
