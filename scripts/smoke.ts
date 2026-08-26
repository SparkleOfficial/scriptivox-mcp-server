/**
 * Scriptivox MCP server — end-to-end smoke test
 * ================================================
 *
 * Invokes every tool handler directly (no MCP transport in the loop), against
 * the live prod API at api.scriptivox.com.
 *
 * Why prod: dev1 has stale data and the MCP server's prod-locked base URL
 * doesn't accept an override out of the box. Total cost burn for this run
 * is well under $0.01 (two short transcriptions @ ~30s each).
 *
 * ── Where the key comes from ────────────────────────────────────────────
 *
 * SCRIPTIVOX_API_KEY (or SCRIPTIVOX_MAIN) in the environment, falling back to
 * an .env file named by SCRIPTIVOX_ENV_FILE.
 *
 * This used to read one hardcoded absolute path on one contributor's laptop,
 * which meant `npm test` — and therefore `prepublishOnly` — failed for
 * everybody else, including CI. A publish gate that cannot run anywhere but
 * one machine is not a gate.
 *
 * Run:  cd mcp-server && npx tsx scripts/smoke.ts
 */

import { readFileSync, existsSync } from "node:fs";

// ─── Resolve the API key ─────────────────────────────────────────────────
function loadApiKey(): string {
  const direct = process.env.SCRIPTIVOX_API_KEY || process.env.SCRIPTIVOX_MAIN;
  if (direct) return direct;

  const envPath = process.env.SCRIPTIVOX_ENV_FILE;
  if (envPath && existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^(?:SCRIPTIVOX_MAIN|SCRIPTIVOX_API_KEY)\s*=\s*(\S+)/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }

  throw new Error(
    "No API key. Set SCRIPTIVOX_API_KEY (or SCRIPTIVOX_MAIN) in the environment, " +
      "or point SCRIPTIVOX_ENV_FILE at an .env file containing one.",
  );
}

const API_KEY = loadApiKey();
process.env.SCRIPTIVOX_API_KEY = API_KEY;

// ─── Import tool handlers ─────────────────────────────────────────────────
const { handleGetPricing } = await import("../src/tools/get-pricing.js");
const { handleGetLanguages } = await import("../src/tools/get-languages.js");
const { handleGetProductInfo } = await import("../src/tools/get-product-info.js");
const { handleGetApiDocs } = await import("../src/tools/get-api-docs.js");
const { handleCheckBalance } = await import("../src/tools/check-balance.js");
const { handleListTranscriptions } = await import("../src/tools/list-transcriptions.js");
const { handleTranscribeUrl } = await import("../src/tools/transcribe-url.js");
const { handleTranscribeStatus } = await import("../src/tools/transcribe-status.js");
const { handleTranscribeCancel } = await import("../src/tools/transcribe-cancel.js");
const { handleTranscribeDelete } = await import("../src/tools/transcribe-delete.js");
const { handleExportTranscript } = await import("../src/tools/export-transcript.js");
const { handleTranscribeUpload } = await import("../src/tools/transcribe-upload.js");

// ─── Runner ───────────────────────────────────────────────────────────────
type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

interface Check {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

const checks: Check[] = [];

async function run(
  name: string,
  fn: () => Promise<ToolResult> | ToolResult,
  validate: (r: ToolResult) => string | null,
): Promise<ToolResult> {
  const start = Date.now();
  let result: ToolResult;
  try {
    result = await fn();
  } catch (err) {
    const detail = `THREW: ${err instanceof Error ? err.message : String(err)}`;
    checks.push({ name, passed: false, detail, durationMs: Date.now() - start });
    console.log(`  ${name.padEnd(55)}  FAIL    ${detail}`);
    return { isError: true };
  }
  const err = validate(result);
  const durationMs = Date.now() - start;
  if (err) {
    checks.push({ name, passed: false, detail: err, durationMs });
    console.log(`  ${name.padEnd(55)}  FAIL    (${durationMs}ms) ${err}`);
  } else {
    checks.push({ name, passed: true, detail: "ok", durationMs });
    console.log(`  ${name.padEnd(55)}  PASS    (${durationMs}ms)`);
  }
  return result;
}

function bodyText(r: ToolResult): string {
  return r.content?.[0]?.text || "";
}
function extractUuid(r: ToolResult): string | null {
  const m = bodyText(r).match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  return m ? m[0] : null;
}

function expectContains(needle: string) {
  return (r: ToolResult): string | null => {
    if (r.isError) return `unexpected isError. body: ${bodyText(r).substring(0, 160)}`;
    return bodyText(r).includes(needle) ? null : `body missing "${needle}". got: ${bodyText(r).substring(0, 160)}`;
  };
}
function expectAllContain(needles: string[]) {
  return (r: ToolResult): string | null => {
    if (r.isError) return `unexpected isError. body: ${bodyText(r).substring(0, 160)}`;
    const body = bodyText(r);
    for (const n of needles) {
      if (!body.includes(n)) return `body missing "${n}". got: ${body.substring(0, 200)}`;
    }
    return null;
  };
}
function expectError(codeOrPhrase: string) {
  return (r: ToolResult): string | null => {
    if (!r.isError) return `expected isError, got success. body: ${bodyText(r).substring(0, 160)}`;
    return bodyText(r).includes(codeOrPhrase) ? null : `error body missing "${codeOrPhrase}". got: ${bodyText(r).substring(0, 160)}`;
  };
}

// ─── Test samples ─────────────────────────────────────────────────────────
// 11-second FLAC of JFK's inaugural address. OpenAI's canonical Whisper test
// fixture. Real speech, single speaker, clear English — exercises real
// transcription (not silence/music) so SRT/VTT output has actual content.
const SAMPLE_JFK = "https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac";
// 110-second OGG of a recorded interview with Randy Olson. Wikimedia Commons.
// Real multi-speaker conversation — exercises diarize + alignment with actual
// speaker turns and conversational pacing. ~$0.0061 per run.
const SAMPLE_INTERVIEW = "https://upload.wikimedia.org/wikipedia/commons/0/0b/A_conversation_with_Randy_Olson.ogg";
// Same JFK sample used for the cancel test — short enough that we can submit
// it, get the row created, then cancel before processing finishes.
const SAMPLE_CANCEL = SAMPLE_JFK;

// ─── Tests ────────────────────────────────────────────────────────────────
async function main() {
  console.log("================================================");
  console.log("  Scriptivox MCP Server — smoke test (PROD)");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Samples:`);
  console.log(`    JFK FLAC (11s, real speech, single speaker)`);
  console.log(`    Randy Olson interview OGG (110s, multi-speaker)`);
  console.log(`  Est. cost: ~$0.007`);
  console.log("================================================\n");

  console.log("[ Phase 1 — Static tools (no API call) ]");
  await run("get_pricing",                () => handleGetPricing(),         expectContains("$0.20 per hour"));
  await run("get_languages count = 119",  () => handleGetLanguages(),       expectContains("119 languages"));
  await run("get_languages includes 'kea'", () => handleGetLanguages(),     expectContains("kea"));
  await run("get_languages includes 'ny'",  () => handleGetLanguages(),     expectContains(" ny"));
  await run("get_product_info / transcription",   () => handleGetProductInfo({ topic: "transcription" }), expectContains("119 languages"));
  await run("get_product_info / audio-tools",     () => handleGetProductInfo({ topic: "audio-tools" }),   expectContains("Audio Tools"));
  await run("get_product_info / video-tools",     () => handleGetProductInfo({ topic: "video-tools" }),   expectContains("Video Tools"));
  await run("get_product_info / subtitle-tools",  () => handleGetProductInfo({ topic: "subtitle-tools" }), expectContains("Subtitle"));
  await run("get_product_info / meeting-bot",     () => handleGetProductInfo({ topic: "meeting-bot" }),   expectContains("Meeting Bot"));
  await run("get_product_info / api",     () => handleGetProductInfo({ topic: "api" }), expectAllContain([
    "api.scriptivox.com/v1",
    "/v1/transcriptions",
    "/v1/transcribe/{id}/cancel",
    "DELETE /v1/transcribe/{id}",
    "119 languages",
    "Idempotency-Key",
  ]));
  await run("get_product_info / all",     () => handleGetProductInfo({ topic: "all" }), expectAllContain([
    "Scriptivox API",
    "Audio Tools",
    "Video Tools",
    "Subtitle",
    "Meeting Bot",
  ]));
  await run("get_product_info / no topic (defaults to all)", () => handleGetProductInfo({}), expectContains("Scriptivox API"));
  await run("get_api_docs / quickstart",  () => handleGetApiDocs({ section: "quickstart" }), expectAllContain([
    "status.scriptivox.com",
    "always pass",
  ]));
  await run("get_api_docs / transcribe",  () => handleGetApiDocs({ section: "transcribe" }), expectAllContain([
    "Idempotency-Key",
    "language",
    "diarize",
    "Status progression",
  ]));
  await run("get_api_docs / result",      () => handleGetApiDocs({ section: "result" }), expectAllContain([
    "?format=srt",
    "error.code",
    "completed_at",
  ]));
  await run("get_api_docs / upload",      () => handleGetApiDocs({ section: "upload" }), expectAllContain([
    "Step 1",
    "Step 2",
    "Step 3",
    "5 GB",
    "1 second",  // min duration
  ]));
  await run("get_api_docs / balance",     () => handleGetApiDocs({ section: "balance" }), expectAllContain([
    "available_cents",
    "estimated_hours_available",
    "$5.00",
  ]));
  await run("get_api_docs / errors",      () => handleGetApiDocs({ section: "errors" }), expectAllContain([
    "UNSUPPORTED_MEDIA_TYPE",
    "IDEMPOTENCY_KEY_CONFLICT",
    "METHOD_NOT_ALLOWED",
    "CANCELLED",
  ]));
  await run("get_api_docs / cancel",      () => handleGetApiDocs({ section: "cancel" }), expectContains("CANCELLED"));
  await run("get_api_docs / delete",      () => handleGetApiDocs({ section: "delete" }), expectContains("CONFLICT"));
  await run("get_api_docs / list",        () => handleGetApiDocs({ section: "list" }),   expectContains("cursor"));
  await run("get_api_docs / webhooks",    () => handleGetApiDocs({ section: "webhooks" }), expectAllContain([
    "transcription.completed",
    "transcription.failed",
    "transcription.processing",
    "HMAC-SHA256",
  ]));
  // No-arg default is documented as 'quickstart' (LLM-friendly default).
  await run("get_api_docs / no section defaults to quickstart",
    () => handleGetApiDocs({}),
    expectAllContain(["Quickstart", "Sign up at"]));
  // Explicit "all" concatenates everything.
  await run("get_api_docs / all (concatenated)",
    () => handleGetApiDocs({ section: "all" }),
    expectAllContain([
      "Quickstart",
      "/v1/transcribe",
      "Error Codes",
    ]));

  console.log("\n[ Phase 2 — Read-only auth ]");
  await run("check_balance",              () => handleCheckBalance(),                expectContains("Balance"));
  await run("list_transcriptions limit=3", () => handleListTranscriptions({ limit: 3 }),     (r) => {
    if (r.isError) return `unexpected isError: ${bodyText(r).substring(0, 160)}`;
    const t = bodyText(r);
    if (!t.includes("Transcriptions") && !t.includes("No transcriptions")) return `unexpected list output: ${t.substring(0, 160)}`;
    return null;
  });
  await run("list_transcriptions status=completed", () => handleListTranscriptions({ status: "completed", limit: 1 }), (r) => {
    if (r.isError) return `unexpected isError: ${bodyText(r).substring(0, 160)}`;
    return null;
  });

  console.log("\n[ Phase 3 — Full transcription happy path (JFK 11s real speech) ]");
  const idemKey = `mcp-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const happy = await run("transcribe_url JFK 11s FLAC (language=en, align=true)", () => handleTranscribeUrl({
    url: SAMPLE_JFK,
    language: "en",
    diarize: false,
    align: true,
    idempotency_key: idemKey,
  }), expectAllContain([
    "Transcription Complete",
    "Transcription ID:",
    "Language:",
    "Duration:",
    "Cost:",
    "ask not",  // The famous JFK line. Verifies the transcript actually contains real speech.
  ]));
  const completedId = extractUuid(happy);
  if (completedId) console.log(`    completed_id = ${completedId}`);

  if (completedId) {
    await run("transcribe_status on completed id", () => handleTranscribeStatus({ transcription_id: completedId }), expectContains("completed"));
    // SRT exports contain real timestamps and transcript content (not just headers)
    await run("export_transcript SRT contains timestamps + text", () => handleExportTranscript({ transcription_id: completedId, format: "srt" }), expectAllContain([
      "00:00:",
      "ask not",  // real content, not silence
      "Format: SRT",
    ]));
    await run("export_transcript VTT", () => handleExportTranscript({ transcription_id: completedId, format: "vtt" }), expectAllContain([
      "WEBVTT",
      "Format: VTT",
      "ask not",
    ]));
    await run("export_transcript text", () => handleExportTranscript({ transcription_id: completedId, format: "text" }), expectAllContain([
      "Format: TEXT",
      "ask not",
    ]));
    // Segmentation knob exercise
    await run("export SRT with max_words=2", () => handleExportTranscript({
      transcription_id: completedId, format: "srt", max_words: 2,
    }), expectContains("Format: SRT"));

    // Idempotency replay (same key + same body → same id)
    const replay = await run("idempotency replay returns same id", () => handleTranscribeUrl({
      url: SAMPLE_JFK,
      language: "en",
      diarize: false,
      align: true,
      idempotency_key: idemKey,
    }), expectContains("Transcription Complete"));

    // Idempotency conflict (same key + DIFFERENT body → 422 IDEMPOTENCY_KEY_CONFLICT)
    await run("idempotency conflict surfaces 422", () => handleTranscribeUrl({
      url: SAMPLE_JFK,
      language: "es",  // different language = different body hash
      diarize: false,
      align: true,
      idempotency_key: idemKey,  // same key as the prior call
    }), expectError("IDEMPOTENCY_KEY_CONFLICT"));
    const replayId = extractUuid(replay);
    if (replayId !== completedId) {
      checks.push({ name: "idempotency replay id matches", passed: false, detail: `expected ${completedId}, got ${replayId}`, durationMs: 0 });
      console.log(`  idempotency replay id matches                           FAIL   expected ${completedId}, got ${replayId}`);
    } else {
      checks.push({ name: "idempotency replay id matches", passed: true, detail: "ok", durationMs: 0 });
      console.log(`  idempotency replay id matches                           PASS`);
    }
  }

  console.log("\n[ Phase 4 — Diarization + alignment on real multi-speaker interview (110s) ]");
  const diar = await run("transcribe_url Randy Olson 110s w/ diarize=true", () => handleTranscribeUrl({
    url: SAMPLE_INTERVIEW,
    language: "en",
    diarize: true,
    align: true,  // server forces this anyway when diarize=true, but explicit
  }), (r) => {
    if (r.isError) return `unexpected isError: ${bodyText(r).substring(0, 200)}`;
    const t = bodyText(r);
    if (!t.includes("Transcription Complete")) return `no completion: ${t.substring(0, 200)}`;
    // Speakers line should be present when diarize works on real conversation
    if (!t.includes("Speakers:")) {
      return `expected "Speakers:" line in output (diarize=true). got: ${t.substring(0, 400)}`;
    }
    return null;
  });
  const diarId = extractUuid(diar);
  if (diarId) console.log(`    diarize_id = ${diarId}`);

  if (diarId) {
    // include_speakers='true' forces speaker labels in caption output
    await run("export VTT with include_speakers='true'", () => handleExportTranscript({
      transcription_id: diarId,
      format: "vtt",
      include_speakers: "true",
    }), expectContains("Format: VTT"));
  }

  console.log("\n[ Phase 5 — Cancel + Delete flow ]");
  // Submit a job + immediately cancel before it completes
  const submitted = await run("transcribe_url await_completed=false (for cancel test)", () => handleTranscribeUrl({
    url: SAMPLE_CANCEL,
    language: "en",
    await_completed: false,
  }), expectContains("Transcription accepted"));
  const cancelId = extractUuid(submitted);

  if (cancelId) {
    console.log(`    cancel_id = ${cancelId}`);
    await run("transcribe_cancel happy path",          () => handleTranscribeCancel({ transcription_id: cancelId }), expectContains("cancelled"));
    await run("transcribe_cancel idempotent re-call",  () => handleTranscribeCancel({ transcription_id: cancelId }), expectContains("cancelled"));
    await run("transcribe_delete on cancelled job",    () => handleTranscribeDelete({ transcription_id: cancelId }), expectContains("deleted"));
    await run("transcribe_delete idempotent re-call",  () => handleTranscribeDelete({ transcription_id: cancelId }), expectContains("deleted"));
    await run("GET on deleted id → 404",               () => handleTranscribeStatus({ transcription_id: cancelId }), expectError("TRANSCRIPTION_NOT_FOUND"));
  }

  console.log("\n[ Phase 6 — Upload flow (local file) ]");
  // 21-second MP3 from user's Downloads — small enough to upload quickly,
  // long enough to exercise the real transcription pipeline.
  const LOCAL_AUDIO = `${process.env.HOME}/Downloads/00091245-AUDIO-2025-01-07-18-54-06.mp3`;
  const uploaded = await run("transcribe_upload local 21s MP3", () => handleTranscribeUpload({
    file_path: LOCAL_AUDIO,
    language: "en",
    diarize: false,
    align: true,
  }), expectAllContain([
    "Transcription Complete",
    "Transcription ID:",  // wait — actually transcribe-upload formatter shows it
    "Cost:",
  ]));
  const uploadId = extractUuid(uploaded);
  if (uploadId) console.log(`    upload_id = ${uploadId}`);
  await run("transcribe_upload with non-absolute path",   () => handleTranscribeUpload({ file_path: "relative/path.mp3" }), expectError("absolute path"));
  await run("transcribe_upload with nonexistent file",    () => handleTranscribeUpload({ file_path: "/tmp/this-file-does-not-exist-xxx.mp3" }), expectError("Cannot read file"));

  console.log("\n[ Phase 7 — Negative cases ]");
  await run("transcribe_status with garbage uuid",    () => handleTranscribeStatus({ transcription_id: "not-a-uuid" }), expectError("Invalid transcription ID format"));
  await run("transcribe_cancel with garbage uuid",    () => handleTranscribeCancel({ transcription_id: "not-a-uuid" }), expectError("Invalid transcription ID format"));
  await run("transcribe_delete with garbage uuid",    () => handleTranscribeDelete({ transcription_id: "not-a-uuid" }), expectError("Invalid transcription ID format"));
  await run("export_transcript with garbage uuid",    () => handleExportTranscript({ transcription_id: "not-a-uuid", format: "srt" }), expectError("Invalid transcription ID format"));
  await run("transcribe_url with non-http URL",       () => handleTranscribeUrl({ url: "ftp://bad/file.mp3" }), expectError("Only http://"));
  await run("transcribe_status on unknown uuid → 404", () => handleTranscribeStatus({ transcription_id: "00000000-0000-0000-0000-000000000000" }), expectError("TRANSCRIPTION_NOT_FOUND"));
  await run("transcribe_url with invalid language code", () => handleTranscribeUrl({ url: SAMPLE_JFK, language: "xxxxx" }), expectError("Invalid language"));

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
  console.error("Smoke test runner crashed:", err);
  process.exit(2);
});
