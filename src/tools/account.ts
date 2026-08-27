import { functionsBaseFrom } from "../config.js";
import { login, logout, discoverIssuer, AUTH_FILE_PATH } from "../auth/oauth.js";
import {
  type ToolResult,
  SITE,
  PLATFORM,
  API_BASE,
  text,
  json,
  authFailure,
  callFunction,
  upstreamError,
  withToken,
} from "./user-client.js";

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
        "Signed in. Every tool that acts on your account is now usable:",
        "  account:     get_account, create_api_key, revoke_api_key",
        "  billing:     purchase_plan, top_up_balance, get_billing_history, get_billing_portal_url",
        "  library:     list_tags, tag_transcriptions, list_folders, move_to_folder, list_workspaces,",
        "               generate_summary, list_shares, get_transcript_audio, chat_with_transcript",
        "  automations: list_automations, run_automation, get_automation_run",
        "  meetings:    start_meeting_bot, stop_meeting_bot, cancel_scheduled_bot,",
        "               list_scheduled_meetings",
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

// ─── Billing: reading, not spending ─────────────────────────────────────────
//
// Safe in the way the two above are not: one reads history, the other returns a
// link to Stripe's own portal. Neither moves a cent, and both say so, because
// an agent that thinks a tool might charge its human will either refuse to call
// it or call it and apologise.

export const getBillingHistoryDefinition = {
  name: "get_billing_history",
  description:
    "Read past invoices, add-on charges, lifetime purchases and API deposits for the signed-in " +
    "person, newest first, with a link to each Stripe invoice. Read-only — charges nothing and " +
    "changes nothing. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: { type: "number", description: "Rows per page, 1-100. Default 24." },
      before: {
        type: "string",
        description: "ISO 8601 timestamp to page backwards from — the `next_cursor` from a previous call.",
      },
    },
  },
};

export async function handleGetBillingHistory(args: Record<string, unknown>): Promise<ToolResult> {
  const body: Record<string, unknown> = {};

  if (args.limit !== undefined) {
    const limit = typeof args.limit === "number" ? Math.floor(args.limit) : NaN;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      return text("`limit` must be a whole number between 1 and 100.", true);
    }
    body.limit = limit;
  }

  const before = typeof args.before === "string" ? args.before.trim() : "";
  if (before) {
    if (Number.isNaN(Date.parse(before))) {
      return text("`before` must be an ISO 8601 timestamp — the `next_cursor` from a previous call.", true);
    }
    body.before = before;
  }

  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "get-billing-history", body);
    if (!ok) return upstreamError("Reading the billing history", status, data);

    const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];
    if (rows.length === 0) {
      return text("No billing history on this account — nothing has been charged yet.");
    }

    const lines = rows.map((r) => {
      const amount = `$${(Number(r.amount_cents ?? 0) / 100).toFixed(2)} ${String(r.currency ?? "usd").toUpperCase()}`;
      return [
        `${String(r.date ?? "").slice(0, 10)}  ${String(r.kind ?? "").padEnd(16)} ${amount.padStart(12)}  ${r.status ?? ""}`,
        r.description ? `    ${r.description}` : "",
        r.hosted_invoice_url ? `    invoice: ${r.hosted_invoice_url}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    if (data?.has_more && data?.next_cursor) {
      lines.push("", `next_cursor: ${data.next_cursor}  (pass as \`before\` for the next page)`);
    }
    if (data?.stale) {
      lines.push(
        "",
        "These rows come from a mirror of Stripe that was slightly behind when read. It refreshes " +
          "itself on access, so calling again in a moment may show more.",
      );
    }
    return text(lines.join("\n"));
  });
}

export const getBillingPortalUrlDefinition = {
  name: "get_billing_portal_url",
  description:
    "Return a link to the Stripe billing portal for the signed-in person, where they can change " +
    "their card, download invoices, or cancel a subscription. Charges nothing and changes nothing " +
    "on its own: it returns a link the person must open themselves. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleGetBillingPortalUrl(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "api-deposit", {
      action: "billing_portal",
    });
    if (!ok) return upstreamError("Opening the billing portal", status, data);

    const url = data?.url;
    if (!url) return text("The portal session was created but no URL was returned.", true);

    return text(
      [
        "Stripe billing portal link for this account:",
        "",
        url,
        "",
        "This CHARGES NOTHING. It is a link the person opens themselves, where they can change their",
        "card, download invoices, or cancel a subscription. You cannot do any of that for them.",
        "",
        "The link is single-use and expires; generate a fresh one rather than reusing an old one.",
      ].join("\n"),
    );
  });
}
