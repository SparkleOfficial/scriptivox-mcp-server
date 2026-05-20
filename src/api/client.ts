import { CONFIG } from "../config.js";

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export class ScriptivoxApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
    /** Selected response headers we want callers to be able to read.
     * Stays small (e.g. `Allow`, `Retry-After`, `Idempotent-Replay`) — the
     * worker strips supabase-internal headers before we ever see them. */
    public responseHeaders?: Record<string, string>,
  ) {
    super(message);
    this.name = "ScriptivoxApiError";
  }
}

// Validate that a path segment is a safe UUID-like identifier
function isSafePathSegment(segment: string): boolean {
  return /^[a-zA-Z0-9\-_]+$/.test(segment);
}

export interface ApiRequestOptions {
  /** Body for POST/PUT/PATCH. Omit for GET/DELETE. */
  body?: Record<string, unknown>;
  /** Extra request headers (e.g. `Idempotency-Key`). Content-Type and Authorization are set automatically. */
  headers?: Record<string, string>;
  /** When true, parse the response as JSON only if there's a body. 204 No Content is allowed. */
  allowEmptyResponse?: boolean;
}

/**
 * Low-level API client. Handles auth, rate-limit retry (one), 415/405 errors,
 * and parses the customer-facing `{error: {code, message}}` envelope into a
 * typed exception.
 *
 * Three call styles for backward compat with the original signature:
 *   apiRequest<T>("GET", "/balance")
 *   apiRequest<T>("POST", "/transcribe", { url })
 *   apiRequest<T>("POST", "/transcribe", { url }, { "Idempotency-Key": "..." })
 */
export async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
  options: { allowEmptyResponse?: boolean } = {},
): Promise<T> {
  // Prevent path traversal — validate all dynamic segments
  if (path.includes("..") || path.includes("//")) {
    throw new ScriptivoxApiError(
      "INVALID_REQUEST",
      "Invalid API path.",
      400
    );
  }

  const url = `${CONFIG.apiBaseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: CONFIG.apiKey,
    ...(extraHeaders || {}),
  };
  if (body) {
    // Worker enforces application/json on body-bearing methods now. Setting
    // this guarantees we don't get a 415 UNSUPPORTED_MEDIA_TYPE back.
    headers["Content-Type"] = "application/json";
  }

  const doFetch = async (): Promise<Response> =>
    await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

  let response: Response;
  try {
    response = await doFetch();
  } catch (err) {
    throw new ScriptivoxApiError(
      "NETWORK_ERROR",
      `Failed to connect to Scriptivox API: ${err instanceof Error ? err.message : String(err)}`,
      0
    );
  }

  // Handle rate limiting with one retry
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
    await sleep(Math.min(waitMs, 30000));
    try {
      response = await doFetch();
    } catch (err) {
      throw new ScriptivoxApiError(
        "NETWORK_ERROR",
        `Failed to connect to Scriptivox API on retry: ${err instanceof Error ? err.message : String(err)}`,
        0
      );
    }
    if (response.status === 429) {
      throw new ScriptivoxApiError(
        "RATE_LIMIT_EXCEEDED",
        "Rate limit exceeded. Please try again later.",
        429,
      );
    }
  }

  // 204 No Content — DELETE happy path. Don't try to parse JSON.
  if (response.status === 204 || options.allowEmptyResponse) {
    if (response.status >= 400) {
      throw new ScriptivoxApiError(
        "UNKNOWN_ERROR",
        `API returned status ${response.status}`,
        response.status,
      );
    }
    return undefined as unknown as T;
  }

  // Parse body. If the response isn't JSON we still want to surface a
  // meaningful error rather than crashing on the JSON.parse step.
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (response.ok) {
      // Unexpected empty success body — return undefined; caller can interpret.
      return undefined as unknown as T;
    }
    throw new ScriptivoxApiError(
      "UNKNOWN_ERROR",
      `API returned status ${response.status} (non-JSON response)`,
      response.status,
    );
  }

  if (!response.ok) {
    const apiErr = data as ApiError;
    // Surface a couple of useful response headers so callers can react
    // (e.g. show the `Allow` header on a 405).
    const exposed: Record<string, string> = {};
    for (const h of ["allow", "accept-post", "retry-after", "idempotent-replay"]) {
      const v = response.headers.get(h);
      if (v) exposed[h] = v;
    }
    throw new ScriptivoxApiError(
      apiErr.error?.code || "UNKNOWN_ERROR",
      apiErr.error?.message || `API returned status ${response.status}`,
      response.status,
      Object.keys(exposed).length ? exposed : undefined,
    );
  }

  return data as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
