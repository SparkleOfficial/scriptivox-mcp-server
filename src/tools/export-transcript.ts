import { CONFIG, hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { ScriptivoxApiError } from "../api/client.js";

export const exportTranscriptDefinition = {
  name: "export_transcript",
  description:
    "Export a completed Scriptivox transcript as SRT subtitles, WebVTT subtitles, or plain text. Supports segmentation knobs (max_words, max_chars, max_duration, sentence_aware, include_speakers, strip_chars). Returns the file content as text. Requires the transcription to be in `completed` status. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: {
        type: "string",
        description: "The completed transcription ID (UUID).",
      },
      format: {
        type: "string",
        description:
          "Output format. 'srt' = SubRip, 'vtt' = WebVTT, 'text' = plain text.",
        enum: ["srt", "vtt", "text"],
      },
      max_words: {
        type: "number",
        description:
          "Max words per caption segment. Default 4 (TikTok-style). Higher = longer captions.",
      },
      max_chars: {
        type: "number",
        description:
          "Max characters per caption segment. Default 80. Use with max_words to control segment density.",
      },
      max_duration: {
        type: "number",
        description: "Max seconds per caption segment. Default 10.",
      },
      sentence_aware: {
        type: "boolean",
        description:
          "Break segments at sentence boundaries when possible. Default true.",
      },
      include_speakers: {
        type: "string",
        description:
          "Whether to prefix caption lines with speaker tags. 'auto' (default — include when diarize was on), 'true' (always include), or 'false' (never include).",
        enum: ["auto", "true", "false"],
      },
      strip_chars: {
        type: "string",
        description:
          "Characters to strip from the transcript before formatting (e.g. punctuation cleanup).",
      },
    },
    required: ["transcription_id", "format"],
  },
};

const UUID_PATTERN = /^[a-f0-9\-]{36}$/i;

export async function handleExportTranscript(args: {
  transcription_id: string;
  format: "srt" | "vtt" | "text";
  max_words?: number;
  max_chars?: number;
  max_duration?: number;
  sentence_aware?: boolean;
  include_speakers?: "auto" | "true" | "false";
  strip_chars?: string;
}) {
  if (!hasApiKey()) {
    return {
      content: [{ type: "text" as const, text: NO_API_KEY_MESSAGE }],
      isError: true,
    };
  }

  if (!UUID_PATTERN.test(args.transcription_id)) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Invalid transcription ID format. Expected a UUID.",
        },
      ],
      isError: true,
    };
  }

  // Build query string with all the segmentation knobs (server will apply
  // defaults for any we don't pass; see _shared/captions.ts).
  const params = new URLSearchParams();
  params.set("format", args.format);
  if (args.max_words != null) params.set("max_words", String(args.max_words));
  if (args.max_chars != null) params.set("max_chars", String(args.max_chars));
  if (args.max_duration != null) params.set("max_duration", String(args.max_duration));
  if (args.sentence_aware != null) params.set("sentence_aware", String(args.sentence_aware));
  if (args.include_speakers) params.set("include_speakers", args.include_speakers);
  if (args.strip_chars) params.set("strip_chars", args.strip_chars);

  const url = `${CONFIG.apiBaseUrl}/transcribe/${args.transcription_id}?${params.toString()}`;

  // The export endpoint returns raw text (text/plain or text/vtt), not JSON,
  // so we bypass apiRequest's JSON parser and read body directly.
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: CONFIG.apiKey },
    });
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Network error contacting Scriptivox: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  if (!response.ok) {
    // Error path returns JSON {error: {code, message}}, same envelope as other endpoints.
    try {
      const errBody = await response.json();
      const apiErr = errBody as { error?: { code: string; message: string } };
      return {
        content: [
          {
            type: "text" as const,
            text: `Error (${apiErr.error?.code || response.status}): ${apiErr.error?.message || "Export failed"}`,
          },
        ],
        isError: true,
      };
    } catch {
      return {
        content: [
          {
            type: "text" as const,
            text: `Export failed: HTTP ${response.status}`,
          },
        ],
        isError: true,
      };
    }
  }

  const body = await response.text();
  const contentType = response.headers.get("Content-Type") || "text/plain";

  return {
    content: [
      {
        type: "text" as const,
        text: `Format: ${args.format.toUpperCase()}  (Content-Type: ${contentType})
==================================================

${body}`,
      },
    ],
  };
}
