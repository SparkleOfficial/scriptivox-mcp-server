import { CONFIG, hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const transcribeUrlDefinition = {
  name: "transcribe_url",
  description:
    "Transcribe audio or video from a public URL using Scriptivox AI. Supports 100+ languages, speaker diarization, and word-level timestamps. Returns the full transcript. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "Public URL to an audio or video file (http/https). Supports Google Drive, Dropbox, and OneDrive sharing links.",
      },
      language: {
        type: "string",
        description:
          'ISO 639-1 language code (e.g. "en", "es", "fr"). Omit for automatic detection.',
      },
      diarize: {
        type: "boolean",
        description:
          "Enable speaker diarization to identify who said what. Default: false.",
      },
      speaker_count: {
        type: "number",
        description:
          "Expected number of speakers (1-50). Requires diarize to be true.",
      },
      align: {
        type: "boolean",
        description:
          "Enable word-level timestamps with confidence scores. Default: false.",
      },
    },
    required: ["url"],
  },
};

interface TranscribeCreateResponse {
  id: string;
  status: string;
  message?: string;
}

interface Utterance {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

interface TranscribeResultResponse {
  id: string;
  status: "created" | "downloading" | "processing" | "completed" | "failed";
  audio_duration_seconds?: number;
  language?: string;
  cost_cents?: number;
  error_code?: string;
  error_message?: string;
  progress?: string;
  result?: {
    full_transcript: string;
    language: string;
    duration_seconds: number;
    speakers?: string[];
    utterances?: Utterance[];
  };
}

const UUID_PATTERN = /^[a-f0-9\-]{36}$/i;

export async function handleTranscribeUrl(args: {
  url: string;
  language?: string;
  diarize?: boolean;
  speaker_count?: number;
  align?: boolean;
}) {
  if (!hasApiKey()) {
    return {
      content: [{ type: "text" as const, text: NO_API_KEY_MESSAGE }],
      isError: true,
    };
  }

  // Validate URL format
  try {
    const parsed = new URL(args.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Invalid URL. Only http:// and https:// URLs are supported.",
          },
        ],
        isError: true,
      };
    }
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: "Invalid URL format. Please provide a valid http:// or https:// URL.",
        },
      ],
      isError: true,
    };
  }

  try {
    // Start transcription
    const body: Record<string, unknown> = { url: args.url };
    if (args.language) body.language = args.language;
    if (args.diarize) body.diarize = args.diarize;
    if (args.speaker_count) body.speaker_count = args.speaker_count;
    if (args.align) body.align = args.align;

    const createResult = await apiRequest<TranscribeCreateResponse>(
      "POST",
      "/transcribe",
      body
    );

    const transcriptionId = createResult.id;

    // Validate the returned ID to prevent path injection
    if (!UUID_PATTERN.test(transcriptionId)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Received unexpected transcription ID format from API: ${transcriptionId.substring(0, 50)}`,
          },
        ],
        isError: true,
      };
    }

    // Poll for results
    await sleep(CONFIG.pollInitialDelayMs);

    const startTime = Date.now();
    while (Date.now() - startTime < CONFIG.pollTimeoutMs) {
      const result = await apiRequest<TranscribeResultResponse>(
        "GET",
        `/transcribe/${transcriptionId}`
      );

      if (result.status === "completed" && result.result) {
        return {
          content: [
            {
              type: "text" as const,
              text: formatTranscript(result),
            },
          ],
        };
      }

      if (result.status === "failed") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Transcription failed.\n\nError: ${result.error_code || "UNKNOWN"}\n${result.error_message || "An unknown error occurred."}\n\nTranscription ID: ${transcriptionId}`,
            },
          ],
          isError: true,
        };
      }

      await sleep(CONFIG.pollIntervalMs);
    }

    // Timeout — return ID for manual checking
    return {
      content: [
        {
          type: "text" as const,
          text: `Transcription is still processing (timed out after 10 minutes).\n\nTranscription ID: ${transcriptionId}\n\nUse the transcribe_status tool to check progress later.`,
        },
      ],
    };
  } catch (err) {
    const message =
      err instanceof ScriptivoxApiError
        ? `Error (${err.code}): ${err.message}`
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

function formatTranscript(result: TranscribeResultResponse): string {
  const r = result.result!;
  const duration = formatDuration(r.duration_seconds);
  const costStr = result.cost_cents
    ? `$${(result.cost_cents / 100).toFixed(3)}`
    : "N/A";

  let text = `Transcription Complete
==================================================
  Language: ${r.language || "auto-detected"}
  Duration: ${duration}
  Cost: ${costStr}`;

  if (r.speakers && r.speakers.length > 0) {
    text += `\n  Speakers: ${r.speakers.length} (${r.speakers.join(", ")})`;
  }

  text += "\n\n--- Transcript ---\n\n";

  if (r.utterances && r.utterances.length > 0) {
    text += r.utterances
      .map((u) => {
        const timestamp = `[${formatTimestamp(u.start)} → ${formatTimestamp(u.end)}]`;
        const speaker = u.speaker ? `[${u.speaker}] ` : "";
        return `${timestamp} ${speaker}${u.text}`;
      })
      .join("\n\n");
  } else {
    text += r.full_transcript;
  }

  text += `\n\n---\nTranscribed by Scriptivox (https://scriptivox.com)`;

  return text;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
