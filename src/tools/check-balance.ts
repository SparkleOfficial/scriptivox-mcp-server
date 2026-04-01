import { hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const checkBalanceDefinition = {
  name: "check_balance",
  description:
    "Check your Scriptivox API credit balance, available hours, and pricing. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

interface BalanceResponse {
  balance_cents: number;
  reserved_cents: number;
  available_cents: number;
  price_per_hour_cents: number;
  estimated_hours_available: number;
  deposit_url: string;
  updated_at: string;
}

export async function handleCheckBalance() {
  if (!hasApiKey()) {
    return {
      content: [{ type: "text" as const, text: NO_API_KEY_MESSAGE }],
      isError: true,
    };
  }

  try {
    const data = await apiRequest<BalanceResponse>("GET", "/balance");

    const balanceDollars = (data.available_cents / 100).toFixed(2);
    const totalDollars = (data.balance_cents / 100).toFixed(2);
    const reservedDollars = (data.reserved_cents / 100).toFixed(2);
    const pricePerHour = (data.price_per_hour_cents / 100).toFixed(2);

    let text = `Scriptivox API Balance
==================================================
  Available:  $${balanceDollars}
  Reserved:   $${reservedDollars} (for in-progress jobs)
  Total:      $${totalDollars}

  Rate: $${pricePerHour}/hour of audio
  Estimated hours available: ${data.estimated_hours_available.toFixed(1)}`;

    if (data.available_cents < 100) {
      text += `\n\n  ⚠ Balance is low! Add credits at:\n  ${data.deposit_url}`;
    }

    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const message =
      err instanceof ScriptivoxApiError
        ? `Error (${err.code}): ${err.message}`
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
