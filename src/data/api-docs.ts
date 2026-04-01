const SECTIONS: Record<string, string> = {
  quickstart: `Scriptivox API — Quickstart
==================================================

1. Sign up at https://scriptivox.com and go to Dashboard > API
2. Create an API key (starts with sk_live_)
3. Add credits ($5 minimum, $0.20/hour of audio)
4. Transcribe:

   curl -X POST https://api.scriptivox.com/v1/transcribe \\
     -H "Authorization: sk_live_YOUR_KEY" \\
     -H "Content-Type: application/json" \\
     -d '{"url": "https://example.com/audio.mp3", "diarize": true}'

5. Poll for results:

   curl https://api.scriptivox.com/v1/transcribe/TRANSCRIPTION_ID \\
     -H "Authorization: sk_live_YOUR_KEY"

6. When status is "completed", the result field contains the full transcript.`,

  transcribe: `POST /v1/transcribe — Start Transcription
==================================================

Start a transcription from a URL or a previously uploaded file.

Request body (JSON):
  url           string   (required*)  Public URL to audio/video file.
                                      Supports Google Drive, Dropbox, OneDrive links.
  upload_id     string   (required*)  Upload ID from POST /v1/upload.
                                      * Exactly one of url or upload_id is required.
  language      string   (optional)   ISO 639-1 code (e.g. "en", "es", "fr").
                                      Omit for auto-detection.
  diarize       boolean  (optional)   Enable speaker diarization. Default: false.
  speaker_count integer  (optional)   Expected speakers (1-50). Requires diarize: true.
  align         boolean  (optional)   Word-level timestamps. Default: false.
  webhook_url   string   (optional)   URL to receive completion webhook.

Response:
  {
    "id": "uuid",
    "status": "created",
    "message": "Transcription created. Poll GET /v1/transcribe/{id} for updates."
  }

Status progression: created → downloading → processing → completed | failed`,

  result: `GET /v1/transcribe/:id — Get Transcription Result
==================================================

Poll this endpoint to check status and retrieve results.

Response (when completed):
  {
    "id": "uuid",
    "status": "completed",
    "audio_duration_seconds": 120,
    "language": "en",
    "cost_cents": 0.5,
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

Status values:
  created     — Job queued
  downloading — File being fetched from URL
  processing  — Transcription in progress
  completed   — Result available
  failed      — Error occurred (check error_code and error_message)`,

  upload: `POST /v1/upload — Upload a File
==================================================

Get a presigned URL for direct file upload to cloud storage.

Request body (JSON):
  filename   string  (required)  File name with extension (e.g. "meeting.mp3")

Response:
  {
    "upload_id": "uuid",
    "upload_url": "https://storage.supabase.co/...",
    "expires_in": 3600,
    "method": "PUT",
    "headers": { "Content-Type": "audio/mpeg" }
  }

Then PUT the file binary to upload_url with the provided headers.
After upload completes, use the upload_id with POST /v1/transcribe.

Supported formats: MP3, WAV, M4A, MP4, MOV, WebM, FLAC, AAC, OGG,
                   OPUS, AIFF, WMA, WMV, AVI, MKV, 3GP`,

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
    "updated_at": "2025-01-15T10:30:00Z"
  }

Add credits via the deposit_url or POST /v1/deposit.`,

  webhooks: `Webhooks
==================================================

Set webhook_url when creating a transcription to receive a callback
when the job completes or fails.

Webhook payload (POST to your URL):
  {
    "event": "transcription.completed",
    "transcription_id": "uuid",
    "status": "completed",
    "result": { ... full result object ... }
  }

  Or on failure:
  {
    "event": "transcription.failed",
    "transcription_id": "uuid",
    "status": "failed",
    "error_code": "PROCESSING_FAILED",
    "error_message": "..."
  }

HTTPS URLs are recommended. Webhooks timeout after 30 seconds.`,

  errors: `Error Codes
==================================================

All errors return:
  { "error": { "code": "ERROR_CODE", "message": "Human readable message" } }

Common codes:
  INVALID_API_KEY         — Key doesn't exist or is malformed
  API_KEY_REVOKED         — Key has been revoked
  INVALID_REQUEST         — Missing or invalid parameters
  RATE_LIMIT_EXCEEDED     — Too many requests (check Retry-After header)
  ZERO_BALANCE            — No credits available
  INSUFFICIENT_BALANCE    — Not enough credits for this file
  TRANSCRIPTION_NOT_FOUND — Invalid transcription ID
  FILE_TOO_LARGE          — File exceeds size limit
  UNSUPPORTED_FORMAT      — File type not supported
  URL_NOT_ACCESSIBLE      — Cannot download from the provided URL
  PROCESSING_FAILED       — Internal processing error`,
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
