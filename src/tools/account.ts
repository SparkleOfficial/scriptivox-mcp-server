import { AUTH_CONFIG, functionsBaseFrom } from "../config.js";
import {
  getAccessToken,
  login,
  logout,
  discoverIssuer,
  OAuthError,
  AUTH_FILE_PATH,
} from "../auth/oauth.js";

/**
 * Account and commerce tools for the stdio server.
 *
 * These are the half of the product an API key cannot express. A `sk_live_` key
 * authorises the metered transcription API; it is not tied to a signed-in
 * person, so it cannot buy a plan, mint a key, or read an account. These tools
 * take an OAuth user token instead — see ../auth/oauth.ts.
 *
 * They mirror the hosted implementation in the main repo
 * (src/lib/mcp/accountTools.ts) and call the SAME edge functions with the same
 * shapes, so the two surfaces cannot drift in behaviour. Where the wording of a
 * result matters — the "this is the only time the secret is shown" warning, the
 * "nothing is charged until they open the link" caveat — it is deliberately
 * identical, because an agent that learns one surface should not be surprised
 * by the other.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 *
 * No transcription tool here. Web plans include unlimited transcription and are
 * priced for one human; programmatic transcription belongs on the metered API,
 * which the API-key tools already cover. The policy holds because there is no
 * operation to call, not because of a check somewhere.
 *
 * ── Money ───────────────────────────────────────────────────────────────────
 *
 * purchase_plan and top_up_balance return a Stripe Checkout URL. They move no
 * money: the agent hands the URL to its human, who enters card details on
 * Stripe's page.
 */

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const SITE = () => AUTH_CONFIG.siteUrl;
const PLATFORM = "https://platform.scriptivox.com";
const API_BASE = "https://api.scriptivox.com/v1";

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2));
}

/** An OAuth failure explains itself and says what to do; it never leaks a stack. */
function authFailure(err: unknown): ToolResult {
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
async function callFunction(
  token: string,
  issuer: string,
  fn: string,
  body: Record<string, unknown>,
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
    signal: AbortSignal.timeout(20_000),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function upstreamError(label: string, status: number, data: any): ToolResult {
  const detail = (data && (data.error?.message || data.error || data.message)) || `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return text(
      `${label} was refused: ${detail}\n\n` +
        "The access token is missing, expired, or was not granted for this account. " +
        "Call `login` to authorize again.",
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
async function withToken(
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

// ─── login / logout ──────────────────────────────────────────────────────────

export const loginDefinition = {
  name: "login",
  description:
    "Sign in to a Scriptivox account in the browser, so the account and billing tools can act " +
    "on it. Opens a browser window and waits for the person to approve. Needed once; the " +
    "session is remembered and refreshed automatically.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleLogin(): Promise<ToolResult> {
  try {
    await login();
    return text(
      [
        "Signed in. The account and billing tools are now usable:",
        "  get_account, create_api_key, revoke_api_key, purchase_plan, top_up_balance",
        "",
        `The session is stored at ${AUTH_FILE_PATH} and refreshes on its own.`,
        "Call `logout` to forget it.",
      ].join("\n"),
    );
  } catch (err) {
    return authFailure(err);
  }
}

export const logoutDefinition = {
  name: "logout",
  description: "Forget the stored Scriptivox sign-in on this machine.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleLogout(): Promise<ToolResult> {
  try {
    await logout();
    return text("Signed out. The stored session was deleted; call `login` to sign in again.");
  } catch (err) {
    return authFailure(err);
  }
}

// ─── create_account (no credential at all) ──────────────────────────────────

export const createAccountDefinition = {
  name: "create_account",
  description:
    "Create a Scriptivox account. No credential needed; the address must be confirmed by email " +
    "before the account can do anything.",
  inputSchema: {
    type: "object" as const,
    properties: {
      email: { type: "string", description: "Email address for the new account." },
      password: { type: "string", description: "Password for the new account." },
      name: { type: "string", description: "Display name (optional)." },
      agent_attribution: {
        type: "string",
        description: "Identifier for the agent creating this account (optional).",
      },
    },
    required: ["email", "password"],
  },
};

export async function handleCreateAccount(args: Record<string, unknown>): Promise<ToolResult> {
  const email = typeof args.email === "string" ? args.email.trim() : "";
  const password = typeof args.password === "string" ? args.password : "";
  const name = typeof args.name === "string" ? args.name.trim() : "";

  if (!email || !password) return text("`email` and `password` are both required.", true);

  let issuer: string;
  try {
    issuer = await discoverIssuer();
  } catch (err) {
    return authFailure(err);
  }

  try {
    const res = await fetch(`${functionsBaseFrom(issuer)}/agent-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name: name || undefined,
        agent_attribution:
          typeof args.agent_attribution === "string" ? args.agent_attribution : undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.error?.message || data?.error || `HTTP ${res.status}`;
      return text(`Account creation failed: ${detail}`, true);
    }
    return text(
      [
        `An account was requested for ${email}.`,
        "",
        "IMPORTANT: it is not usable yet. A confirmation email has been sent, and until that link",
        "is followed the account can do nothing at all — no quota, no balance, no sign-in.",
        "Tell the person to check their inbox; you cannot complete this step for them.",
        "",
        "Once confirmed, they can:",
        `  - sign in at ${SITE()}/signin`,
        "  - authorise you by calling `login`, so you can act for them",
        `  - mint an API key for programmatic transcription (${PLATFORM}/keys)`,
        "",
        "The reply is identical whether or not this address was already registered, so this is not",
        "a way to find out who has an account.",
      ].join("\n"),
    );
  } catch (err) {
    return text(`Account creation failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

// ─── get_account ─────────────────────────────────────────────────────────────

export const getAccountDefinition = {
  name: "get_account",
  description: "Read the signed-in person's plan, entitlements and quota. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleGetAccount(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "get-user-entitlements", {});
    if (!ok) return upstreamError("Reading the account", status, data);
    return json(data);
  });
}

// ─── API keys: the bridge from the web account to the API ───────────────────

export const createApiKeyDefinition = {
  name: "create_api_key",
  description:
    "Mint a Scriptivox API key for the signed-in person. The bridge from a web account to the " +
    "transcription API. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "A label so the person can tell their keys apart." },
    },
    required: ["name"],
  },
};

export async function handleCreateApiKey(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    return text("`name` is required — a label so the person can tell their keys apart later.", true);
  }
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "api-manage", {
      action: "create",
      name,
    });
    if (!ok) return upstreamError("Creating an API key", status, data);

    const key = data?.key || data?.api_key || null;
    if (!key) {
      return text(
        `The key was created but the secret was not returned, so it cannot be recovered. Check ${PLATFORM}/keys.`,
        true,
      );
    }
    return text(
      [
        "API key created.",
        "",
        key,
        "",
        "This is the ONLY time the secret is shown — it is stored hashed and cannot be retrieved",
        "again. Save it now.",
        "",
        `Use it against ${API_BASE} as \`Authorization: sk_live_...\`, or set it as`,
        "SCRIPTIVOX_API_KEY here to unlock the transcription tools.",
        "",
        "Note this draws on the prepaid API balance, which is separate from any web subscription.",
        "Use top_up_balance to add credit.",
      ].join("\n"),
    );
  });
}

export const revokeApiKeyDefinition = {
  name: "revoke_api_key",
  description:
    "Permanently revoke an API key belonging to the signed-in person. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      key_id: { type: "string", description: "Id of the key to revoke." },
    },
    required: ["key_id"],
  },
};

export async function handleRevokeApiKey(args: Record<string, unknown>): Promise<ToolResult> {
  const keyId = typeof args.key_id === "string" ? args.key_id.trim() : "";
  if (!keyId) return text("`key_id` is required.", true);
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "api-manage", {
      action: "revoke",
      key_id: keyId,
    });
    if (!ok) return upstreamError("Revoking the API key", status, data);
    return text(
      `Key ${keyId} is revoked. Requests using it now fail with INVALID_API_KEY. This cannot be undone.`,
    );
  });
}

// ─── Commerce ────────────────────────────────────────────────────────────────

export const purchasePlanDefinition = {
  name: "purchase_plan",
  description:
    "Start checkout for a Scriptivox web subscription and return a Stripe Checkout URL. " +
    "Charges nothing on its own. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      plan: { type: "string", enum: ["monthly", "yearly", "team"], description: "Which plan to buy." },
    },
    required: ["plan"],
  },
};

export async function handlePurchasePlan(args: Record<string, unknown>): Promise<ToolResult> {
  const plan = typeof args.plan === "string" ? args.plan.trim().toLowerCase() : "";
  const allowed = ["monthly", "yearly", "team"];
  if (!allowed.includes(plan)) return text(`\`plan\` must be one of: ${allowed.join(", ")}.`, true);

  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "create-checkout", {
      planType: plan,
      billingPeriod: plan === "yearly" ? "yearly" : "monthly",
    });
    if (!ok) return upstreamError("Starting checkout", status, data);

    const url = data?.url || data?.checkout_url;
    if (!url) return text("Checkout started but no URL was returned.", true);

    return text(
      [
        `Checkout is ready for the ${plan} plan:`,
        "",
        url,
        "",
        "You cannot complete this yourself — give the link to the person, who enters their card on",
        "Stripe's page. Nothing is charged until they do.",
        "",
        `Current prices are on ${SITE()}/pricing; the amount on the Stripe page is authoritative.`,
        "",
        "Reminder: a web plan covers transcription done by a person in the browser. It grants no API",
        "credit — for programmatic transcription, use create_api_key and top_up_balance.",
      ].join("\n"),
    );
  });
}

export const topUpBalanceDefinition = {
  name: "top_up_balance",
  description:
    "Start checkout to add credit to the prepaid Scriptivox API balance and return a Stripe " +
    "Checkout URL. Charges nothing on its own. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount_cents: {
        type: "number",
        description: "Amount to add, in US cents. Must be a positive whole number.",
      },
    },
    required: ["amount_cents"],
  },
};

export async function handleTopUpBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const cents = typeof args.amount_cents === "number" ? Math.floor(args.amount_cents) : NaN;
  if (!Number.isFinite(cents) || cents <= 0) {
    return text("`amount_cents` must be a positive whole number of US cents.", true);
  }
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "api-deposit", {
      action: "create_checkout",
      amount_cents: cents,
    });
    if (!ok) return upstreamError("Starting the deposit", status, data);

    const url = data?.checkout_url;
    if (!url) return text("Deposit started but no checkout URL was returned.", true);

    return text(
      [
        `Checkout is ready to add $${(cents / 100).toFixed(2)} to the API balance:`,
        "",
        url,
        "",
        "Give the link to the person to complete — nothing is charged until they do. The balance",
        "updates once Stripe confirms the payment, not when the link is opened.",
        "",
        "Transcription is billed at $0.20 per hour of audio, charged only on success; failed and",
        "cancelled jobs cost nothing.",
      ].join("\n"),
    );
  });
}
