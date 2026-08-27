import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION } from "./config.js";

// Tools
import { handleGetLanguages } from "./tools/get-languages.js";
import { handleGetPricing } from "./tools/get-pricing.js";
import { handleGetProductInfo } from "./tools/get-product-info.js";
import { handleGetApiDocs } from "./tools/get-api-docs.js";
import { handleCheckBalance } from "./tools/check-balance.js";
import { handleTranscribeUrl } from "./tools/transcribe-url.js";
import { handleTranscribeStatus } from "./tools/transcribe-status.js";
import { handleTranscribeUpload } from "./tools/transcribe-upload.js";
import { handleTranscribeCancel } from "./tools/transcribe-cancel.js";
import { handleTranscribeDelete } from "./tools/transcribe-delete.js";
import { handleListTranscriptions } from "./tools/list-transcriptions.js";
import { handleExportTranscript } from "./tools/export-transcript.js";
import {
  loginDefinition,
  handleLogin,
  logoutDefinition,
  handleLogout,
  createAccountDefinition,
  handleCreateAccount,
  getAccountDefinition,
  handleGetAccount,
  createApiKeyDefinition,
  handleCreateApiKey,
  revokeApiKeyDefinition,
  handleRevokeApiKey,
  purchasePlanDefinition,
  handlePurchasePlan,
  topUpBalanceDefinition,
  handleTopUpBalance,
  getBillingHistoryDefinition,
  handleGetBillingHistory,
  getBillingPortalUrlDefinition,
  handleGetBillingPortalUrl,
} from "./tools/account.js";
import {
  searchTranscriptsDefinition,
  handleSearchTranscripts,
  listTagsDefinition,
  handleListTags,
  listFoldersDefinition,
  handleListFolders,
  listWorkspacesDefinition,
  handleListWorkspaces,
  tagTranscriptionsDefinition,
  handleTagTranscriptions,
  moveToFolderDefinition,
  handleMoveToFolder,
  listSharesDefinition,
  handleListShares,
  getTranscriptAudioDefinition,
  handleGetTranscriptAudio,
  chatWithTranscriptDefinition,
  handleChatWithTranscript,
} from "./tools/library.js";
import {
  listAutomationsDefinition,
  handleListAutomations,
  runAutomationDefinition,
  handleRunAutomation,
  getAutomationRunDefinition,
  handleGetAutomationRun,
} from "./tools/automations.js";
import {
  startMeetingBotDefinition,
  handleStartMeetingBot,
  stopMeetingBotDefinition,
  handleStopMeetingBot,
  cancelScheduledBotDefinition,
  handleCancelScheduledBot,
  listScheduledMeetingsDefinition,
  handleListScheduledMeetings,
} from "./tools/meetings.js";

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
    version: VERSION,
    description:
      "AI transcription for any AI assistant. Transcribe audio/video from URLs or local files with 99% accuracy, speaker diarization, 119 languages, and word-level timestamps. Full CRUD on transcriptions: submit, cancel, delete, list, and export as SRT/VTT/text.",
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
    "Get Scriptivox API documentation. Sections: quickstart, transcribe, result, list, cancel, delete, upload, balance, webhooks, errors. No API key required.",
    {
      section: z
        .enum([
          "quickstart",
          "transcribe",
          "result",
          "list",
          "cancel",
          "delete",
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
    "Transcribe audio or video from a public URL using Scriptivox AI. Supports 119 languages, speaker diarization, and word-level timestamps. RECOMMENDED: always pass the `language` parameter explicitly when you know the audio language — auto-detect has a small failure rate on short clips, code-switched audio, or files starting with music. Requires a configured API key.",
    {
      url: z
        .string()
        .describe(
          "Public URL to an audio or video file (http/https). Supports Google Drive, Dropbox, OneDrive sharing links, and direct file URLs."
        ),
      language: z
        .string()
        .optional()
        .describe(
          'ISO 639-1 language code (e.g. "en", "es", "fr"). 119 languages supported. Strongly recommended when you know the language.'
        ),
      diarize: z
        .boolean()
        .optional()
        .describe(
          "Enable speaker diarization. Default: false. When true, word-level alignment is automatically enabled regardless of `align`."
        ),
      speaker_count: z
        .number()
        .optional()
        .describe(
          "Expected number of speakers (1-50). Requires diarize: true. Passing this when known improves diarization accuracy."
        ),
      align: z
        .boolean()
        .optional()
        .describe(
          "Word-level timestamps + confidence scores. Default: true. Pass false to opt out (ignored when diarize: true)."
        ),
      webhook_url: z
        .string()
        .optional()
        .describe(
          "Optional HTTPS URL where transcription.* events will be POSTed (HMAC-signed)."
        ),
      idempotency_key: z
        .string()
        .optional()
        .describe(
          "Optional Idempotency-Key header (up to 255 chars). Same key + same body = same transcription_id."
        ),
      await_completed: z
        .boolean()
        .optional()
        .describe(
          "Default: true. When false, return the transcription_id immediately without polling."
        ),
    },
    async (args) => handleTranscribeUrl(args)
  );

  server.tool(
    "transcribe_status",
    "Check the status of a Scriptivox transcription job. Use this for long-running transcriptions, after a timeout, or to verify completion. Requires a configured API key.",
    {
      transcription_id: z
        .string()
        .describe("The transcription ID returned from transcribe_url or transcribe_upload."),
    },
    async (args) => handleTranscribeStatus(args)
  );

  // ── Backward-compatibility aliases for @scriptivox/mcp-server@1.0.x ──
  // v1.0.4 used the noun-first names `transcription_url` / `transcription_status`.
  // v1.1.0 renamed them to the verb-first convention (`transcribe_url` /
  // `transcribe_status`) to match every other tool. Keeping the old names as
  // pure delegations so existing Claude Desktop / Cursor configs don't break.
  // Plan: drop these aliases in 2.0.0 once the deprecation has been visible
  // long enough that telemetry shows no one is still calling them.

  server.tool(
    "transcription_url",
    "[DEPRECATED — use transcribe_url instead] Alias kept for backward compatibility with @scriptivox/mcp-server@1.0.x. Will be removed in 2.0.0. Identical behavior to transcribe_url.",
    {
      url: z.string().describe("Public URL to an audio/video file (http/https)."),
      language: z.string().optional().describe('ISO 639-1 language code (e.g. "en"). Strongly recommended when known.'),
      diarize: z.boolean().optional().describe("Enable speaker diarization. Default: false."),
      speaker_count: z.number().optional().describe("Expected number of speakers (1-50). Requires diarize: true."),
      align: z.boolean().optional().describe("Word-level timestamps. Default: true."),
      webhook_url: z.string().optional().describe("Optional HTTPS webhook URL."),
      idempotency_key: z.string().optional().describe("Optional Idempotency-Key header."),
      await_completed: z.boolean().optional().describe("Default: true. When false, return id immediately without polling."),
    },
    async (args) => handleTranscribeUrl(args),
  );

  server.tool(
    "transcription_status",
    "[DEPRECATED — use transcribe_status instead] Alias kept for backward compatibility with @scriptivox/mcp-server@1.0.x. Will be removed in 2.0.0. Identical behavior to transcribe_status.",
    {
      transcription_id: z.string().describe("The transcription ID."),
    },
    async (args) => handleTranscribeStatus(args),
  );

  server.tool(
    "transcribe_upload",
    "Transcribe a LOCAL file by uploading it to Scriptivox. Drives the 3-step upload flow internally. Same options as transcribe_url. Use when the file isn't on a public URL. Max file size 5 GB. Requires a configured API key.",
    {
      file_path: z.string().describe("Absolute path to the audio/video file on the local filesystem."),
      language: z.string().optional().describe("ISO 639-1 language code. Strongly recommended when known."),
      diarize: z.boolean().optional().describe("Enable speaker diarization. Default: false."),
      speaker_count: z.number().optional().describe("Expected speakers (1-50). Requires diarize: true."),
      align: z.boolean().optional().describe("Word-level timestamps. Default: true."),
      webhook_url: z.string().optional().describe("Optional HTTPS webhook URL."),
      idempotency_key: z.string().optional().describe("Optional Idempotency-Key header."),
      await_completed: z.boolean().optional().describe("Default: true. When false, return id without polling."),
    },
    async (args) => handleTranscribeUpload(args)
  );

  server.tool(
    "transcribe_cancel",
    "Cancel an in-flight Scriptivox transcription and release any reserved balance. Idempotent. Returns 409 CONFLICT on already-terminal jobs. Requires a configured API key.",
    {
      transcription_id: z.string().describe("The transcription ID to cancel (UUID)."),
    },
    async (args) => handleTranscribeCancel(args)
  );

  server.tool(
    "transcribe_delete",
    "Soft-delete a Scriptivox transcription record. Idempotent. Returns 409 CONFLICT if the job is still in-flight — cancel first via transcribe_cancel. Requires a configured API key.",
    {
      transcription_id: z.string().describe("The transcription ID to delete (UUID)."),
    },
    async (args) => handleTranscribeDelete(args)
  );

  server.tool(
    "list_transcriptions",
    "List recent transcriptions for the configured API key, with optional status/date filters and cursor pagination. The full transcript body is omitted — fetch transcribe_status per id to read it. Requires a configured API key.",
    {
      status: z.enum(["created", "downloading", "pending", "processing", "completed", "failed"]).optional().describe("Filter by status."),
      from: z.string().optional().describe("ISO 8601 timestamp lower bound (inclusive)."),
      to: z.string().optional().describe("ISO 8601 timestamp upper bound (exclusive)."),
      limit: z.number().optional().describe("Max items per page (1-200, default 50)."),
      cursor: z.string().optional().describe("Opaque cursor from a previous response."),
      order: z.enum(["asc", "desc"]).optional().describe("Sort order. Default: desc."),
    },
    async (args) => handleListTranscriptions(args)
  );

  server.tool(
    "export_transcript",
    "Export a completed Scriptivox transcript as SRT subtitles, WebVTT subtitles, or plain text. Supports segmentation knobs (max_words, max_chars, max_duration, sentence_aware, include_speakers, strip_chars). Requires the transcription to be in `completed` status. Requires a configured API key.",
    {
      transcription_id: z.string().describe("Completed transcription ID (UUID)."),
      format: z.enum(["srt", "vtt", "text"]).describe("Output format."),
      max_words: z.number().optional().describe("Max words per caption segment (default 4)."),
      max_chars: z.number().optional().describe("Max characters per caption segment (default 80)."),
      max_duration: z.number().optional().describe("Max seconds per caption segment (default 10)."),
      sentence_aware: z.boolean().optional().describe("Break at sentence boundaries (default true)."),
      include_speakers: z.enum(["auto", "true", "false"]).optional().describe("Whether to prefix caption lines with speaker tags. 'auto' (default), 'true' (always), 'false' (never)."),
      strip_chars: z.string().optional().describe("Characters to strip from the transcript before formatting."),
    },
    async (args) => handleExportTranscript(args)
  );

  // --- Account and commerce (OAuth user token, NOT an API key) ---
  //
  // These act on a PERSON's account, so an sk_live_ key cannot authorise them:
  // it identifies an API balance, not a signed-in human. `login` runs the
  // OAuth 2.1 browser flow once and the session is refreshed from then on.
  //
  // create_account needs no credential at all — it is how an agent gets a
  // person onto the product in the first place.
  //
  // There is deliberately NO transcription tool in this group. See the header
  // of ./tools/account.ts.

  server.tool(
    "login",
    loginDefinition.description,
    {},
    async () => handleLogin()
  );

  server.tool(
    "logout",
    logoutDefinition.description,
    {},
    async () => handleLogout()
  );

  server.tool(
    "create_account",
    createAccountDefinition.description,
    {
      email: z.string().describe("Email address for the new account."),
      password: z.string().describe("Password for the new account."),
      name: z.string().optional().describe("Display name (optional)."),
      agent_attribution: z.string().optional().describe("Identifier for the agent creating this account (optional)."),
    },
    async (args) => handleCreateAccount(args)
  );

  server.tool(
    "get_account",
    getAccountDefinition.description,
    {},
    async () => handleGetAccount()
  );

  server.tool(
    "create_api_key",
    createApiKeyDefinition.description,
    {
      name: z.string().describe("A label so the person can tell their keys apart."),
    },
    async (args) => handleCreateApiKey(args)
  );

  server.tool(
    "revoke_api_key",
    revokeApiKeyDefinition.description,
    {
      key_id: z.string().describe("Id of the key to revoke."),
    },
    async (args) => handleRevokeApiKey(args)
  );

  server.tool(
    "purchase_plan",
    purchasePlanDefinition.description,
    {
      plan: z.enum(["monthly", "yearly", "team"]).describe("Which plan to buy."),
    },
    async (args) => handlePurchasePlan(args)
  );

  server.tool(
    "top_up_balance",
    topUpBalanceDefinition.description,
    {
      amount_cents: z.number().describe("Amount to add, in US cents. Must be a positive whole number."),
    },
    async (args) => handleTopUpBalance(args)
  );

  server.tool(
    "get_billing_history",
    getBillingHistoryDefinition.description,
    {
      limit: z.number().optional().describe("Rows per page, 1-100. Default 24."),
      before: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp to page backwards from — the `next_cursor` from a previous call."),
    },
    async (args) => handleGetBillingHistory(args)
  );

  server.tool(
    "get_billing_portal_url",
    getBillingPortalUrlDefinition.description,
    {},
    async () => handleGetBillingPortalUrl()
  );

  // --- The library: organising transcripts that already exist ---
  //
  // Everything in this group acts on finished work. None of it can create
  // transcription work — see the header of ./tools/library.ts for the boundary
  // it sits inside and where the single exception lives.

  server.tool(
    "search_transcripts",
    searchTranscriptsDefinition.description,
    {
      query: z.string().optional().describe("Match against the original filename."),
      tag: z.string().optional().describe("Only transcripts carrying this exact tag."),
      folder_id: z
        .string()
        .nullable()
        .optional()
        .describe("Only transcripts in this folder, or null for those in no folder."),
      workspace_id: z.string().optional().describe("Restrict to one workspace."),
      status: z
        .enum(["uploading", "pending", "processing", "completed", "failed"])
        .optional()
        .describe('Filter by status. Most tools here need "completed".'),
      limit: z.number().optional().describe("Rows to return, 1-200. Default 50."),
      offset: z.number().optional().describe("Rows to skip — pass next_offset from a previous call."),
    },
    async (args) => handleSearchTranscripts(args)
  );

  server.tool(
    "list_tags",
    listTagsDefinition.description,
    {},
    async () => handleListTags()
  );

  server.tool(
    "tag_transcriptions",
    tagTranscriptionsDefinition.description,
    {
      transcription_ids: z
        .array(z.string())
        .describe("Transcription ids to tag. At most 10 per call."),
      tags: z
        .array(z.string())
        .describe("Tag names to add. Letters, digits and spaces, max 30 characters each."),
    },
    async (args) => handleTagTranscriptions(args)
  );

  server.tool(
    "list_folders",
    listFoldersDefinition.description,
    {},
    async () => handleListFolders()
  );

  server.tool(
    "move_to_folder",
    moveToFolderDefinition.description,
    {
      transcription_ids: z
        .array(z.string())
        .describe("Transcription ids to move. At most 50 per call."),
      // Nullable, not optional: null is a real instruction ("out of any
      // folder"), and it has to be distinguishable from the field being absent.
      folder_id: z
        .string()
        .nullable()
        .describe("Target folder id, or null to remove them from any folder."),
    },
    async (args) => handleMoveToFolder(args)
  );

  server.tool(
    "list_workspaces",
    listWorkspacesDefinition.description,
    {},
    async () => handleListWorkspaces()
  );

  server.tool(
    "list_shares",
    listSharesDefinition.description,
    {},
    async () => handleListShares()
  );

  server.tool(
    "get_transcript_audio",
    getTranscriptAudioDefinition.description,
    {
      transcription_id: z.string().describe("The transcription ID (UUID)."),
    },
    async (args) => handleGetTranscriptAudio(args)
  );

  server.tool(
    "chat_with_transcript",
    chatWithTranscriptDefinition.description,
    {
      transcription_id: z.string().describe("A completed transcription id."),
      message: z.string().describe("The question to ask about the transcript."),
      conversation_id: z
        .string()
        .optional()
        .describe("Continue an existing thread. Omit to start a new one."),
    },
    async (args) => handleChatWithTranscript(args)
  );

  // --- Automations ---

  server.tool(
    "list_automations",
    listAutomationsDefinition.description,
    {},
    async () => handleListAutomations()
  );

  server.tool(
    "run_automation",
    runAutomationDefinition.description,
    {
      automation_id: z.string().describe("From list_automations."),
      transcription_id: z.string().describe("A COMPLETED transcription. Anything else is refused."),
    },
    async (args) => handleRunAutomation(args)
  );

  server.tool(
    "get_automation_run",
    getAutomationRunDefinition.description,
    {
      run_id: z.string().describe("The run_id returned by run_automation."),
    },
    async (args) => handleGetAutomationRun(args)
  );

  // --- Meeting bots ---
  //
  // The ONE tool here that creates new transcription work. `meeting_url` is a
  // single string on purpose — there is no array form, so bulk recording is not
  // expressible. See the header of ./tools/meetings.ts.

  server.tool(
    "start_meeting_bot",
    startMeetingBotDefinition.description,
    {
      meeting_url: z
        .string()
        .describe(
          "The meeting link to join (Zoom, Google Meet, Teams or Webex). ONE url — this tool does not take a list."
        ),
      title: z.string().optional().describe("Title for the resulting transcript. Optional."),
      language: z
        .string()
        .optional()
        .describe("ISO 639-1 language code for the meeting audio. Optional; auto-detected when omitted."),
      scheduled_time: z
        .string()
        .optional()
        .describe("ISO 8601 time for the bot to join. Omit to join immediately. Must be in the future."),
    },
    async (args) => handleStartMeetingBot(args)
  );

  server.tool(
    "stop_meeting_bot",
    stopMeetingBotDefinition.description,
    {
      transcription_id: z.string().optional().describe("The transcription the bot is recording into."),
      job_id: z.string().optional().describe("The meeting-bot job id. Either this or transcription_id."),
    },
    async (args) => handleStopMeetingBot(args)
  );

  server.tool(
    "cancel_scheduled_bot",
    cancelScheduledBotDefinition.description,
    {
      transcription_id: z.string().optional().describe("A scheduled bot that already exists."),
      dispatch_id: z.string().optional().describe("A dispatch still queued, with no transcription yet."),
    },
    async (args) => handleCancelScheduledBot(args)
  );

  server.tool(
    "list_scheduled_meetings",
    listScheduledMeetingsDefinition.description,
    {},
    async () => handleListScheduledMeetings()
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
