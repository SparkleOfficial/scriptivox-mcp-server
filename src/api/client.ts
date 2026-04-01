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
    public statusCode: number
  ) {
    super(message);
    this.name = "ScriptivoxApiError";
  }
}

// Validate that a path segment is a safe UUID-like identifier
function isSafePathSegment(segment: string): boolean {
  return /^[a-zA-Z0-9\-_]+$/.test(segment);
}

export async function apiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
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
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
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
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
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
        429
      );
    }
  }

  const data = await response.json();

  if (!response.ok) {
    const apiErr = data as ApiError;
    throw new ScriptivoxApiError(
      apiErr.error?.code || "UNKNOWN_ERROR",
      apiErr.error?.message || `API returned status ${response.status}`,
      response.status
    );
  }

  return data as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
