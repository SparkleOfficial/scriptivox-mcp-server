import {
  AUTH_CONFIG,
  functionsBaseFrom,
  restBaseFrom,
  storageBaseFrom,
  publishableKeyFor,
} from "../config.js";
import { getAccessToken, discoverIssuer, OAuthError } from "../auth/oauth.js";

/**
 * Shared plumbing for every stdio tool that acts on a PERSON.
 *
 * Extracted from ./account.ts, which was the only user-token tier when it was
 * written. There are now four — account/commerce, library, automations and
 * meetings — and they all need the same things: resolve a token without
 * ambushing the user with a browser, call an edge function as that person, read
 * a table as that person, and turn a failure into a sentence.
 *
 * These mirror the hosted implementations in the main repo
 * (src/lib/mcp/userClient.ts and its siblings) and call the SAME endpoints with
 * the same shapes, so the two surfaces cannot drift in behaviour.
 *
 * ── Two backends, two auth rules ────────────────────────────────────────────
 *
 * EDGE FUNCTIONS accept `Authorization: Bearer <user token>` on its own.
 * POSTGREST DOES NOT: without an `apikey` header carrying the project's
 * publishable key it answers 401 "No API key found in request". That is why
 * `postgrest` below resolves a key and `callFunction` does not, and why the
 * account tools never needed one. See publishableKeyFor() in ../config.ts.
 */

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export const SITE = () => AUTH_CONFIG.siteUrl;
export const PLATFORM = "https://platform.scriptivox.com";
export const API_BASE = "https://api.scriptivox.com/v1";

export function text(body: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

export function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2));
}

/** An OAuth failure explains itself and says what to do; it never leaks a stack. */
export function authFailure(err: unknown): ToolResult {
  if (err instanceof OAuthError) {
    return text(err.hint ? `${err.message}\n\n${err.hint}` : err.message, true);
  }
  return text(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`, true);
}

/**
 * Call an edge function with the person's own token, so RLS applies exactly as
 * it would in their browser. Never a service key: a local process must not be
 * able to reach past the authorisation its user granted.
 */
export async function callFunction(
  token: string,
  issuer: string,
  fn: string,
  body: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${functionsBaseFrom(issuer)}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Functions that build redirect URLs relative to the caller (api-deposit
      // does) need an origin, or they fall back to a default host.
      origin: SITE(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export interface PostgrestOptions {
  /** Non-public schema to address. `automation` and `meeting` are the two in use. */
  schema?: string;
  method?: "GET" | "PATCH" | "POST" | "DELETE";
  body?: unknown;
  prefer?: string;
}

/**
 * Read or write a table as the caller.
 *
 * A non-public schema needs `Accept-Profile` on a read and `Content-Profile` on
 * a write — different headers, and using the wrong one silently addresses
 * `public` instead, which is how a query for `automation.automations` comes
 * back "relation does not exist".
 */
export async function postgrest(
  token: string,
  issuer: string,
  path: string,
  options: PostgrestOptions = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  let apikey: string;
  try {
    apikey = await publishableKeyFor(issuer);
  } catch (err) {
    return { ok: false, status: 503, data: { message: err instanceof Error ? err.message : String(err) } };
  }

  const method = options.method ?? "GET";
  const isWrite = method !== "GET";
  const headers: Record<string, string> = {
    apikey,
    Authorization: `Bearer ${token}`,
  };
  if (options.schema) {
    headers[isWrite ? "Content-Profile" : "Accept-Profile"] = options.schema;
    if (isWrite && options.prefer?.includes("return=representation")) {
      headers["Accept-Profile"] = options.schema;
    }
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const res = await fetch(`${restBaseFrom(issuer)}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { ok: res.ok, status: res.status, data };
}

/** A one-hour signed URL for an object, signed as the caller so storage RLS decides. */
export async function signStorageObject(
  token: string,
  issuer: string,
  bucket: string,
  path: string,
  expiresIn: number,
): Promise<{ ok: boolean; status: number; url?: string; data: any }> {
  let apikey: string;
  try {
    apikey = await publishableKeyFor(issuer);
  } catch (err) {
    return { ok: false, status: 503, data: { message: err instanceof Error ? err.message : String(err) } };
  }

  const base = storageBaseFrom(issuer);
  const res = await fetch(`${base}/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { apikey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.signedURL) return { ok: false, status: res.status, data };
  // `signedURL` comes back relative to the storage API root.
  return { ok: true, status: res.status, url: `${base}${data.signedURL}`, data };
}

export function upstreamError(label: string, status: number, data: any): ToolResult {
  // A scoped-maintenance block comes back as 503 {error:'maintenance', code, scope,
  // message} with Retry-After: 300. Handled FIRST and by `code`, because the
  // generic extraction below reads `data.error` — which here is the literal
  // string "maintenance" — and would render the whole thing as
  // "Running the automation failed: maintenance". An agent given one word with
  // no timeframe retries immediately and hammers a system that is mid-migration.
  //
  // `55006` is the same block arriving by a different road: the
  // transcriptions_library_maintenance TRIGGER raises it, so it reaches us as a
  // PostgREST error rather than a maintenance envelope. Same event, same
  // message to the caller.
  if (data?.code === "maintenance" || data?.code === "55006") {
    const scope =
      typeof data.scope === "string"
        ? data.scope
        : data.code === "55006"
          ? "the library"
          : "this feature";
    return text(
      [
        `${label} is paused: Scriptivox is running maintenance on ${scope}.`,
        "",
        data.message ? String(data.message) : "",
        "",
        "This is deliberate and temporary. Nothing was changed, and nothing was charged.",
        "Wait at least 5 minutes before trying again — retrying sooner will be refused the same way.",
      ]
        .filter((line, i, all) => line !== "" || all[i - 1] !== "")
        .join("\n"),
      true,
    );
  }

  const detail =
    (data && (data.error?.message || data.error || data.message || data.msg)) ||
    (typeof data === "string" && data.trim() ? data.trim().slice(0, 300) : "") ||
    `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return text(
      `${label} was refused: ${detail}\n\n` +
        "The access token is missing, expired, or was not granted for this account. " +
        "Call `login` to authorize again.",
      true,
    );
  }
  if (status === 404) {
    return text(
      `${label} found nothing: ${detail}\n\n` +
        "Either the id does not exist or it belongs to someone else — the two are deliberately " +
        "indistinguishable.",
      true,
    );
  }
  return text(`${label} failed: ${detail}`, true);
}

/**
 * Resolve a token WITHOUT opening a browser.
 *
 * Deliberate: a tool call that silently launches a browser mid-conversation is
 * startling, and in a headless or CI context it hangs until the timeout. An
 * un-authenticated call returns a normal result telling the agent to call
 * `login`, which is something it can act on.
 */
export async function withToken(
  run: (token: string, issuer: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  let token: string;
  let issuer: string;
  try {
    issuer = await discoverIssuer();
    token = await getAccessToken({ interactive: false });
  } catch (err) {
    return authFailure(err);
  }
  return run(token, issuer);
}

/**
 * The user id inside an access token.
 *
 * DECODING, NOT VERIFICATION. Every function this id is handed to re-derives it
 * from the verified token and ignores what we send, so a forged value buys
 * nothing. It is read here only because those functions REQUIRE the field to be
 * present, and taking it from tool input instead would let an agent name a
 * victim and leave the mismatch check as the only thing in the way.
 */
export function userIdFromToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof decoded?.sub === "string" && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
}

/** A trimmed string argument, or '' when absent or the wrong type. */
export function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

/** A list-of-strings argument, refusing a bare string rather than coercing one. */
export function strList(args: Record<string, unknown>, key: string): string[] | null {
  const value = args[key];
  if (!Array.isArray(value)) return null;
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

/** PostgREST `in.(...)` needs each value quoted, and a quote inside one doubled. */
export function inList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")})`;
}
