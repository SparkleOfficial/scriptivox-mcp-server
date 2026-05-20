const TOPICS: Record<string, string> = {
  transcription: `AI Transcription
==================================================
Scriptivox converts audio and video to text with 99% accuracy using
advanced AI models. Key capabilities:

  - 119 languages with automatic language detection (passing the language explicitly is recommended for best accuracy)
  - Speaker diarization (identify who said what)
  - Word-level timestamps with confidence scores (on by default)
  - 25 audio/video formats: 10 audio (MP3, WAV, M4A, AAC, OGG, FLAC, WMA, AIFF, Opus, CAF) + 15 video (MP4, MOV, AVI, MKV, WebM, WMV, FLV, M4V, 3GP, MPEG, MTS, OGV, TS, VOB, F4V)
  - Google Drive, Dropbox, and OneDrive link support
  - Webhook notifications on completion (HMAC-signed payloads)
  - Idempotency-Key support for safe retries
  - Service status: https://status.scriptivox.com
  - Processing time: typically 1/4 of audio duration

Use cases: podcast transcription, meeting notes, interview analysis,
content creation, accessibility compliance, legal depositions,
medical dictation, lecture notes.

Get started: https://scriptivox.com`,

  "audio-tools": `Audio Tools
==================================================
Scriptivox provides a suite of browser-based audio processing tools:

  Audio Converter — Convert between 13+ formats
    MP3, WAV, FLAC, M4A, OGG, OPUS, AAC, AIFF, CAF, ALAC, WMA, WebM, 3GP

  Audio Trimmer — Cut and trim audio with visual waveform editor
    Precision start/end selection, fade in/out, preview before export

  Audio Joiner — Merge multiple audio files
    Combine files seamlessly with crossfade support

All tools are free to use at: https://scriptivox.com/tools`,

  "video-tools": `Video Tools
==================================================
  Video Converter — Convert between video formats
    MP4, MOV, MKV, WebM, AVI, WMV, VOB, and more

  Video to Audio — Extract audio track from any video file

All tools are free to use at: https://scriptivox.com/tools`,

  "subtitle-tools": `Subtitle Tools
==================================================
  Subtitle Editor — Visual timeline editor for subtitle files
    Edit timing, text, and styling with real-time preview
    Supports SRT, VTT, ASS, SSA formats

  Subtitle Converter — Convert between subtitle formats
    SRT ↔ VTT ↔ ASS ↔ SSA

  Subtitle Time Shift — Adjust all timestamps by an offset
    Fix sync issues with a single operation

  Subtitle Translator — Translate subtitles to other languages

All tools are free to use at: https://scriptivox.com/tools`,

  "meeting-bot": `Meeting Bot
==================================================
Scriptivox can join your online meetings and transcribe them automatically.

  Supported platforms:
    - Zoom
    - Google Meet
    - Microsoft Teams

  How it works:
    1. Paste your meeting URL
    2. The bot joins the meeting and records
    3. Get a full transcript with speaker identification when the meeting ends

  Included with Pro plan (600 minutes/month).

Get started: https://scriptivox.com`,

  api: `Scriptivox API
==================================================
RESTful API for programmatic transcription at scale.

  Base URL:   https://api.scriptivox.com/v1
  Auth:       API key (sk_live_...) via 'Authorization' header (Bearer prefix optional)
              or 'x-api-key' header
  Pricing:    $0.20/hour of audio, billed per second
  Min deposit: $5.00 (~25 hours of audio)

  Endpoints:
    POST   /v1/upload              — Request presigned URL for direct file upload
    POST   /v1/transcribe          — Start transcription (from URL or upload_id)
    GET    /v1/transcribe/{id}     — Get status / result (supports ?format=srt|vtt|text)
    POST   /v1/transcribe/{id}/cancel — Cancel an in-flight transcription
    DELETE /v1/transcribe/{id}     — Soft-delete a transcription record
    GET    /v1/transcriptions      — List with status / from / to / limit / cursor filters
    GET    /v1/balance             — Check credit balance + estimated hours

  Features:
    - URL-based transcription (no upload needed) + direct file upload flow
    - 119 languages
    - Speaker diarization with optional speaker_count hint
    - Word-level alignment (on by default; opt out with align: false)
    - Webhook callbacks (HMAC-signed payloads, no retries)
    - Idempotency-Key header for safe retries
    - Caption/transcript export in SRT, VTT, or plain text with segmentation knobs
    - Google Drive, Dropbox, OneDrive sharing links + direct file URLs

  Service health: https://status.scriptivox.com
  API docs:       https://scriptivox.com/docs/api-reference
  Dashboard:      https://platform.scriptivox.com`,
};

export function getProductInfoText(topic?: string): string {
  if (topic && TOPICS[topic]) {
    return TOPICS[topic];
  }

  if (topic === "all" || !topic) {
    return Object.values(TOPICS).join("\n\n\n");
  }

  const available = Object.keys(TOPICS).join(", ");
  return `Unknown topic "${topic}". Available topics: ${available}, all`;
}
