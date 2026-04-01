const TOPICS: Record<string, string> = {
  transcription: `AI Transcription
==================================================
Scriptivox converts audio and video to text with 99% accuracy using
advanced AI models. Key capabilities:

  - 100+ languages with automatic language detection
  - Speaker diarization (identify who said what)
  - Word-level timestamps with confidence scores
  - Supports 30+ audio/video formats (MP3, WAV, MP4, MOV, MKV, etc.)
  - Google Drive, Dropbox, and OneDrive link support
  - Webhook notifications on completion
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

  Base URL: https://api.scriptivox.com/v1
  Auth: API key (sk_live_...) via Authorization header
  Pricing: $0.20/hour of audio

  Endpoints:
    POST /v1/upload      — Get presigned URL for file upload
    POST /v1/transcribe  — Start transcription (from URL or upload)
    GET  /v1/transcribe/:id — Get status and results
    GET  /v1/balance     — Check credit balance
    POST /v1/deposit     — Create checkout for credits

  Features:
    - URL-based transcription (no upload needed)
    - Speaker diarization
    - Word-level alignment
    - Webhook callbacks
    - Google Drive/Dropbox/OneDrive links

  API docs: https://scriptivox.com/docs/api-reference
  Dashboard: https://platform.scriptivox.com`,
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
