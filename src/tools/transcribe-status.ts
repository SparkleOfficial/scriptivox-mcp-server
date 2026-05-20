import { hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const transcribeStatusDefinition = {
  name: "transcribe_status",
  description:
    "Check the status of a Scriptivox transcription job. Use this for long-running transcriptions or to retrieve results after a timeout. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: {
        type: "string",
        description: "The transcription ID returned from transcribe_url.",
      },
    },
    required: ["transcription_id"],
  },
};

interface TranscribeStatusResponse {
  id: string;
  // Includes `pending` — upload-flow rows wait here until the duration probe finishes.
  status: "created" | "downloading" | "pending" | "processing" | "completed" | "failed";
  audio_duration_seconds?: number;
  language?: string;
  cost_cents?: number;
  // Live API returns failures as a nested object, not flat fields.
  error?: { code: string; message: string };
  progress?: string;
  result?: {
    full_transcript: string;
    language: string;
    duration_seconds: number;
    speakers?: string[];
    utterances?: Array<{
      start: number;
      end: number;
      text: string;
      speaker?: string;
    }>;
  };
}

const UUID_PATTERN = /^[a-f0-9\-]{36}$/i;

export async function handleTranscribeStatus(args: {
  transcription_id: string;
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
          text: "Invalid transcription ID format. Expected a UUID (e.g. b2c3d4e5-f6a7-8901-bcde-f12345678901).",
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await apiRequest<TranscribeStatusResponse>(
      "GET",
      `/transcribe/${args.transcription_id}`
    );

    let text = `Transcription Status
==================================================
  ID: ${result.id}
  Status: ${result.status}`;

    if (result.progress) {
      text += `\n  Progress: ${result.progress}`;
    }
    if (result.audio_duration_seconds) {
      text += `\n  Audio duration: ${result.audio_duration_seconds}s`;
    }
    if (result.language) {
      text += `\n  Language: ${result.language}`;
    }

    if (result.status === "completed" && result.result) {
      text += `\n  Cost: ${formatCost(result.cost_cents)}`;
      text += `\n\n--- Transcript ---\n\n`;

      if (result.result.utterances && result.result.utterances.length > 0) {
        text += result.result.utterances
          .map((u) => {
            const speaker = u.speaker ? `[${u.speaker}] ` : "";
            return `${speaker}${u.text}`;
          })
          .join("\n\n");
      } else {
        text += result.result.full_transcript;
      }

      text += `\n\n---\nTranscribed by Scriptivox (https://scriptivox.com)`;
    }

    if (result.status === "failed") {
      // Live API shape: error = { code, message } (nested). The old code read
      // result.error_code / result.error_message — fields that don't exist —
      // and always showed "UNKNOWN" / "An unknown error occurred." for every
      // real failure.
      text += `\n  Error: ${result.error?.code || "UNKNOWN"}`;
      text += `\n  Message: ${result.error?.message || "An unknown error occurred."}`;
      text += `\n\nIf this looks like a service-side issue, check status.scriptivox.com.`;
    }

    return { content: [{ type: "text" as const, text }] };
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

/**
 * Format cost_cents (actual cents with up to 4 decimals, per the API's
 * roundForApi helper) as a customer-facing dollar string.
 */
function formatCost(costCents: number | null | undefined): string {
  if (costCents == null) return "N/A";
  const dollars = costCents / 100;
  return `$${dollars.toFixed(4)}`;
}
