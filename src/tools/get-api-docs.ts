import { getApiDocsText } from "../data/api-docs.js";

export const getApiDocsDefinition = {
  name: "get_api_docs",
  description:
    "Get Scriptivox API documentation. Sections: quickstart, transcribe, result, upload, balance, webhooks, errors. No API key required.",
  inputSchema: {
    type: "object" as const,
    properties: {
      section: {
        type: "string",
        description:
          'Documentation section. Options: "quickstart", "transcribe", "result", "upload", "balance", "webhooks", "errors", "all". Defaults to "quickstart".',
        enum: [
          "quickstart",
          "transcribe",
          "result",
          "upload",
          "balance",
          "webhooks",
          "errors",
          "all",
        ],
      },
    },
  },
};

export function handleGetApiDocs(args: { section?: string }) {
  return {
    content: [
      {
        type: "text" as const,
        text: getApiDocsText(args.section || "quickstart"),
      },
    ],
  };
}
