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
      text += `\n  Cost: $${((result.cost_cents || 0) / 100).toFixed(3)}`;
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
      text += `\n  Error: ${result.error_code || "UNKNOWN"}`;
      text += `\n  Message: ${result.error_message || "An unknown error occurred."}`;
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
