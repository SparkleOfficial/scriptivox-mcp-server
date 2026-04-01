import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Tools
import { handleGetLanguages } from "./tools/get-languages.js";
import { handleGetPricing } from "./tools/get-pricing.js";
import { handleGetProductInfo } from "./tools/get-product-info.js";
import { handleGetApiDocs } from "./tools/get-api-docs.js";
import { handleCheckBalance } from "./tools/check-balance.js";
import { handleTranscribeUrl } from "./tools/transcribe-url.js";
import { handleTranscribeStatus } from "./tools/transcribe-status.js";

// Resources
import {
  pricingResource,
  handlePricingResource,
} from "./resources/pricing.js";
import {
  languagesResource,
  handleLanguagesResource,
} from "./resources/languages.js";
import {
  apiDocsResource,
  handleApiDocsResource,
} from "./resources/api-docs.js";

// Prompts
import { handleTranscribeAudioPrompt } from "./prompts/transcribe-audio.js";
import { handleMeetingNotesPrompt } from "./prompts/meeting-notes.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "scriptivox",
    version: "1.0.0",
    description:
      "AI transcription for any AI assistant. Transcribe audio/video from URLs with 99% accuracy, speaker diarization, 98+ languages, and word-level timestamps.",
  });

  // --- Register Tools ---

  // Static tools (no API key needed)
  server.tool(
    "get_supported_languages",
    "List all languages supported by Scriptivox for audio/video transcription. Returns language names and ISO codes. No API key required.",
    {},
    async () => handleGetLanguages()
  );

  server.tool(
    "get_pricing",
    "Get Scriptivox pricing information including subscription plans (Free, Pro, Team) and API pay-as-you-go rates. Includes signup URLs. No API key required.",
    {},
    async () => handleGetPricing()
  );

  server.tool(
    "get_product_info",
    "Get information about Scriptivox capabilities: transcription, audio tools, video tools, subtitle tools, meeting bot, or API. No API key required.",
    {
      topic: z
        .enum([
          "transcription",
          "audio-tools",
          "video-tools",
          "subtitle-tools",
          "meeting-bot",
          "api",
          "all",
        ])
        .optional()
        .describe(
          'Topic to get info about. Defaults to "all".'
        ),
    },
    async (args) => handleGetProductInfo(args)
  );

  server.tool(
    "get_api_docs",
    "Get Scriptivox API documentation. Sections: quickstart, transcribe, result, upload, balance, webhooks, errors. No API key required.",
    {
      section: z
        .enum([
          "quickstart",
          "transcribe",
          "result",
          "upload",
          "balance",
          "webhooks",
          "errors",
          "all",
        ])
        .optional()
        .describe(
          'Documentation section. Defaults to "quickstart".'
        ),
    },
    async (args) => handleGetApiDocs(args)
  );

  // API tools (require API key)
  server.tool(
    "check_balance",
    "Check your Scriptivox API credit balance, available hours, and pricing. Requires a configured API key.",
    {},
    async () => handleCheckBalance()
  );

  server.tool(
    "transcribe_url",
    "Transcribe audio or video from a public URL using Scriptivox AI. Supports 100+ languages, speaker diarization, and word-level timestamps. Returns the full transcript. Requires a configured API key.",
    {
      url: z
        .string()
        .describe(
          "Public URL to an audio or video file (http/https). Supports Google Drive, Dropbox, and OneDrive sharing links."
        ),
      language: z
        .string()
        .optional()
        .describe(
          'ISO 639-1 language code (e.g. "en", "es", "fr"). Omit for automatic detection.'
        ),
      diarize: z
        .boolean()
        .optional()
        .describe(
          "Enable speaker diarization to identify who said what. Default: false."
        ),
      speaker_count: z
        .number()
        .optional()
        .describe(
          "Expected number of speakers (1-50). Requires diarize to be true."
        ),
      align: z
        .boolean()
        .optional()
        .describe(
          "Enable word-level timestamps with confidence scores. Default: false."
        ),
    },
    async (args) => handleTranscribeUrl(args)
  );

  server.tool(
    "transcribe_status",
    "Check the status of a Scriptivox transcription job. Use this for long-running transcriptions or to retrieve results after a timeout. Requires a configured API key.",
    {
      transcription_id: z
        .string()
        .describe("The transcription ID returned from transcribe_url."),
    },
    async (args) => handleTranscribeStatus(args)
  );

  // --- Register Resources ---

  server.resource(
    pricingResource.name,
    pricingResource.uri,
    {
      description: pricingResource.description,
      mimeType: pricingResource.mimeType,
    },
    async () => handlePricingResource()
  );

  server.resource(
    languagesResource.name,
    languagesResource.uri,
    {
      description: languagesResource.description,
      mimeType: languagesResource.mimeType,
    },
    async () => handleLanguagesResource()
  );

  server.resource(
    apiDocsResource.name,
    apiDocsResource.uri,
    {
      description: apiDocsResource.description,
      mimeType: apiDocsResource.mimeType,
    },
    async () => handleApiDocsResource()
  );

  // --- Register Prompts ---

  server.prompt(
    "transcribe-audio",
    "Transcribe audio or video from a URL. Paste a link and get the full transcript with optional speaker identification.",
    {
      url: z.string().describe("Public URL to the audio or video file"),
      language: z
        .string()
        .optional()
        .describe(
          'ISO 639-1 language code (e.g. "en", "es"). Omit for auto-detection.'
        ),
      diarize: z
        .string()
        .optional()
        .describe(
          'Set to "true" to enable speaker identification. Default: false.'
        ),
    },
    async (args) =>
      handleTranscribeAudioPrompt(args as { url: string; language?: string; diarize?: string })
  );

  server.prompt(
    "meeting-notes",
    "Transcribe a meeting recording and generate structured meeting notes with action items, key decisions, and speaker attribution.",
    {
      url: z
        .string()
        .describe("Public URL to the meeting recording"),
    },
    async (args) => handleMeetingNotesPrompt(args as { url: string })
  );

  return server;
}
