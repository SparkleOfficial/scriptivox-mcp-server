const SECTIONS: Record<string, string> = {
  quickstart: `Scriptivox API — Quickstart
==================================================

1. Sign up at https://platform.scriptivox.com
2. Go to https://platform.scriptivox.com/keys and create an API key (starts with sk_live_)
3. Add credits at https://platform.scriptivox.com/billing ($5 minimum, $0.20/hour billed per second)
4. Transcribe:

   curl -X POST https://api.scriptivox.com/v1/transcribe \\
     -H "Authorization: sk_live_YOUR_KEY" \\
     -H "Content-Type: application/json" \\
     -d '{"url": "https://example.com/audio.mp3", "language": "en", "diarize": true}'

5. Poll for results:

   curl https://api.scriptivox.com/v1/transcribe/TRANSCRIPTION_ID \\
     -H "Authorization: sk_live_YOUR_KEY"

6. When status is "completed", the \`result\` field contains the full transcript.

Recommended: always pass \`language\` explicitly when you know it. Auto-detect
works in most cases but has a small failure rate on short clips, code-switched
audio, or files starting with music.

Live status: https://status.scriptivox.com`,

  transcribe: `POST /v1/transcribe — Start Transcription
==================================================

Start a transcription from a URL or a previously uploaded file.

Request headers:
  Authorization: sk_live_YOUR_KEY    (or use 'x-api-key' header)
  Content-Type:  application/json    (required — non-JSON Content-Type returns 415)
  Idempotency-Key: <string>          (optional, up to 255 chars; safe-retry semantics)

Request body (JSON):
  url           string   (one of url/upload_id required)
                         Anonymously accessible URL to audio/video. An anon
                         HTTPS GET must return the raw file bytes — not an
                         HTML preview, login form, or password page. Direct
                         file URLs and presigned URLs (S3/GCS/Azure SAS)
                         always work. Cloud share links work only when set
                         to "Anyone with the link" without team restriction:
                         Google Drive, Dropbox files (not /scl/fo/ folders),
                         OneDrive /redir or onedrive.live.com. OneDrive
                         1drv.ms/v/c/ and 1drv.ms/p/c/ shares cannot be
                         transcribed (SharePoint Photos requires sign-in).
  upload_id     string   (one of url/upload_id required)
                         ID returned by POST /v1/upload.
  language      string   (optional, RECOMMENDED)
                         ISO 639-1 code (e.g. "en", "es", "fr", "ja", "hi").
                         119 languages supported. Pass this when known —
                         omitting triggers auto-detect, which has a small
                         failure rate on some edge cases.
  diarize       boolean  (optional, default false)
                         Identify who said what. When true, align is forced on.
  speaker_count integer  (optional, 1-50)
                         Expected speaker count. Requires diarize: true.
                         Passing this when known improves diarization accuracy.
  align         boolean  (optional, default true)
                         Word-level timestamps + confidence scores.
                         Forced true when diarize: true.
  webhook_url   string   (optional)
                         HTTPS URL where transcription.* events are POSTed.

Response (200):
  {
    "id": "uuid",
    "status": "created",
    "message": "Transcription created. The file will be downloaded and
                processed. Poll GET /v1/transcribe/{id} for status updates."
  }

  With Idempotency-Key on retry: same id returned, plus
  \`Idempotent-Replay: true\` response header.

Status progression: created → downloading → processing → completed | failed`,

  result: `GET /v1/transcribe/{id} — Get Transcription Result
==================================================

Poll this endpoint to check status and retrieve results.

Response (when completed):
  {
    "id": "uuid",
    "status": "completed",
    "audio_duration_seconds": 120,
    "file_size_bytes": 1572864,
    "language": "en",
    "diarize": false,
    "speaker_count": null,
    "align": true,
    "cost_cents": 0.6667,
    "created_at": "2026-05-19T20:15:30Z",
    "started_at":  "2026-05-19T20:15:32Z",
    "completed_at":"2026-05-19T20:16:08Z",
    "progress": "Transcription completed successfully.",
    "result": {
      "full_transcript": "Hello, thanks for joining...",
      "language": "en",
      "duration_seconds": 120,
      "speakers": ["SPEAKER 1", "SPEAKER 2"],
      "utterances": [
        {
          "start": 0.5,
          "end": 3.2,
          "text": "Hello, thanks for joining the call today.",
          "speaker": "SPEAKER 1",
          "confidence": 0.95,
          "words": [{ "word": "Hello,", "start": 0.5, "end": 0.9, "confidence": 0.98 }]
        }
      ]
    }
  }

Response (when failed):
  {
    "id": "uuid",
    "status": "failed",
    "completed_at": "2026-05-19T20:15:34Z",
    "error": { "code": "INVALID_MEDIA_FORMAT", "message": "..." }
  }

Format export — append ?format=srt | vtt | text to download captions:
  GET /v1/transcribe/{id}?format=srt   → SRT subtitle file
  GET /v1/transcribe/{id}?format=vtt   → WebVTT subtitle file
  GET /v1/transcribe/{id}?format=text  → plain text transcript

Segmentation knobs (query string): max_words, max_chars, max_duration,
sentence_aware, include_speakers, strip_chars.

Status values:
  created     — Job queued
  downloading — Fetching audio (URL flow)
  pending     — Awaiting duration probe (upload flow)
  processing  — Transcription in progress
  completed   — Result available
  failed      — See the error.code / error.message fields`,

  list: `GET /v1/transcriptions — List Transcriptions
==================================================

Returns the caller's transcription history with cursor-based pagination.
The result field is omitted from list view to keep responses small —
fetch the per-id GET to retrieve transcripts.

Query parameters:
  status   string   (optional)   Filter by status (e.g. "completed", "failed")
  from     string   (optional)   ISO 8601 timestamp lower bound (>=)
  to       string   (optional)   ISO 8601 timestamp upper bound (<)
  limit    integer  (optional)   Page size (max 200, default 50)
  cursor   string   (optional)   Opaque cursor from a previous response
  order    string   (optional)   "asc" or "desc" (default desc)

Response:
  {
    "items": [
      { "id": "...", "status": "completed", "audio_duration_seconds": 6, ... }
    ],
    "has_more": true,
    "next_cursor": "eyJ0Ijoi..."
  }`,

  cancel: `POST /v1/transcribe/{id}/cancel — Cancel Transcription
==================================================

Cancel a transcription that hasn't finished yet. Refunds any reserved
balance. Idempotent — calling again on an already-cancelled job returns
the same response. Calling on a \`completed\` job returns 409 CONFLICT.

Response (200):
  {
    "id": "uuid",
    "status": "failed",
    "error": { "code": "CANCELLED", "message": "Cancelled by customer" },
    "released_cents": 0.0167
  }`,

  delete: `DELETE /v1/transcribe/{id} — Delete Transcription
==================================================

Soft-delete a transcription record. Idempotent — DELETE on an already-
deleted record returns 204 again. DELETE on an in-flight (created /
downloading / processing) job returns 409 CONFLICT — cancel first.

Response: 204 No Content`,

  upload: `POST /v1/upload — Direct File Upload Flow
==================================================

Three-step flow for uploading a file from disk:

Step 1 — Request a presigned URL:
  POST /v1/upload  { "filename": "meeting.mp3" }
  →  {
       "upload_id":   "uuid",
       "upload_url":  "https://storage.supabase.co/...",
       "expires_in":  3600,
       "method":      "PUT",
       "headers":     { "Content-Type": "audio/mpeg" }
     }

Step 2 — PUT the file binary to upload_url:
  curl -X PUT "<upload_url>" \\
    -H "Content-Type: audio/mpeg" \\
    --data-binary @meeting.mp3

Step 3 — Start the transcription with upload_id:
  POST /v1/transcribe  { "upload_id": "<uuid>", "language": "en" }

Supported formats (25 total):
  Audio (10): MP3, WAV, M4A, AAC, OGG, FLAC, WMA, AIFF, Opus, CAF
  Video (15): MP4, MOV, AVI, MKV, WebM, WMV, FLV, M4V, 3GP, MPEG, MTS,
              OGV, TS, VOB, F4V

Limits:
  Min duration: 1 second
  Max duration: 10 hours
  Max file size: 5 GB
  Upload URL TTL: 1 hour`,

  balance: `GET /v1/balance — Check Credit Balance
==================================================

Response:
  {
    "balance_cents": 500,
    "reserved_cents": 20,
    "available_cents": 480,
    "price_per_hour_cents": 20,
    "estimated_hours_available": 24.0,
    "deposit_url": "https://platform.scriptivox.com/billing",
    "updated_at": "2026-05-19T20:15:30Z"
  }

Add credits at the deposit_url. Minimum deposit is $5.00.`,

  webhooks: `Webhooks — Async Event Delivery
==================================================

Set \`webhook_url\` when creating a transcription to receive callbacks.

Events delivered:
  transcription.processing  — GPU pipeline started
  transcription.completed   — Result ready
  transcription.failed      — Job hit a terminal error

Webhook payload (POST to your URL):
  {
    "event": "transcription.completed",
    "transcription_id": "uuid",
    "status": "completed",
    "duration_seconds": 120,
    "cost_cents": 0.6667
  }

  Or on failure:
  {
    "event": "transcription.failed",
    "transcription_id": "uuid",
    "status": "failed",
    "error": { "code": "INVALID_MEDIA_FORMAT", "message": "..." }
  }

Signature verification:
  Each request includes 'X-Scriptivox-Signature' and 'X-Scriptivox-Timestamp'.
  Signature = HMAC-SHA256(secret=SHA256(api_key), message="{timestamp}.{body}")
  Compare in constant time. Reject if the timestamp is more than 5 minutes old.

Delivery semantics:
  - Fire-and-forget. No retries.
  - One 3xx redirect is followed automatically (re-POST with same headers).
  - Webhooks timeout after 30 seconds.
  - Always poll GET /v1/transcribe/{id} as a fallback for reliability.
  - We monitor our own delivery health — internal alerts fire if no
    webhooks succeed for several hours.`,

  errors: `Error Codes
==================================================

All errors return:
  { "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }

Synchronous errors (returned on the request itself):
  400 INVALID_REQUEST             Missing/invalid body field
  400 INVALID_FILENAME            Filename rejected by safety rules
  400 INVALID_MEDIA_FORMAT        Unsupported file extension at upload
  400 FILE_NOT_UPLOADED           Upload PUT never happened
  400 FILE_TOO_LARGE              File exceeds 5 GB
  400 UPLOAD_ALREADY_USED         Upload already attached to a transcription
  400 UPLOAD_EXPIRED              Upload URL past expires_in (1 hour TTL)
  401 INVALID_API_KEY             Key malformed / missing
  401 API_KEY_REVOKED             Key was revoked
  402 ZERO_BALANCE                Account balance is $0
  402 INSUFFICIENT_BALANCE        Not enough balance for this audio length
  404 UPLOAD_NOT_FOUND            Upload ID doesn't exist
  404 TRANSCRIPTION_NOT_FOUND     Transcription ID doesn't exist
  404 NOT_FOUND                   Path doesn't match any endpoint
  405 METHOD_NOT_ALLOWED          Wrong HTTP method (Allow header sent)
  409 CONFLICT                    Cancel/delete not allowed in current state
  409 IDEMPOTENCY_KEY_LOCKED      Concurrent retry of the same key
  413 PAYLOAD_TOO_LARGE           Request body > 100 KB
  415 UNSUPPORTED_MEDIA_TYPE      Content-Type wasn't application/json
  422 IDEMPOTENCY_KEY_CONFLICT    Idempotency-Key reused with a different body
  429 RATE_LIMIT_EXCEEDED         Check Retry-After header
  500 INTERNAL_ERROR              Server-side error — safe to retry

Asynchronous errors (surface on GET /v1/transcribe/{id} after submission):
  URL_NOT_ACCESSIBLE              URL flow — fetch failed. Covers 4xx/5xx, DNS
                                  failure, connection refused, HTML response
                                  instead of media (login/preview/folder/expired),
                                  sign-in-required share (e.g. OneDrive 1drv.ms/v/c),
                                  or 200 with empty body. The 'message' field names
                                  the specific cause when detectable.
  DOWNLOAD_FAILED                 URL flow — download started but interrupted
  INVALID_MEDIA_FORMAT            ffprobe rejected the file, OR audio < 1 second
                                  (message names the actual measured duration)
  DURATION_TOO_LONG               Audio exceeds 10 hours
  PROCESSING_ERROR                GPU job failed after retries
  CREATED_TIMEOUT                 Job sat in 'created' >30 min
  DOWNLOAD_TIMEOUT                Job sat in 'downloading' >15 min
  PROCESSING_TIMEOUT              Job sat in 'processing' >45 min
  BILLING_ERROR                   Charge failed AFTER processing — balance NOT
                                  debited and transcript NOT delivered. Safe retry.
  INTERNAL_ERROR                  Server-side hiccup. Safe to retry.
  CANCELLED                       Cancelled by the customer

Rate limits (per API key, per minute):
  POST /v1/upload                60
  POST /v1/transcribe            60
  GET  /v1/transcribe/{id}       200  (lenient — for polling)
  POST /v1/transcribe/{id}/cancel 30
  DELETE /v1/transcribe/{id}     30
  GET  /v1/transcriptions        60
  GET  /v1/balance               100
  (per-IP edge limit)            300

Service health: https://status.scriptivox.com`,
};

export function getApiDocsText(section?: string): string {
  if (section && SECTIONS[section]) {
    return SECTIONS[section];
  }

  if (section === "all" || !section) {
    return Object.values(SECTIONS).join("\n\n\n");
  }

  const available = Object.keys(SECTIONS).join(", ");
  return `Unknown section "${section}". Available sections: ${available}, all`;
}
