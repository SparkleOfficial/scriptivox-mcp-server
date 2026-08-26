import { createServer, type Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { AUTH_CONFIG } from "../config.js";
import {
  loadClient,
  saveClient,
  loadTokens,
  saveTokens,
  clearTokens,
  AUTH_FILE_PATH,
} from "./store.js";

/**
 * OAuth 2.1 authorization-code + PKCE login for the stdio server.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The transcription tools authenticate with SCRIPTIVOX_API_KEY, an `sk_live_`
 * key read from the environment. The account and commerce tools cannot: they
 * act on a PERSON's account, so they need a user access token, and a key that
 * identifies an API balance cannot stand in for one. That is the whole reason
 * those six tools were hosted-only — not that nobody had ported them.
 *
 * So this module makes the stdio server a real OAuth client: it discovers the
 * authorization server, registers itself, opens a browser, catches the redirect
 * on loopback, and exchanges the code for a token it can refresh.
 *
 * ── Everything is discovered, nothing is hardcoded ──────────────────────────
 *
 * The chain is RFC 9728 -> RFC 8414: fetch the resource's protected-resource
 * metadata, read `authorization_servers[0]`, fetch that server's metadata, and
 * use the endpoints it advertises. No endpoint path is written down here.
 * That is what lets one build talk to production and to a test branch without
 * a code change, and it is why SCRIPTIVOX_AUTH_ISSUER exists as an override.
 *
 * ── Loopback, not a hosted callback ─────────────────────────────────────────
 *
 * RFC 8252 (OAuth for Native Apps) prescribes a loopback redirect for exactly
 * this shape of client: 127.0.0.1 on an ephemeral port, chosen at login time.
 * An installed client cannot keep a secret, so it registers as a PUBLIC client
 * (`token_endpoint_auth_method: none`) and PKCE — not a client secret — is what
 * binds the code to this process.
 *
 * 127.0.0.1 rather than `localhost`: `localhost` can resolve to ::1 first, and
 * a server bound to IPv4 then never sees the callback. The spec says to prefer
 * the literal address for this reason.
 */

/** Discovered endpoints, per RFC 8414. */
interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export class OAuthError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "OAuthError";
  }
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

async function getJson(url: string, timeoutMs = 15_000): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new OAuthError(`${url} responded ${res.status}`);
  return res.json();
}

/**
 * RFC 8414 places the metadata at the ISSUER's host with the well-known segment
 * inserted before the issuer's path — `https://h/.well-known/oauth-authorization-server/auth/v1`
 * for issuer `https://h/auth/v1`. Plenty of servers also answer the naive
 * suffix form, so both are tried: getting this wrong looks identical to "OAuth
 * is not enabled", and that is a genuinely confusing thing to debug.
 */
function metadataUrlsFor(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, "");
  const urls = [`${u.origin}/.well-known/oauth-authorization-server${path}`];
  urls.push(`${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`);
  urls.push(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`);
  return urls;
}

/** Resource -> authorization server, per RFC 9728. */
async function discoverIssuer(): Promise<string> {
  if (AUTH_CONFIG.issuerOverride) return AUTH_CONFIG.issuerOverride;

  const url = `${AUTH_CONFIG.siteUrl}/.well-known/oauth-protected-resource`;
  let doc: any;
  try {
    doc = await getJson(url);
  } catch (err) {
    throw new OAuthError(
      `Could not read ${url} to find the authorization server.`,
      "Set SCRIPTIVOX_AUTH_ISSUER to the issuer URL to skip discovery.",
    );
  }
  const issuer = Array.isArray(doc?.authorization_servers) ? doc.authorization_servers[0] : null;
  if (typeof issuer !== "string" || !issuer) {
    throw new OAuthError(
      `${url} names no authorization server.`,
      "The deployment has no OAuth issuer configured.",
    );
  }
  return issuer;
}

async function discoverMetadata(issuer: string): Promise<AuthServerMetadata> {
  const attempted: string[] = [];
  for (const url of metadataUrlsFor(issuer)) {
    attempted.push(url);
    try {
      const doc = await getJson(url);
      if (doc?.authorization_endpoint && doc?.token_endpoint) return doc as AuthServerMetadata;
    } catch {
      /* try the next form */
    }
  }
  throw new OAuthError(
    `No OAuth 2.1 metadata at ${issuer}.`,
    `Tried:\n  ${attempted.join("\n  ")}\n\nThe authorization server may not be enabled on this project.`,
  );
}

/**
 * Dynamic Client Registration (RFC 7591). Cached per issuer — re-registering on
 * every login would mint a new client id each time and litter the project.
 *
 * The redirect URI is part of the registration, but the loopback PORT is only
 * known once the listener is bound. Registering a fixed port would collide with
 * whatever else is on the machine, so the port is chosen first and the cached
 * registration is reused only when its redirect_uri still matches.
 */
async function registerClient(
  meta: AuthServerMetadata,
  redirectUri: string,
): Promise<string> {
  const cached = loadClient(meta.issuer);
  if (cached && cached.redirect_uri === redirectUri) return cached.client_id;

  if (!meta.registration_endpoint) {
    throw new OAuthError(
      "This authorization server does not support Dynamic Client Registration.",
      "Set SCRIPTIVOX_OAUTH_CLIENT_ID to a pre-registered public client id.",
    );
  }

  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client_name: "Scriptivox MCP Server (stdio)",
      client_uri: "https://scriptivox.com",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Public client: an installed binary cannot hold a secret. PKCE is the
      // proof-of-possession instead.
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.client_id) {
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new OAuthError(`Client registration failed: ${detail}`);
  }

  saveClient(meta.issuer, { client_id: data.client_id, redirect_uri: redirectUri });
  return data.client_id as string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Open the system browser. Best-effort: the URL is always printed as a fallback. */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };
  try {
    // detached + unref so a long-lived browser process never holds this server
    // open, and ignored stdio so nothing it prints corrupts the MCP stream.
    const child = spawn(cmd.file, cmd.args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* the printed URL is the fallback */
  }
}

const DONE_PAGE = (heading: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>Scriptivox</title>` +
  `<div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1.5rem">` +
  `<h1 style="font-size:1.25rem;margin:0 0 .5rem">${heading}</h1>` +
  `<p style="color:#71717a;margin:0">${body}</p></div>`;

/**
 * Bind a loopback listener and resolve with the authorization code.
 *
 * Resolves on the FIRST request carrying `state`, and validates it before
 * accepting the code — without that check any local process could hit the port
 * and inject a code from a different authorization (a CSRF against the login).
 */
function awaitCallback(
  server: Server,
  expectedState: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OAuthError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser.`));
    }, timeoutMs);

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      // Ignore anything that is not the callback (favicon requests, probes).
      if (!state && !code && !error) {
        res.writeHead(204).end();
        return;
      }

      const finish = (status: number, html: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);
      };

      if (error) {
        finish(400, DONE_PAGE("Authorization failed", `The server said: ${error}`));
        clearTimeout(timer);
        reject(new OAuthError(`Authorization was refused: ${url.searchParams.get("error_description") || error}`));
        return;
      }
      if (state !== expectedState) {
        finish(400, DONE_PAGE("Authorization failed", "State did not match this login attempt."));
        return; // do NOT reject: a stray request must not kill a live login
      }
      if (!code) {
        finish(400, DONE_PAGE("Authorization failed", "No authorization code was returned."));
        clearTimeout(timer);
        reject(new OAuthError("No authorization code was returned."));
        return;
      }

      finish(200, DONE_PAGE("You are signed in", "You can close this tab and return to your assistant."));
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function exchange(
  meta: AuthServerMetadata,
  body: Record<string, string>,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new OAuthError(`Token request failed: ${detail}`);
  }
  return data;
}

function persist(
  issuer: string,
  t: { access_token: string; refresh_token?: string; expires_in?: number },
): string {
  saveTokens(issuer, {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    // Stored as an absolute instant: expires_in is only meaningful at the
    // moment of the response, and this file outlives the process.
    expires_at: typeof t.expires_in === "number" ? Date.now() + t.expires_in * 1000 : undefined,
  });
  return t.access_token;
}

/** 60s of slack, so a token that expires mid-request is refreshed beforehand. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Return a usable access token, doing as little as possible: cached token if it
 * is still good, else a refresh, else a full browser login.
 *
 * `interactive: false` is what lets a tool answer "you need to log in" as a
 * normal result instead of silently opening a browser on someone's machine
 * mid-conversation.
 */
export async function getAccessToken(opts: { interactive: boolean }): Promise<string> {
  const issuer = await discoverIssuer();
  const cached = loadTokens(issuer);

  if (cached?.access_token) {
    const fresh = !cached.expires_at || cached.expires_at - EXPIRY_SKEW_MS > Date.now();
    if (fresh) return cached.access_token;

    if (cached.refresh_token) {
      try {
        const meta = await discoverMetadata(issuer);
        const client = loadClient(issuer);
        const refreshed = await exchange(meta, {
          grant_type: "refresh_token",
          refresh_token: cached.refresh_token,
          ...(client?.client_id ? { client_id: client.client_id } : {}),
        });
        return persist(issuer, refreshed);
      } catch {
        // A refresh token can be revoked or rotated out from under us. Drop it
        // and fall through to a fresh login rather than failing permanently.
        clearTokens(issuer);
      }
    }
  }

  if (!opts.interactive) {
    throw new OAuthError(
      "Not signed in.",
      "Call the `login` tool to authorize this server in your browser.",
    );
  }

  return login(issuer);
}

/** Run the full interactive flow and return the new access token. */
export async function login(knownIssuer?: string): Promise<string> {
  const issuer = knownIssuer ?? (await discoverIssuer());
  const meta = await discoverMetadata(issuer);

  // Bind first: the redirect URI must name the port the listener actually got.
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new OAuthError("Could not bind a loopback port.");
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;

    const clientId = AUTH_CONFIG.clientIdOverride || (await registerClient(meta, redirectUri));

    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(16));

    // Ask only for what is actually issued, intersected with what this server
    // advertises. offline_access is the one that matters: without it there is
    // no refresh token and the user re-authorizes when the token expires.
    const wanted = ["openid", "email", "profile", "offline_access"];
    const supported = meta.scopes_supported;
    const scope = (supported ? wanted.filter((s) => supported.includes(s)) : wanted).join(" ");

    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    // stderr, never stdout: stdout IS the MCP JSON-RPC stream and anything
    // written there corrupts the protocol.
    process.stderr.write(
      AUTH_CONFIG.noBrowser
        ? `\n[scriptivox] Open this URL to sign in:\n${authUrl.toString()}\n\n`
        : `\n[scriptivox] Opening your browser to sign in.\nIf it does not open, visit:\n${authUrl.toString()}\n\n`,
    );
    if (!AUTH_CONFIG.noBrowser) openBrowser(authUrl.toString());

    const code = await awaitCallback(server, state, AUTH_CONFIG.loginTimeoutMs);

    const tokens = await exchange(meta, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });

    return persist(issuer, tokens);
  } finally {
    server.close();
  }
}

/** Forget the stored tokens for the active issuer. */
export async function logout(): Promise<string> {
  const issuer = await discoverIssuer();
  clearTokens(issuer);
  return issuer;
}

export { AUTH_FILE_PATH, discoverIssuer };
