import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, hasApiKey, NO_API_KEY_MESSAGE } from "../config.js";
import { apiRequest, ScriptivoxApiError } from "../api/client.js";
import { handleTranscribeUrl } from "./transcribe-url.js";

export const transcribeUploadDefinition = {
  name: "transcribe_upload",
  description:
    "Transcribe a LOCAL file by uploading it to Scriptivox. Drives the full 3-step upload flow: requests a presigned URL, uploads the file, and starts the transcription. Same options as transcribe_url (language, diarize, etc.). Best for files not yet on a public URL. Max file size 5 GB. Requires a configured API key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description:
          "Absolute path to the audio/video file on the local filesystem (e.g. '/Users/me/recording.mp3'). 25 formats supported (10 audio, 15 video).",
      },
      language: {
        type: "string",
        description:
          'ISO 639-1 language code (e.g. "en", "es"). RECOMMENDED — pass this when known.',
      },
      diarize: {
        type: "boolean",
        description: "Enable speaker diarization. Default: false.",
      },
      speaker_count: {
        type: "number",
        description: "Expected speakers (1-50). Requires diarize: true.",
      },
      align: {
        type: "boolean",
        description: "Word-level timestamps. Default: true.",
      },
      webhook_url: {
        type: "string",
        description: "Optional HTTPS webhook URL.",
      },
      idempotency_key: {
        type: "string",
        description: "Optional Idempotency-Key header.",
      },
      await_completed: {
        type: "boolean",
        description:
          "Default: true. When false, returns the transcription_id immediately without polling.",
      },
    },
    required: ["file_path"],
  },
};

interface UploadCreateResponse {
  upload_id: string;
  upload_url: string;
  expires_in: number;
  method: "PUT";
  headers: Record<string, string>;
}

// Best-effort mime-type guess from extension. Mirrors the server-side map in
// supabase/functions/_shared/apiS3.ts. Defaults to application/octet-stream
// when unknown — Supabase Storage will still accept it.
const MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".wma": "audio/x-ms-wma",
  ".aiff": "audio/aiff",
  ".opus": "audio/opus",
  ".caf": "audio/x-caf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".m4v": "video/x-m4v",
  ".3gp": "video/3gpp",
  ".mpeg": "video/mpeg",
  ".mts": "video/mp2t",
  ".ogv": "video/ogg",
  ".ts": "video/mp2t",
  ".vob": "video/mpeg",
  ".f4v": "video/mp4",
};

const FIVE_GB = 5 * 1024 * 1024 * 1024;

export async function handleTranscribeUpload(args: {
  file_path: string;
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

  // Validate path + read file
  const filePath = args.file_path;
  if (!path.isAbsolute(filePath)) {
    return {
      content: [
        {
          type: "text" as const,
          text: "file_path must be an absolute path (e.g. /Users/you/recording.mp3).",
        },
      ],
      isError: true,
    };
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Cannot read file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  if (!stat.isFile()) {
    return {
      content: [
        { type: "text" as const, text: `Not a regular file: ${filePath}` },
      ],
      isError: true,
    };
  }
  if (stat.size > FIVE_GB) {
    return {
      content: [
        {
          type: "text" as const,
          text: `File size ${(stat.size / (1024 ** 3)).toFixed(2)} GB exceeds the 5 GB limit.`,
        },
      ],
      isError: true,
    };
  }
  if (stat.size === 0) {
    return {
      content: [{ type: "text" as const, text: "File is empty." }],
      isError: true,
    };
  }

  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const localContentType = MIME_BY_EXT[ext] || "application/octet-stream";

  // Step 1: request presigned URL
  let upload: UploadCreateResponse;
  try {
    upload = await apiRequest<UploadCreateResponse>("POST", "/upload", { filename });
  } catch (err) {
    if (err instanceof ScriptivoxApiError) {
      return {
        content: [{ type: "text" as const, text: `Upload init failed (${err.code}): ${err.message}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Network error during upload init: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  // Step 2: PUT the file binary to the presigned URL. Use whatever Content-Type
  // the server pinned the presigned URL to (Supabase signs against it), with
  // our extension-derived guess as a fallback.
  const putContentType =
    upload.headers?.["Content-Type"] || upload.headers?.["content-type"] || localContentType;

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  let putResp: Response;
  try {
    // Wrap the file bytes in a Blob — DOM and Node `fetch()` both accept it
    // unambiguously, sidestepping the BodyInit / Buffer type conflict that
    // shows up under TS strict + node-types.
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: putContentType });
    putResp = await fetch(upload.upload_url, {
      method: "PUT",
      headers: { "Content-Type": putContentType },
      body: blob,
    });
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Network error during upload PUT: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  if (!putResp.ok) {
    const body = await putResp.text().catch(() => "");
    return {
      content: [
        {
          type: "text" as const,
          text: `Upload PUT failed: HTTP ${putResp.status}\n${body.substring(0, 400)}`,
        },
      ],
      isError: true,
    };
  }

  // Step 3: start transcription using the upload_id. We construct the same
  // body shape transcribe_url uses, just with upload_id instead of url.
  // Reuse transcribe-url's polling logic by transforming the args.
  try {
    const headers: Record<string, string> = {};
    if (args.idempotency_key) headers["Idempotency-Key"] = args.idempotency_key;

    const body: Record<string, unknown> = { upload_id: upload.upload_id };
    if (args.language) body.language = args.language;
    if (args.diarize !== undefined) body.diarize = args.diarize;
    if (args.speaker_count !== undefined) body.speaker_count = args.speaker_count;
    if (args.align !== undefined) body.align = args.align;
    if (args.webhook_url) body.webhook_url = args.webhook_url;

    const createResult = await apiRequest<{ id: string; status: string }>(
      "POST",
      "/transcribe",
      body,
      headers,
    );

    // If caller doesn't want to wait, return the ID and let them poll.
    if (args.await_completed === false) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Upload complete. Transcription accepted.

  Upload ID:        ${upload.upload_id}
  Transcription ID: ${createResult.id}

Use transcribe_status to check progress${args.webhook_url ? `, or wait for the webhook at ${args.webhook_url}` : ""}.`,
          },
        ],
      };
    }

    // Otherwise reuse transcribe_url's polling+formatting by hijacking it
    // with a non-URL invocation. Easier: just delegate to it via a no-op
    // URL fetch isn't possible — so inline a minimal poll here.
    // Actually the cleanest path: call transcribe_url with a synthetic URL
    // is wrong (we already started the job). Instead we poll transcribe_status
    // shape via apiRequest directly.

    // Avoid duplicating the entire polling/formatting routine: forward to
    // handleTranscribeUrl... no, can't — transcribe_url starts a new job.
    // We'll do a minimal inline poll. Mirrors transcribe-url.ts behavior.
    const startTime = Date.now();
    await new Promise((r) => setTimeout(r, CONFIG.pollInitialDelayMs));

    while (Date.now() - startTime < CONFIG.pollTimeoutMs) {
      const status = await apiRequest<{
        id: string;
        status: string;
        cost_cents?: number;
        audio_duration_seconds?: number;
        language?: string;
        error?: { code: string; message: string };
        result?: {
          full_transcript: string;
          language: string;
          duration_seconds: number;
          speakers?: string[];
          utterances?: Array<{ start: number; end: number; text: string; speaker?: string }>;
        };
      }>("GET", `/transcribe/${createResult.id}`);

      if (status.status === "completed" && status.result) {
        const r = status.result;
        const cost =
          status.cost_cents != null ? `$${(status.cost_cents / 100).toFixed(4)}` : "N/A";
        let text = `Transcription Complete (uploaded from ${filename})
==================================================
  Transcription ID: ${createResult.id}
  Language:         ${r.language || "auto-detected"}
  Duration:         ${r.duration_seconds}s
  Cost:             ${cost}`;
        if (r.speakers && r.speakers.length) {
          text += `\n  Speakers:         ${r.speakers.length} (${r.speakers.join(", ")})`;
        }
        text += "\n\n--- Transcript ---\n\n";
        if (r.utterances && r.utterances.length > 0) {
          text += r.utterances
            .map((u) => {
              const speaker = u.speaker ? `[${u.speaker}] ` : "";
              return `${speaker}${u.text}`;
            })
            .join("\n\n");
        } else {
          text += r.full_transcript;
        }
        text += `\n\n---\nTranscribed by Scriptivox (https://scriptivox.com)`;
        return { content: [{ type: "text" as const, text }] };
      }

      if (status.status === "failed") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Transcription failed.\n\nError: ${status.error?.code || "UNKNOWN"}\n${status.error?.message || "An unknown error occurred."}\n\nTranscription ID: ${createResult.id}`,
            },
          ],
          isError: true,
        };
      }

      await new Promise((r) => setTimeout(r, CONFIG.pollIntervalMs));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Transcription is still processing (polling timed out).\n\nTranscription ID: ${createResult.id}\n\nUse transcribe_status to check progress.`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof ScriptivoxApiError) {
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
