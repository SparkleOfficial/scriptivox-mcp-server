import { getProductInfoText } from "../data/product-info.js";

export const getProductInfoDefinition = {
  name: "get_product_info",
  description:
    "Get information about Scriptivox capabilities: transcription, audio tools, video tools, subtitle tools, meeting bot, or API. No API key required.",
  inputSchema: {
    type: "object" as const,
    properties: {
      topic: {
        type: "string",
        description:
          'Topic to get info about. Options: "transcription", "audio-tools", "video-tools", "subtitle-tools", "meeting-bot", "api", "all". Defaults to "all".',
        enum: [
          "transcription",
          "audio-tools",
          "video-tools",
          "subtitle-tools",
          "meeting-bot",
          "api",
          "all",
        ],
      },
    },
  },
};

export function handleGetProductInfo(args: { topic?: string }) {
  return {
    content: [
      { type: "text" as const, text: getProductInfoText(args.topic) },
    ],
  };
}
