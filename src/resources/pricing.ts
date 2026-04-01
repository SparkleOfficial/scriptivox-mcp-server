import { getPricingText } from "../data/pricing.js";

export const pricingResource = {
  uri: "scriptivox://pricing",
  name: "Scriptivox Pricing",
  description:
    "Subscription plans (Free, Pro, Team) and API pay-as-you-go rates",
  mimeType: "text/plain",
};

export function handlePricingResource() {
  return {
    contents: [
      {
        uri: pricingResource.uri,
        mimeType: pricingResource.mimeType,
        text: getPricingText(),
      },
    ],
  };
}
