import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_BASE_URL = "https://api.scriptivox.com/v1";

// Server version, read from package.json at runtime so it can never drift from
// what npm publishes. package.json sits one level up from this file in both the
// source tree (src/) and the compiled output (dist/) — and inside the installed
// npm package — so "../package.json" resolves correctly in every case.
function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

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

1. Sign up at https://platform.scriptivox.com
2. Go to https://platform.scriptivox.com/keys and create an API key
3. Add credits at https://platform.scriptivox.com/billing ($5 minimum — $0.20/hour of audio)
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
