import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/**
 * On-disk state for the OAuth login: the registered client and the tokens.
 *
 * Why a file at all — a stdio server is a short-lived process. The MCP client
 * spawns it, and may respawn it between calls. Holding tokens only in memory
 * would mean a browser login on every spawn, which is unusable. This is the
 * same reason `gh`, `aws sso` and `wrangler` all keep a credential file.
 *
 * Keyed by ISSUER, not stored flat. One machine can legitimately talk to more
 * than one Scriptivox backend (production and a test branch), and their tokens
 * are not interchangeable — a token minted by the test branch is rejected by
 * production and vice versa. Flat storage would have the two silently
 * overwrite each other and produce 401s that look like expiry.
 *
 * Written 0600. It holds a refresh token, which is a long-lived credential for
 * somebody's account; a world-readable file in $HOME is how those leak. The
 * chmod is best-effort because it is meaningless on Windows, and a failure to
 * set permissions must not stop the login from working.
 */

export interface StoredClient {
  client_id: string;
  /** Loopback URI the client was registered with; re-registering if it changes. */
  redirect_uri: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** Absolute epoch ms. Computed from expires_in at save time, never stored raw. */
  expires_at?: number;
}

interface IssuerEntry {
  client?: StoredClient;
  tokens?: StoredTokens;
}

interface AuthFile {
  version: 1;
  issuers: Record<string, IssuerEntry>;
}

const FILE = join(homedir(), ".scriptivox", "mcp-auth.json");

function empty(): AuthFile {
  return { version: 1, issuers: {} };
}

function read(): AuthFile {
  try {
    if (!existsSync(FILE)) return empty();
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    if (!parsed || parsed.version !== 1 || typeof parsed.issuers !== "object") return empty();
    return parsed as AuthFile;
  } catch {
    // A corrupt or unreadable file must not brick the server: treat it as
    // absent and let the next login rewrite it.
    return empty();
  }
}

function write(data: AuthFile): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      chmodSync(FILE, 0o600);
    } catch {
      /* no-op on platforms without POSIX modes */
    }
  } catch {
    // Losing the cache costs a re-login, not correctness. Never throw from here
    // — a read-only HOME would otherwise make every tool call fail.
  }
}

export function loadClient(issuer: string): StoredClient | null {
  return read().issuers[issuer]?.client ?? null;
}

export function saveClient(issuer: string, client: StoredClient): void {
  const data = read();
  data.issuers[issuer] = { ...data.issuers[issuer], client };
  write(data);
}

export function loadTokens(issuer: string): StoredTokens | null {
  return read().issuers[issuer]?.tokens ?? null;
}

export function saveTokens(issuer: string, tokens: StoredTokens): void {
  const data = read();
  data.issuers[issuer] = { ...data.issuers[issuer], tokens };
  write(data);
}

export function clearTokens(issuer: string): void {
  const data = read();
  if (data.issuers[issuer]) {
    delete data.issuers[issuer].tokens;
    write(data);
  }
}

/** Where the credential file lives, for messages that tell a user what to delete. */
export const AUTH_FILE_PATH = FILE;
