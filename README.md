# @scriptivox/mcp-server

MCP (Model Context Protocol) server for [Scriptivox](https://scriptivox.com) — AI-powered audio and video transcription.

Turn any AI assistant into a transcription powerhouse. Transcribe audio and video from URLs or local files with 99% accuracy, speaker diarization, **119 languages**, and word-level timestamps. Plus full CRUD on transcriptions (cancel, delete, list) and caption export in SRT / WebVTT / plain text.

## Quick Start

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scriptivox": {
      "command": "npx",
      "args": ["-y", "@scriptivox/mcp-server"],
      "env": {
        "SCRIPTIVOX_API_KEY": "sk_live_YOUR_KEY"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add scriptivox -- npx -y @scriptivox/mcp-server
```

Then set the environment variable `SCRIPTIVOX_API_KEY=sk_live_YOUR_KEY`.

### Other MCP Clients

Any MCP-compatible client can use this server via stdio transport:

```bash
SCRIPTIVOX_API_KEY=sk_live_YOUR_KEY npx -y @scriptivox/mcp-server
```

## Getting an API Key

1. Sign up at [scriptivox.com](https://scriptivox.com)
2. Go to **Dashboard > API**
3. Create an API key
4. Add credits ($5 minimum — API pricing is $0.20/hour of audio)

## Tools

### Discovery tools (no API key required)

| Tool | Description |
|------|-------------|
| `get_supported_languages` | List all 119 supported transcription languages with ISO codes |
| `get_pricing` | View plans, API pricing, and per-file limits |
| `get_product_info` | Learn about Scriptivox features (`transcription`, `audio-tools`, `video-tools`, `subtitle-tools`, `meeting-bot`, `api`, `all`) |
| `get_api_docs` | API documentation sections (`quickstart`, `transcribe`, `result`, `list`, `cancel`, `delete`, `upload`, `balance`, `webhooks`, `errors`, `all`) |

### Transcription tools (API key required)

| Tool | Description |
|------|-------------|
| `transcribe_url` | Transcribe audio/video from a public URL (Google Drive, Dropbox, OneDrive, or direct file URLs). Supports `language`, `diarize`, `speaker_count`, `align`, `webhook_url`, `idempotency_key`, `await_completed`. |
| `transcribe_upload` | Transcribe a LOCAL file. Drives the 3-step upload flow internally. Up to 5 GB. |
| `transcribe_status` | Check the status of a transcription by ID. Returns the full transcript when completed. |
| `transcribe_cancel` | Cancel an in-flight transcription. Refunds reserved balance. Idempotent. |
| `transcribe_delete` | Soft-delete a transcription record. Idempotent. Refuses to delete in-flight jobs. |
| `list_transcriptions` | List recent transcriptions with `status`, `from`, `to`, `limit`, `cursor`, `order` filters. |
| `export_transcript` | Export a completed transcript as SRT subtitles, WebVTT subtitles, or plain text. Segmentation knobs: `max_words`, `max_chars`, `max_duration`, `sentence_aware`, `include_speakers`, `strip_chars`. |
| `check_balance` | View your API credit balance and estimated hours available. |

### Tip: always pass `language` when you know it

Auto-detection works in most cases but has a small failure rate on short clips, code-switched audio, or files starting with music. Passing the ISO code is both faster and more accurate.

## Usage examples

Once connected, ask your AI assistant:

- *"Transcribe this podcast: https://example.com/episode.mp3 — it's in English"*
- *"Transcribe ~/Downloads/meeting.m4a with speaker identification"*
- *"Show me my last 5 transcriptions"*
- *"Cancel transcription abc123-…"*
- *"Export transcription abc123-… as SRT subtitles, 2 words per caption"*
- *"What languages does Scriptivox support?"*
- *"Check my Scriptivox balance"*

## Resources

The server exposes these MCP resources for AI assistants to read:

- `scriptivox://pricing` — Plans and rates
- `scriptivox://languages` — Supported languages
- `scriptivox://api-docs` — API reference

## Prompts

- `transcribe-audio` — Pre-built prompt for URL transcription
- `meeting-notes` — Transcribe a meeting and generate structured notes

## Configuration

| Environment Variable | Description | Required |
|---------------------|-------------|----------|
| `SCRIPTIVOX_API_KEY` | Your API key (`sk_live_...`) | For transcription tools |
| `SCRIPTIVOX_API_URL` | Custom API base URL | No (defaults to production) |

## Pricing

- **Free plan**: 3 transcriptions/day, 30 min max
- **Pro plan**: $20/month — unlimited transcriptions
- **API**: $0.20/hour of audio (pay-as-you-go)

## Links

- [Scriptivox](https://scriptivox.com) — Main website
- [API Documentation](https://scriptivox.com/docs/api-reference) — Full API reference
- [Dashboard](https://platform.scriptivox.com) — Manage your account
- [Smithery](https://smithery.ai) — MCP server registry

## License

MIT
