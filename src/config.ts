import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_BASE_URL = "https://api.scriptivox.com/v1";

// Server version, read from package.json at runtime so it can never drift from
// what npm publishes. package.json sits one level up from this file in both the
// source tree (src/) and the compiled output (dist/) — and inside the installed
// npm package — so "../package.json" resolves correctly in every case.
function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

export const CONFIG = {
  apiBaseUrl: API_BASE_URL,
  apiKey: process.env.SCRIPTIVOX_API_KEY || "",
  pollIntervalMs: 5000,
  pollInitialDelayMs: 3000,
  pollTimeoutMs: 600000, // 10 minutes
};

export function hasApiKey(): boolean {
  return CONFIG.apiKey.length > 0;
}

/**
 * Configuration for the account and commerce tools, which authenticate as a
 * PERSON rather than with an API key.
 *
 * Nothing here is an endpoint. Every URL those tools use is discovered at
 * runtime from `siteUrl` (RFC 9728 -> RFC 8414), so one published build talks
 * to production and to a test branch without a rebuild.
 *
 * The overrides exist for two real cases:
 *   issuerOverride   — point at a backend whose site half is not deployed, and
 *                      skip resource discovery entirely. This is how the flow
 *                      is tested against a Supabase branch.
 *   clientIdOverride — an authorization server without Dynamic Client
 *                      Registration, where a client id must be issued by hand.
 */
export const AUTH_CONFIG = {
  siteUrl: (process.env.SCRIPTIVOX_SITE_URL || "https://www.scriptivox.com").replace(/\/+$/, ""),
  issuerOverride: (process.env.SCRIPTIVOX_AUTH_ISSUER || "").replace(/\/+$/, ""),
  clientIdOverride: process.env.SCRIPTIVOX_OAUTH_CLIENT_ID || "",
  /**
   * Print the authorization URL instead of launching a browser.
   *
   * Set SCRIPTIVOX_NO_BROWSER=1 when there is no browser to launch — an SSH
   * session, a container, CI. Without it the spawn silently does nothing on
   * those hosts and the login just appears to hang until it times out, which
   * gives the user no idea that the URL they need was available all along.
   */
  noBrowser: /^(1|true|yes)$/i.test(process.env.SCRIPTIVOX_NO_BROWSER || ""),
  /** How long the browser login may take before it gives up. */
  loginTimeoutMs: 300000, // 5 minutes
  /**
   * The project's PUBLISHABLE key, for the tools that read tables directly.
   *
   * Normally discovered — see publishableKeyFor() below. Set this when
   * discovery cannot apply: alongside SCRIPTIVOX_AUTH_ISSUER, where the issuer
   * points at a backend whose site half is not deployed, or at a branch whose
   * key is not the one the public site advertises.
   */
  supabaseKeyOverride: process.env.SCRIPTIVOX_SUPABASE_KEY || "",
};

/**
 * Base URL for the edge functions the account tools call.
 *
 * Derived from the ISSUER rather than configured separately: the issuer is
 * `https://<project>.supabase.co/auth/v1`, and the functions live on the same
 * origin. Two settings that must agree are one setting too many — this is the
 * same class of drift that had the test API gateway pointed at a dead branch.
 */
export function functionsBaseFrom(issuer: string): string {
  return `${new URL(issuer).origin}/functions/v1`;
}

/** PostgREST, on the same origin. */
export function restBaseFrom(issuer: string): string {
  return `${new URL(issuer).origin}/rest/v1`;
}

/** Object storage, on the same origin. */
export function storageBaseFrom(issuer: string): string {
  return `${new URL(issuer).origin}/storage/v1`;
}

/**
 * The publishable key for the project behind `issuer`.
 *
 * ── Why a key has to be found at all ────────────────────────────────────────
 *
 * Edge functions accept `Authorization: Bearer <user token>` on its own.
 * PostgREST does NOT — it answers 401 {"message":"No API key found in
 * request"} and wants the project's publishable key in an `apikey` header
 * alongside the user's token. The library, automation and meeting tools read
 * tables, so they need one; the account tools, which only call edge functions,
 * never did. That asymmetry is the whole reason this function exists.
 *
 * ── Why it is discovered rather than configured ─────────────────────────────
 *
 * Nothing else in this server is configured. Every URL is discovered from
 * `siteUrl` at runtime, which is what lets ONE published npm build talk to
 * production and to a test branch without a rebuild. A required environment
 * variable would break `npx @scriptivox/mcp-server` for everyone who does not
 * set it — and it would break it silently, by disabling tools rather than
 * failing.
 *
 * The key is public: it is the same `sb_publishable_...` value shipped in every
 * page of the web app's JavaScript. It grants nothing on its own — RLS is
 * evaluated against the USER's token, which is why this process never holds a
 * service key.
 *
 * ── The mismatch guard ──────────────────────────────────────────────────────
 *
 * The manifest describes the project the SITE talks to. When SCRIPTIVOX_AUTH_ISSUER
 * points somewhere else, that key belongs to a different project and would fail
 * with a confusing "Invalid API key" three calls later. The origins are
 * compared and the mismatch is named here instead.
 */
let cachedKey: { issuerOrigin: string; key: string } | null = null;

export async function publishableKeyFor(issuer: string): Promise<string> {
  if (AUTH_CONFIG.supabaseKeyOverride) return AUTH_CONFIG.supabaseKeyOverride;

  const issuerOrigin = new URL(issuer).origin;
  if (cachedKey && cachedKey.issuerOrigin === issuerOrigin) return cachedKey.key;

  const url = `${AUTH_CONFIG.siteUrl}/.well-known/mcp`;
  let doc: any;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    doc = await res.json();
  } catch (err) {
    throw new Error(
      `Could not read ${url} to find the Supabase publishable key, which reading your tags, ` +
        `folders, workspaces, automations and meetings requires.\n\n` +
        `Set SCRIPTIVOX_SUPABASE_KEY to skip discovery. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const block = doc?.["x-supabase"];
  const key = typeof block?.publishableKey === "string" ? block.publishableKey.trim() : "";
  if (!key) {
    throw new Error(
      `${url} does not publish a Supabase publishable key, so tables cannot be read. ` +
        `Set SCRIPTIVOX_SUPABASE_KEY, or use a newer Scriptivox deployment.`,
    );
  }

  let publishedOrigin = "";
  try {
    publishedOrigin = new URL(String(block.url)).origin;
  } catch {
    /* treated as unknown below */
  }
  if (publishedOrigin && publishedOrigin !== issuerOrigin) {
    throw new Error(
      `${AUTH_CONFIG.siteUrl} publishes a key for ${publishedOrigin}, but you are signed in against ` +
        `${issuerOrigin}. Using it would fail with "Invalid API key".\n\n` +
        `Set SCRIPTIVOX_SUPABASE_KEY to the publishable key for ${issuerOrigin}.`,
    );
  }

  cachedKey = { issuerOrigin, key };
  return key;
}

export const NO_API_KEY_MESSAGE = `No Scriptivox API key configured.

To transcribe audio and video, you need a Scriptivox API key:

1. Sign up at https://platform.scriptivox.com
2. Go to https://platform.scriptivox.com/keys and create an API key
3. Add credits at https://platform.scriptivox.com/billing ($5 minimum — $0.20/hour of audio)
4. Set the SCRIPTIVOX_API_KEY environment variable in your MCP client config:

   {
     "mcpServers": {
       "scriptivox": {
         "command": "npx",
         "args": ["-y", "@scriptivox/mcp-server"],
         "env": { "SCRIPTIVOX_API_KEY": "sk_live_YOUR_KEY" }
       }
     }
   }`;
