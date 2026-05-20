/**
 * Scriptivox MCP server — STDIO integration test
 * ================================================
 *
 * Spawns the compiled `dist/index.js` as a real MCP subprocess over stdio,
 * sends JSON-RPC requests using the actual MCP protocol, and asserts the
 * wrapped responses. This is what every MCP client (Claude Desktop, Cursor,
 * etc.) does at runtime — so a green run here means the wire format is right.
 *
 * Distinct from scripts/smoke.ts, which invokes handler functions directly
 * and bypasses Zod schema validation, MCP envelope wrapping, and tool
 * registration. Smoke catches business-logic bugs; this catches transport
 * bugs.
 *
 * Run:  cd mcp-server && npx tsx scripts/integration.ts
 */

import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadApiKey(): string {
  const envPath = "/Users/arshnoorsingh/Desktop/scriptivox-fresh/.env.local";
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^SCRIPTIVOX_MAIN\s*=\s*(\S+)/);
    if (m) return m[1];
  }
  throw new Error("SCRIPTIVOX_MAIN not found in .env.local");
}

const API_KEY = loadApiKey();
const DIST_ENTRY = path.resolve("dist/index.js");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];

class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private buf = "";

  constructor() {
    this.proc = spawn("node", [DIST_ENTRY], {
      env: { ...process.env, SCRIPTIVOX_API_KEY: API_KEY },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding("utf-8");
    // Server logs to stderr — usually just the startup banner. Surface only on test failure.
    let stderrBuf = "";
    this.proc.stderr.on("data", (c: string) => { stderrBuf += c; });
    this.proc.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
    });
    this.proc.on("exit", (code) => {
      if (code !== null && code !== 0 && this.pending.size > 0) {
        for (const p of this.pending.values()) p.reject(new Error(`server exited ${code}\nstderr: ${stderrBuf}`));
      }
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try { msg = JSON.parse(line) as JsonRpcResponse; }
      catch { continue; }  // ignore non-JSON lines
      const handler = this.pending.get(msg.id);
      if (handler) {
        this.pending.delete(msg.id);
        handler.resolve(msg);
      }
    }
  }

  send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // 5-minute timeout per request — long enough for a real transcription.
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`request ${method} (id=${id}) timed out after 5min`));
        }
      }, 5 * 60_000);
      this.pending.get(id)!.resolve = (r) => { clearTimeout(timer); resolve(r); };
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    await new Promise((r) => setTimeout(r, 200));
    this.proc.kill();
  }
}

function check(name: string, passed: boolean, detail: string = "ok"): void {
  checks.push({ name, passed, detail });
  console.log(`  ${name.padEnd(55)}  ${passed ? "PASS" : "FAIL"}  ${passed ? "" : detail}`);
}

// MCP `tools/call` result has shape: { content: [...], isError?: boolean }
function getToolText(resp: JsonRpcResponse): string {
  const r = resp.result as { content?: Array<{ type: string; text?: string }> } | undefined;
  return r?.content?.[0]?.text || "";
}
function isToolError(resp: JsonRpcResponse): boolean {
  const r = resp.result as { isError?: boolean } | undefined;
  return r?.isError === true;
}

async function main() {
  console.log("================================================");
  console.log("  Scriptivox MCP — STDIO integration test (PROD)");
  console.log(`  Spawning: node ${DIST_ENTRY}`);
  console.log("================================================\n");

  const client = new McpClient();

  // 1. Initialize — every real MCP client sends this first.
  console.log("[ Phase 1 — MCP handshake ]");
  const init = await client.send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "scriptivox-mcp-integration-test", version: "0.0.1" },
  });
  check("initialize returns serverInfo + protocolVersion",
    !!(init.result as { serverInfo?: { name?: string }; protocolVersion?: string })?.serverInfo &&
    !!(init.result as { protocolVersion?: string })?.protocolVersion,
    `got: ${JSON.stringify(init.result).substring(0, 200)}`);
  const serverName = (init.result as { serverInfo?: { name?: string } })?.serverInfo?.name;
  check("serverInfo.name = 'scriptivox'", serverName === "scriptivox", `got: ${serverName}`);
  const serverVersion = (init.result as { serverInfo?: { version?: string } })?.serverInfo?.version;
  check("serverInfo.version = '1.1.0'", serverVersion === "1.1.0", `got: ${serverVersion}`);

  // 2. tools/list — exact set we expect
  console.log("\n[ Phase 2 — tools/list ]");
  const toolsResp = await client.send("tools/list");
  const tools = (toolsResp.result as { tools?: Array<{ name: string; description?: string }> })?.tools || [];
  const names = new Set(tools.map((t) => t.name));
  const expectedTools = [
    "get_supported_languages", "get_pricing", "get_product_info", "get_api_docs",
    "check_balance", "transcribe_url", "transcribe_status", "transcribe_upload",
    "transcribe_cancel", "transcribe_delete", "list_transcriptions", "export_transcript",
    // Legacy aliases — same handler as transcribe_url / transcribe_status, kept
    // for backward compat with @scriptivox/mcp-server@1.0.x users.
    "transcription_url", "transcription_status",
  ];
  check(`tools/list returns 14 tools (got ${tools.length})`, tools.length === 14, `tools: ${[...names].join(", ")}`);
  for (const t of expectedTools) {
    check(`tools/list includes '${t}'`, names.has(t), `missing from set: ${t}`);
  }
  // Legacy aliases should be clearly marked as deprecated in their description.
  for (const legacyName of ["transcription_url", "transcription_status"]) {
    const tool = tools.find((t) => t.name === legacyName);
    const desc = tool?.description || "";
    check(`${legacyName} description marks it as DEPRECATED`,
      desc.includes("DEPRECATED"),
      `description: ${desc.substring(0, 100)}`);
  }

  // 3. resources/list — exposed but optional
  console.log("\n[ Phase 3 — resources/list ]");
  try {
    const resResp = await client.send("resources/list");
    const resources = (resResp.result as { resources?: Array<{ uri: string; name?: string }> })?.resources || [];
    check(`resources/list returns >=3 resources (got ${resources.length})`, resources.length >= 3, `got: ${resources.length}`);
    const uris = resources.map((r) => r.uri).join(", ");
    check("resources include languages + pricing + api-docs",
      uris.includes("languages") && uris.includes("pricing") && uris.includes("api-docs"),
      `uris: ${uris}`);
  } catch (e) {
    check("resources/list works", false, e instanceof Error ? e.message : String(e));
  }

  // 4. prompts/list
  console.log("\n[ Phase 4 — prompts/list ]");
  try {
    const promptResp = await client.send("prompts/list");
    const prompts = (promptResp.result as { prompts?: Array<{ name: string }> })?.prompts || [];
    check(`prompts/list returns >=2 prompts (got ${prompts.length})`, prompts.length >= 2, `got: ${prompts.length}`);
    const promptNames = prompts.map((p) => p.name).join(", ");
    check("prompts include transcribe-audio + meeting-notes",
      promptNames.includes("transcribe-audio") && promptNames.includes("meeting-notes"),
      `names: ${promptNames}`);
  } catch (e) {
    check("prompts/list works", false, e instanceof Error ? e.message : String(e));
  }

  // 5. Static tool calls — proves the MCP envelope + Zod schemas work end-to-end
  console.log("\n[ Phase 5 — Static tool calls via MCP envelope ]");
  const pricing = await client.send("tools/call", {
    name: "get_pricing", arguments: {},
  });
  check("get_pricing returns content over the wire", getToolText(pricing).includes("$0.20 per hour"),
    `got: ${getToolText(pricing).substring(0, 100)}`);

  const langs = await client.send("tools/call", {
    name: "get_supported_languages", arguments: {},
  });
  check("get_supported_languages returns 119-language list", getToolText(langs).includes("119 languages"),
    `got: ${getToolText(langs).substring(0, 100)}`);

  const docs = await client.send("tools/call", {
    name: "get_api_docs", arguments: { section: "errors" },
  });
  check("get_api_docs(section='errors') returns UNSUPPORTED_MEDIA_TYPE",
    getToolText(docs).includes("UNSUPPORTED_MEDIA_TYPE"),
    `got: ${getToolText(docs).substring(0, 100)}`);

  // 6. Tool call with auth — proves env-var threading works
  console.log("\n[ Phase 6 — Auth tool call via MCP envelope ]");
  const bal = await client.send("tools/call", {
    name: "check_balance", arguments: {},
  });
  check("check_balance returns balance over the wire", getToolText(bal).includes("Balance"),
    `got: ${getToolText(bal).substring(0, 150)}`);

  // 6b. Legacy alias actually works — proves the deprecation path is correct.
  console.log("\n[ Phase 6b — Legacy alias delegates to current handler ]");
  const legacy = await client.send("tools/call", {
    name: "transcription_status", arguments: { transcription_id: "00000000-0000-0000-0000-000000000000" },
  });
  // We don't care that it 404s — that proves the request actually reached
  // the underlying handler (which then returned TRANSCRIPTION_NOT_FOUND).
  check("transcription_status (legacy alias) reaches handler over the wire",
    getToolText(legacy).includes("TRANSCRIPTION_NOT_FOUND"),
    `got: ${getToolText(legacy).substring(0, 100)}`);

  // 7. tool call with bad input — exercises Zod + handler error envelope
  console.log("\n[ Phase 7 — Error envelope for bad input ]");
  const bad = await client.send("tools/call", {
    name: "transcribe_status", arguments: { transcription_id: "not-a-uuid" },
  });
  check("transcribe_status(bad uuid) returns isError=true via MCP envelope",
    isToolError(bad) && getToolText(bad).includes("Invalid transcription ID format"),
    `isError=${isToolError(bad)} body=${getToolText(bad).substring(0, 100)}`);

  // 8. Resources/read — pull the languages resource end-to-end
  console.log("\n[ Phase 8 — resources/read ]");
  try {
    // Get a real URI from the list first
    const resResp = await client.send("resources/list");
    const resources = (resResp.result as { resources?: Array<{ uri: string }> })?.resources || [];
    const langRes = resources.find((r) => r.uri.includes("language"));
    if (langRes) {
      const readResp = await client.send("resources/read", { uri: langRes.uri });
      const contents = (readResp.result as { contents?: Array<{ text?: string }> })?.contents || [];
      const text = contents[0]?.text || "";
      check(`resources/read(${langRes.uri}) returns language list`,
        text.includes("119 languages"),
        `got: ${text.substring(0, 100)}`);
    } else {
      check("languages resource exists", false, "no language resource found in list");
    }
  } catch (e) {
    check("resources/read works", false, e instanceof Error ? e.message : String(e));
  }

  // 9. Live transcription via MCP envelope — proves the full pipeline works
  // through the wire protocol, not just direct handler invocation.
  console.log("\n[ Phase 9 — Live transcription via MCP envelope (JFK 11s) ]");
  const tx = await client.send("tools/call", {
    name: "transcribe_url",
    arguments: {
      url: "https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac",
      language: "en",
      diarize: false,
      align: true,
    },
  });
  check("transcribe_url via MCP returns completed transcript with real content",
    getToolText(tx).includes("Transcription Complete") && getToolText(tx).includes("ask not"),
    `got: ${getToolText(tx).substring(0, 200)}`);

  await client.close();

  console.log("\n================================================");
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;
  console.log(`  RESULT  ${passed} passed, ${failed} failed, ${checks.length} total`);
  console.log("================================================");
  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const c of checks.filter((x) => !x.passed)) {
      console.log(`  • ${c.name}: ${c.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Integration test runner crashed:", err);
  process.exit(2);
});
