import { hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";

export const listTranscriptionsDefinition = {
  name: "list_transcriptions",
  description:
    "List recent transcriptions for the configured API key, with optional status / date filters and cursor pagination. The full transcript body is omitted from list responses — fetch the per-id status to get it. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        description:
          "Filter by status: created, downloading, pending, processing, completed, or failed.",
        enum: ["created", "downloading", "pending", "processing", "completed", "failed"],
      },
      from: {
        type: "string",
        description:
          "ISO 8601 timestamp (inclusive lower bound). E.g. '2026-05-01T00:00:00Z'.",
      },
      to: {
        type: "string",
        description:
          "ISO 8601 timestamp (exclusive upper bound).",
      },
      limit: {
        type: "number",
        description: "Max items per page (1-200, default 50).",
      },
      cursor: {
        type: "string",
        description:
          "Opaque cursor from a previous response's `next_cursor` field.",
      },
      order: {
        type: "string",
        description: "Sort order. Default: desc (newest first).",
        enum: ["asc", "desc"],
      },
    },
  },
};

interface ListItem {
  id: string;
  status: string;
  audio_duration_seconds: number | null;
  file_size_bytes: number | null;
  language: string | null;
  diarize: boolean;
  speaker_count: number | null;
  align: boolean;
  cost_cents: number | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

interface ListResponse {
  items: ListItem[];
  has_more: boolean;
  next_cursor?: string;
}

export async function handleListTranscriptions(args: {
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
  order?: string;
}) {
  if (!hasApiKey()) {
    return {
      content: [{ type: "text" as const, text: NO_API_KEY_MESSAGE }],
      isError: true,
    };
  }

  const params = new URLSearchParams();
  if (args.status) params.set("status", args.status);
  if (args.from) params.set("from", args.from);
  if (args.to) params.set("to", args.to);
  if (args.limit) params.set("limit", String(args.limit));
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.order) params.set("order", args.order);

  const qs = params.toString();
  const path = qs ? `/transcriptions?${qs}` : "/transcriptions";

  try {
    const result = await apiRequest<ListResponse>("GET", path);

    if (result.items.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No transcriptions found matching the filters.",
          },
        ],
      };
    }

    const lines = result.items.map((it) => {
      const dur = it.audio_duration_seconds != null ? `${it.audio_duration_seconds}s` : "?";
      const cost = it.cost_cents != null ? `$${(it.cost_cents / 100).toFixed(4)}` : "?";
      return `  ${it.id}  ${it.status.padEnd(11)}  ${dur.padStart(7)}  ${cost.padStart(10)}  ${it.created_at}`;
    });

    let text = `Transcriptions (${result.items.length} shown)
==================================================
  ID                                   Status       Duration       Cost  Created
  ${"─".repeat(36)}  ${"─".repeat(11)}  ${"─".repeat(7)}  ${"─".repeat(10)}  ${"─".repeat(20)}
${lines.join("\n")}`;

    if (result.has_more && result.next_cursor) {
      text += `\n\nMore results available. Call again with cursor: ${result.next_cursor}`;
    }

    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const message =
      err instanceof ScriptivoxApiError
        ? `Error (${err.code}): ${err.message}`
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
