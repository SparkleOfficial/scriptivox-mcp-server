import { hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const transcribeCancelDefinition = {
  name: "transcribe_cancel",
  description:
    "Cancel an in-flight Scriptivox transcription. Refunds any reserved balance. Idempotent — calling again returns the same response. Returns 409 CONFLICT if the job is already in a terminal state (completed/failed). Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: {
        type: "string",
        description: "The transcription ID to cancel (UUID).",
      },
    },
    required: ["transcription_id"],
  },
};

interface CancelResponse {
  id: string;
  status: "failed";
  error: { code: "CANCELLED"; message: string };
  released_cents?: number;
}

const UUID_PATTERN = /^[a-f0-9\-]{36}$/i;

export async function handleTranscribeCancel(args: { transcription_id: string }) {
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

  try {
    const result = await apiRequest<CancelResponse>(
      "POST",
      `/transcribe/${args.transcription_id}/cancel`,
    );

    const released =
      result.released_cents != null
        ? `$${(result.released_cents / 100).toFixed(4)} reserved balance released.`
        : "No reserved balance to release.";

    return {
      content: [
        {
          type: "text" as const,
          text: `Transcription cancelled.

  ID:     ${result.id}
  Status: ${result.status}
  Reason: ${result.error.message}
  ${released}`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof ScriptivoxApiError) {
      // 409 CONFLICT happens when the job is already terminal — surface a
      // clearer message than the generic Error path.
      if (err.code === "CONFLICT") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot cancel: ${err.message}\n\nThe transcription is already in a terminal state (completed or failed). Nothing to do.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Error (${err.code}): ${err.message}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
