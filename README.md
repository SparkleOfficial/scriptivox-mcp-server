# @scriptivox/mcp-server

MCP (Model Context Protocol) server for [Scriptivox](https://scriptivox.com) — AI-powered audio and video transcription.

Turn any AI assistant into a transcription powerhouse. Transcribe audio and video from URLs with 99% accuracy, speaker diarization, 98+ languages, and word-level timestamps.

<!-- mcp-name: com.scriptivox.www/transcription -->

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

### Docker

```bash
docker run -e SCRIPTIVOX_API_KEY=sk_live_YOUR_KEY sparkleofficialmain/scriptivox-mcp-server
```

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

### Discovery Tools (no API key required)

| Tool | Description |
|------|-------------|
| `get_supported_languages` | List all 98+ supported transcription languages |
| `get_pricing` | View plans and API pricing |
| `get_product_info` | Learn about Scriptivox capabilities |
| `get_api_docs` | API documentation and quickstart guide |

### Transcription Tools (API key required)

| Tool | Description |
|------|-------------|
| `transcription_url` | Transcribe audio/video from a URL — the main feature |
| `transcription_status` | Check status of a running transcription |
| `check_balance` | View your API credit balance |

## Usage Examples

Once connected, just ask your AI assistant:

- *"Transcribe this podcast: https://example.com/episode.mp3"*
- *"Transcribe this meeting recording with speaker identification"*
- *"What languages does Scriptivox support?"*
- *"How much does Scriptivox transcription cost?"*
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

## Pricing

- **Free plan**: 3 transcriptions/day, 30 min max
- **Pro plan**: $20/month — unlimited transcriptions
- **API**: $0.20/hour of audio (pay-as-you-go)

## Links

- [Scriptivox](https://scriptivox.com) — Main website
- [API Documentation](https://scriptivox.com/docs/api-reference) — Full API reference
- [Dashboard](https://platform.scriptivox.com) — Manage your account

## License

MIT
