import { CONFIG, hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const transcribeUrlDefinition = {
  name: "transcribe_url",
  description:
    "Transcribe audio or video from a public URL using Scriptivox AI. Supports 119 languages, speaker diarization, and word-level timestamps. Returns the full transcript. Requires a configured API key. RECOMMENDED: always pass the `language` parameter explicitly when you know the audio language — auto-detection works but can mis-route short clips, code-switched audio, or files starting with music.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "Public URL to an audio or video file (http/https). Supports Google Drive, Dropbox, OneDrive sharing links, and direct file URLs. 25 formats supported (10 audio, 15 video).",
      },
      language: {
        type: "string",
        description:
          'ISO 639-1 language code (e.g. "en", "es", "fr", "ja", "hi"). 119 languages supported. Strongly recommended: pass this when you know the audio language. Omit only if you want the model to auto-detect (works for most cases but has a small failure rate on edge cases).',
      },
      diarize: {
        type: "boolean",
        description:
          "Enable speaker diarization to identify who said what. Default: false. When true, word-level timestamps (`align`) are always enabled regardless of the `align` parameter.",
      },
      speaker_count: {
        type: "number",
        description:
          "Expected number of speakers (1-50). Requires `diarize: true`. Passing this when you know the number noticeably improves diarization accuracy.",
      },
      align: {
        type: "boolean",
        description:
          "Enable word-level timestamps with confidence scores. Default: true. Pass `align: false` to opt out (ignored when `diarize: true` — alignment is required for speaker assignment).",
      },
      webhook_url: {
        type: "string",
        description:
          "Optional. HTTPS URL where Scriptivox will POST `transcription.processing` and `transcription.completed`/`transcription.failed` events. Payloads are signed with HMAC-SHA256(api_key) in the `X-Scriptivox-Signature` header. Fire-and-forget — no retries.",
      },
      idempotency_key: {
        type: "string",
        description:
          "Optional. Up to 255 chars. Retrying the same key with the same body returns the same transcription_id without creating a duplicate. Reusing the key with a different body returns 422 IDEMPOTENCY_KEY_CONFLICT.",
      },
      await_completed: {
        type: "boolean",
        description:
          "Default: true. When true, the tool polls until the transcription is `completed` or `failed` (10-min ceiling). When false, returns immediately with the `transcription_id` — caller uses `transcribe_status` to poll.",
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
  // Includes `pending` — added when upload-flow row waits for the duration probe.
  status: "created" | "downloading" | "pending" | "processing" | "completed" | "failed";
  audio_duration_seconds?: number;
  language?: string;
  cost_cents?: number;
  // Live API returns failures as a nested object, not flat fields.
  // The earlier flat shape was wrong and silently produced "UNKNOWN" everywhere.
  error?: { code: string; message: string };
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
  webhook_url?: string;
  idempotency_key?: string;
  await_completed?: boolean;
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
    // Note: only include `diarize`/`align` when explicitly set — the API has
    // its own defaults (diarize=false, align=true) and we shouldn't override
    // them just because the caller didn't pass the param.
    const body: Record<string, unknown> = { url: args.url };
    if (args.language) body.language = args.language;
    if (args.diarize !== undefined) body.diarize = args.diarize;
    if (args.speaker_count !== undefined) body.speaker_count = args.speaker_count;
    if (args.align !== undefined) body.align = args.align;
    if (args.webhook_url) body.webhook_url = args.webhook_url;

    // Idempotency-Key is a header, not a body field.
    const headers: Record<string, string> = {};
    if (args.idempotency_key) headers["Idempotency-Key"] = args.idempotency_key;

    const createResult = await apiRequest<TranscribeCreateResponse>(
      "POST",
      "/transcribe",
      body,
      headers,
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

    // Caller opted out of polling — return the ID and let them poll via
    // transcribe_status. Useful for agents that don't want to block on a job
    // that might take minutes (or when a webhook_url is set, which obsoletes
    // the need to poll at all).
    if (args.await_completed === false) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Transcription accepted.\n\nTranscription ID: ${transcriptionId}\n\nUse the transcribe_status tool to check progress${args.webhook_url ? `, or wait for the webhook at ${args.webhook_url}` : ""}.`,
          },
        ],
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
              text: formatTranscript(result, transcriptionId),
            },
          ],
        };
      }

      if (result.status === "failed") {
        // Live API shape: error = { code, message } (nested), not flat.
        const code = result.error?.code || "UNKNOWN";
        const message = result.error?.message || "An unknown error occurred.";
        return {
          content: [
            {
              type: "text" as const,
              text: `Transcription failed.\n\nError: ${code}\n${message}\n\nTranscription ID: ${transcriptionId}\n\nIf this looks like a service issue, check status.scriptivox.com.`,
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

function formatTranscript(result: TranscribeResultResponse, transcriptionId: string): string {
  const r = result.result!;
  const duration = formatDuration(r.duration_seconds);
  const costStr = formatCost(result.cost_cents);

  let text = `Transcription Complete
==================================================
  Transcription ID: ${transcriptionId}
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

/**
 * Format cost_cents (returned by the API as actual cents with up to 4 decimals,
 * via roundForApi) as a customer-facing dollar string. Examples from the live API:
 *   cost_cents: 20      → $0.2000 (1 hour of audio)
 *   cost_cents: 0.0167  → $0.0002 (3 seconds of audio)
 *   cost_cents: null    → "N/A"
 */
function formatCost(costCents: number | null | undefined): string {
  if (costCents == null) return "N/A";
  const dollars = costCents / 100;
  return `$${dollars.toFixed(4)}`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
