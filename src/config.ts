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
