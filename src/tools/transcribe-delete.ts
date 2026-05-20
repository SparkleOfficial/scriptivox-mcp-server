import { hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const transcribeDeleteDefinition = {
  name: "transcribe_delete",
  description:
    "Soft-delete a Scriptivox transcription record. Idempotent — deleting an already-deleted record returns success again. Returns 409 CONFLICT if the job is still in-flight (created/downloading/processing) — cancel first via transcribe_cancel. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: {
        type: "string",
        description: "The transcription ID to delete (UUID).",
      },
    },
    required: ["transcription_id"],
  },
};

const UUID_PATTERN = /^[a-f0-9\-]{36}$/i;

export async function handleTranscribeDelete(args: { transcription_id: string }) {
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
    // DELETE returns 204 No Content — pass allowEmptyResponse so the client
    // doesn't try to JSON.parse an empty body.
    await apiRequest<void>(
      "DELETE",
      `/transcribe/${args.transcription_id}`,
      undefined,
      undefined,
      { allowEmptyResponse: true },
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `Transcription ${args.transcription_id} deleted.`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof ScriptivoxApiError) {
      if (err.code === "CONFLICT") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot delete: ${err.message}\n\nThe transcription is still in-flight. Use transcribe_cancel first, then transcribe_delete.`,
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
