import { getPricingText } from "../data/pricing.js";

export const getPricingDefinition = {
  name: "get_pricing",
  description:
    "Get Scriptivox pricing information including subscription plans (Free, Pro, Team) and API pay-as-you-go rates. Includes signup URLs. No API key required.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export function handleGetPricing() {
  return {
    content: [{ type: "text" as const, text: getPricingText() }],
  };
}
