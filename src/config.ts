const API_BASE_URL = "https://api.scriptivox.com/v1";

export const CONFIG = {
  apiBaseUrl: API_BASE_URL,
  apiKey: process.env.SCRIPTIVOX_API_KEY || "",
  pollIntervalMs: 5000,
  pollInitialDelayMs: 3000,
  pollTimeoutMs: 600000, // 10 minutes
};

export function hasApiKey(): boolean {
  return CONFIG.apiKey.length > 0;
}

export const NO_API_KEY_MESSAGE = `No Scriptivox API key configured.

To transcribe audio and video, you need a Scriptivox API key:

1. Sign up at https://scriptivox.com
2. Go to Dashboard > API and create an API key
3. Add credits ($5 minimum — $0.20/hour of audio)
4. Set the SCRIPTIVOX_API_KEY environment variable in your MCP client config:

   {
     "mcpServers": {
       "scriptivox": {
         "command": "npx",
         "args": ["-y", "@scriptivox/mcp-server"],
         "env": { "SCRIPTIVOX_API_KEY": "sk_live_YOUR_KEY" }
       }
     }
   }`;
