import { functionsBaseFrom } from "../config.js";
import {
  type ToolResult,
  SITE,
  text,
  json,
  callFunction,
  postgrest,
  signStorageObject,
  upstreamError,
  withToken,
  userIdFromToken,
  str,
  strList,
  inList,
} from "./user-client.js";

/**
 * Everything a person does with a transcript AFTER it exists.
 *
 * Mirrors the hosted implementation in the main repo
 * (src/lib/mcp/libraryTools.ts) and calls the SAME endpoints with the same
 * shapes and the same wording, so an agent that learns one surface is not
 * surprised by the other.
 *
 * ── The boundary these tools sit inside ─────────────────────────────────────
 *
 * NOTHING here can create transcription work. Web plans include unlimited
 * transcription and are priced for one human at a keyboard, so metered,
 * agent-driven transcription belongs on the API — which the API-key tools
 * already cover. Organising, summarising and downloading all consume something
 * already paid for, which is why they are safe on a web credential. The one
 * deliberate exception lives in ./meetings.ts and is rate-limited for exactly
 * this reason.
 *
 * ── Bulk is the point, and bulk has a ceiling ───────────────────────────────
 *
 * "File these forty interviews under Q3" is the task these exist for, so they
 * take lists. Each names its own limit and refuses past it rather than silently
 * truncating: a truncated batch reads as success, and the agent never learns
 * the other thirty were skipped.
 */

const MAX_TAG_BATCH = 10;
const MAX_MOVE_BATCH = 50;
const AUDIO_URL_TTL_S = 60 * 60;
/** transcript-chat streams; this bounds how long one tool call will read it. */
const CHAT_BUDGET_MS = 120_000;

// ─── Finding things ──────────────────────────────────────────────────────────

export const searchTranscriptsDefinition = {
  name: "search_transcripts",
  description:
    "Find transcripts in the signed-in person's library, filtered by folder, tag, workspace, " +
    "status or filename, newest first. This is where the transcription ids that " +
    "tag_transcriptions, move_to_folder, generate_summary, get_transcript_audio, " +
    "chat_with_transcript and run_automation need come from — start here. NOT the same as " +
    "list_transcriptions, which takes an API key and lists metered API jobs instead. Read-only. " +
    "Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Match against the original filename." },
      tag: { type: "string", description: "Only transcripts carrying this exact tag." },
      folder_id: {
        type: ["string", "null"],
        description: "Only transcripts in this folder, or null for those in no folder.",
      },
      workspace_id: { type: "string", description: "Restrict to one workspace." },
      status: {
        type: "string",
        enum: ["uploading", "pending", "processing", "completed", "failed"],
        description: 'Filter by status. Most tools here need "completed".',
      },
      limit: { type: "number", description: "Rows to return, 1-200. Default 50." },
      offset: { type: "number", description: "Rows to skip — pass next_offset from a previous call." },
    },
  },
};

/**
 * The tool everything else in this file depends on.
 *
 * tag_transcriptions, move_to_folder, generate_summary, get_transcript_audio,
 * chat_with_transcript and run_automation all take transcription ids, and
 * without this there was no way on a user token to LEARN one.
 * `list_transcriptions` is not that tool: it reads SCRIPTIVOX_API_KEY and lists
 * jobs submitted through the metered API, which is a different set from the
 * person's web library.
 */
export async function handleSearchTranscripts(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = args.limit === undefined ? 50 : Math.floor(Number(args.limit));
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    return text("`limit` must be a whole number between 1 and 200.", true);
  }
  const offset = args.offset === undefined ? 0 : Math.floor(Number(args.offset));
  if (!Number.isFinite(offset) || offset < 0) {
    return text("`offset` must be zero or a positive whole number.", true);
  }

  const filters: string[] = [
    "select=id,original_filename,status,duration_seconds,language,tags,folder_id,workspace_id," +
      "created_at,completed_at,share_token",
    "deleted_at=is.null",
    "order=created_at.desc",
    `limit=${limit}`,
    `offset=${offset}`,
  ];

  const status = str(args, "status");
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);

  const folderRaw = args.folder_id;
  if (folderRaw === null) filters.push("folder_id=is.null");
  else if (typeof folderRaw === "string" && folderRaw.trim()) {
    filters.push(`folder_id=eq.${encodeURIComponent(folderRaw.trim())}`);
  }

  const workspaceId = str(args, "workspace_id");
  if (workspaceId) filters.push(`workspace_id=eq.${encodeURIComponent(workspaceId)}`);

  // `tags` is a text[]; `cs` is "contains", and the literal needs PostgREST's
  // brace form rather than the parenthesis form used for scalar columns.
  const tag = str(args, "tag");
  if (tag) filters.push(`tags=cs.${encodeURIComponent(`{"${tag.replace(/"/g, '\\"')}"}`)}`);

  // `*` is PostgREST's ilike wildcard, and `,` / `.` inside the value would be
  // read as syntax, so they are dropped rather than escaped.
  const query = str(args, "query");
  if (query) {
    const safe = query.replace(/[,.*()]/g, " ").trim();
    if (safe) filters.push(`original_filename=ilike.*${encodeURIComponent(safe)}*`);
  }

  return withToken(async (token, issuer) => {
    const { ok, status: httpStatus, data } = await postgrest(
      token,
      issuer,
      `/transcriptions?${filters.join("&")}`,
    );
    if (!ok) return upstreamError("Searching transcripts", httpStatus, data);

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return text(
        "No transcripts matched." +
          (status || tag || query || workspaceId || folderRaw !== undefined
            ? " Try loosening the filters — list_folders, list_tags and list_workspaces show what exists."
            : " This account has no transcripts yet."),
      );
    }

    return json({
      transcripts: rows,
      returned: rows.length,
      // No total count: an exact count costs a second scan, and the honest
      // signal an agent needs is "there may be more", not a number.
      more_may_exist: rows.length === limit,
      next_offset: rows.length === limit ? offset + limit : null,
    });
  });
}

// ─── Organising: read ────────────────────────────────────────────────────────

export const listTagsDefinition = {
  name: "list_tags",
  description:
    "List the tags on the signed-in person's account: the ones actually in use on transcriptions " +
    "with a count of each, and separately the named-tag registry the web app maintains. The two " +
    "are not kept in step by the product, so both are returned. Tags are free-form labels; a " +
    "transcription carries at most 5. Read-only. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

/**
 * TWO stores, and they are not the same thing.
 *
 * `public.tags` is a curated registry a person builds in the web app — named
 * tags with ids, scoped to a workspace. `transcriptions.tags` is a plain text
 * array of the labels actually ON each transcription. Nothing keeps them in
 * step: `bulk-add-tags` writes only the array, and it does so from the web app
 * too, so a tag applied in the dashboard does not appear in the registry either.
 *
 * Reading only the registry would have made this tool actively misleading —
 * tag_transcriptions would succeed and list_tags would report nothing. So both
 * are returned, labelled, and the answer to "what tags exist" is the union.
 */
export async function handleListTags(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const [registry, applied] = await Promise.all([
      postgrest(token, issuer, "/tags?select=id,name,workspace_id,created_at&order=name.asc&limit=500"),
      // `tags` is a text[]; `not.eq.{}` skips the rows carrying none.
      postgrest(token, issuer, "/transcriptions?select=tags&tags=not.eq.{}&limit=1000"),
    ]);

    if (!registry.ok) return upstreamError("Listing tags", registry.status, registry.data);
    if (!applied.ok) return upstreamError("Listing tags in use", applied.status, applied.data);

    const registryRows = Array.isArray(registry.data) ? registry.data : [];

    // Count usages so an agent can tell a tag on forty interviews from a typo
    // applied once.
    const usage = new Map<string, number>();
    for (const row of (Array.isArray(applied.data) ? applied.data : []) as any[]) {
      for (const tag of Array.isArray(row?.tags) ? row.tags : []) {
        if (typeof tag === "string" && tag) usage.set(tag, (usage.get(tag) ?? 0) + 1);
      }
    }

    if (registryRows.length === 0 && usage.size === 0) {
      return text(
        "No tags on this account yet. tag_transcriptions applies a tag without it needing to exist " +
          "first, so there is nothing to create beforehand.",
      );
    }

    return json({
      in_use: [...usage.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, transcriptions]) => ({ name, transcriptions })),
      registry: registryRows,
      note:
        "in_use is what is actually on transcriptions and is what tag_transcriptions writes. " +
        "registry is the separate named-tag list the web app maintains; the two are not kept in " +
        "step by the product, and nothing here writes to the registry.",
    });
  });
}

export const listFoldersDefinition = {
  name: "list_folders",
  description:
    "List the folders on the signed-in person's account, with the workspace each belongs to. Use " +
    "this to find the folder_id move_to_folder needs. Read-only, and there is deliberately no " +
    "tool here that creates a folder. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleListFolders(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await postgrest(
      token,
      issuer,
      "/folders?select=id,name,workspace_id,created_at&order=name.asc&limit=500",
    );
    if (!ok) return upstreamError("Listing folders", status, data);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return text(
        "No folders. Folders are created in the web app — there is no tool here that makes one, " +
          "deliberately: an agent inventing folder structure is rarely what its human wanted.",
      );
    }
    return json(rows);
  });
}

export const listWorkspacesDefinition = {
  name: "list_workspaces",
  description:
    "List the signed-in person's workspaces. Tags, folders and transcriptions all live inside " +
    "one, so this is the outermost level of their library. Read-only. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleListWorkspaces(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await postgrest(
      token,
      issuer,
      "/workspaces?select=id,name,color,created_at&order=created_at.asc&limit=200",
    );
    if (!ok) return upstreamError("Listing workspaces", status, data);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return text('No workspaces. A "personal" workspace is created on first sign-in to the web app.');
    }
    return json(rows);
  });
}

// ─── Organising: write ───────────────────────────────────────────────────────

export const tagTranscriptionsDefinition = {
  name: "tag_transcriptions",
  description:
    'Add tags to up to 10 existing transcriptions at once — the tool for "label these interviews ' +
    'as Q3". Tags are created on first use, so they need not exist beforehand. Letters, digits ' +
    "and spaces only, at most 30 characters each; a transcription holds at most 5 tags and " +
    "further ones are skipped rather than replacing existing tags. Passing more than 10 ids is " +
    "refused, not truncated. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_ids: {
        type: "array",
        items: { type: "string" },
        description: "Transcription ids to tag. At most 10 per call.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tag names to add. Letters, digits and spaces, max 30 characters each.",
      },
    },
    required: ["transcription_ids", "tags"],
  },
};

export async function handleTagTranscriptions(args: Record<string, unknown>): Promise<ToolResult> {
  const ids = strList(args, "transcription_ids");
  const tags = strList(args, "tags");

  if (!ids) return text("`transcription_ids` must be an array of transcription ids.", true);
  if (!tags) return text("`tags` must be an array of tag names.", true);
  if (ids.length === 0) return text("`transcription_ids` is empty — nothing to tag.", true);
  if (tags.length === 0) return text("`tags` is empty — nothing to add.", true);

  if (ids.length > MAX_TAG_BATCH) {
    return text(
      `${ids.length} transcriptions were passed but this tool takes at most ${MAX_TAG_BATCH} at a ` +
        "time, and the backend refuses more than that regardless.\n\n" +
        `Split the work into batches of ${MAX_TAG_BATCH} and call this once per batch. Nothing was tagged.`,
      true,
    );
  }

  const invalid = tags.filter((t) => t.length > 30 || !/^[A-Za-z0-9 ]+$/.test(t));
  if (invalid.length > 0) {
    return text(
      `These tag names are not allowed: ${invalid.join(", ")}.\n\n` +
        "Tags are letters, digits and spaces only, at most 30 characters. Nothing was tagged.",
      true,
    );
  }

  return withToken(async (token, issuer) => {
    const { ok, status, data } = await callFunction(token, issuer, "bulk-add-tags", {
      transcriptionIds: ids,
      tagsToAdd: tags,
    });
    if (!ok) return upstreamError("Adding tags", status, data);

    const updated = Number(data?.updated ?? 0);
    const failed = Number(data?.failed ?? 0);
    const skipped = Number(data?.skipped ?? 0);
    const lines = [`Tagged ${updated} of ${ids.length} transcriptions with: ${tags.join(", ")}`];
    if (skipped > 0) {
      lines.push(
        "",
        `${skipped} were skipped because they already carry the maximum of 5 tags. A transcription ` +
          "cannot hold more, so those are unchanged rather than partially updated.",
      );
    }
    if (failed > 0) {
      lines.push("", `${failed} failed:`);
      for (const e of (data?.errors ?? []).slice(0, MAX_TAG_BATCH)) {
        lines.push(`  ${e.id}: ${e.error}`);
      }
    }
    return text(lines.join("\n"), failed > 0 && updated === 0);
  });
}

export const moveToFolderDefinition = {
  name: "move_to_folder",
  description:
    "File up to 50 existing transcriptions into a folder, or pass folder_id: null to move them " +
    "out of any folder. The folder must already exist and belong to the signed-in person — call " +
    "list_folders for the ids. Passing more than 50 ids is refused, not truncated. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_ids: {
        type: "array",
        items: { type: "string" },
        description: "Transcription ids to move. At most 50 per call.",
      },
      folder_id: {
        type: ["string", "null"],
        description: "Target folder id, or null to remove them from any folder.",
      },
    },
    required: ["transcription_ids", "folder_id"],
  },
};

export async function handleMoveToFolder(args: Record<string, unknown>): Promise<ToolResult> {
  const ids = strList(args, "transcription_ids");
  if (!ids) return text("`transcription_ids` must be an array of transcription ids.", true);
  if (ids.length === 0) return text("`transcription_ids` is empty — nothing to move.", true);

  if (ids.length > MAX_MOVE_BATCH) {
    return text(
      `${ids.length} transcriptions were passed but this tool moves at most ${MAX_MOVE_BATCH} at a time.\n\n` +
        `Split the work into batches of ${MAX_MOVE_BATCH}. Nothing was moved.`,
      true,
    );
  }

  // `null` means "out of any folder", which is a real operation and distinct
  // from the argument being absent.
  const raw = args.folder_id;
  const folderId = raw === null ? null : typeof raw === "string" ? raw.trim() : undefined;
  if (folderId === undefined) {
    return text(
      "`folder_id` is required: a folder id to move into, or null to move the transcriptions out " +
        "of any folder.",
      true,
    );
  }

  return withToken(async (token, issuer) => {
    if (folderId !== null) {
      // Resolve the folder through the caller's own token FIRST. RLS makes
      // somebody else's folder invisible, so this both confirms the folder is
      // real and confirms it is theirs — and it fails with a sentence instead
      // of a foreign-key error from three layers down.
      const check = await postgrest(
        token,
        issuer,
        `/folders?select=id,name&id=eq.${encodeURIComponent(folderId)}`,
      );
      if (!check.ok) return upstreamError("Checking the folder", check.status, check.data);
      if (!Array.isArray(check.data) || check.data.length === 0) {
        return text(
          `No folder ${folderId} is visible on this account. Call list_folders to see the real ids — ` +
            "a folder belonging to someone else is indistinguishable from one that does not exist.",
          true,
        );
      }
    }

    const { ok, status, data } = await postgrest(
      token,
      issuer,
      `/transcriptions?id=in.${inList(ids)}&select=id,original_filename,folder_id`,
      { method: "PATCH", body: { folder_id: folderId }, prefer: "return=representation" },
    );
    if (!ok) return upstreamError("Moving transcriptions", status, data);

    const moved: any[] = Array.isArray(data) ? data : [];
    const missed = ids.filter((id) => !moved.some((row) => row.id === id));

    const lines = [
      folderId === null
        ? `Moved ${moved.length} of ${ids.length} transcriptions out of their folders.`
        : `Moved ${moved.length} of ${ids.length} transcriptions into folder ${folderId}.`,
    ];
    if (missed.length > 0) {
      lines.push(
        "",
        `${missed.length} were not moved because they are not visible on this account (deleted, or ` +
          `belonging to someone else): ${missed.join(", ")}`,
      );
    }
    return text(lines.join("\n"), moved.length === 0);
  });
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export const generateSummaryDefinition = {
  name: "generate_summary",
  description:
    "Generate a structured summary of an existing completed transcript — action items, key " +
    "takeaways, topics and next steps, each with a timestamp. Costs no LLM credits. IMPORTANT " +
    "SIDE EFFECT: this also mints a share link, a publicly reachable URL that lets anyone holding " +
    "it read the transcript without signing in; the URL is returned so you can see what was " +
    "created. Idempotent: a transcript that already has a summary is skipped and not regenerated, " +
    "so calling this repeatedly is free and harmless. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: { type: "string", description: "A completed transcription id." },
    },
    required: ["transcription_id"],
  },
};

export async function handleGenerateSummary(args: Record<string, unknown>): Promise<ToolResult> {
  const id = str(args, "transcription_id");
  if (!id) return text("`transcription_id` is required.", true);

  return withToken(async (token, issuer) => {
    // userId comes from the TOKEN, never from tool input. generate-summary
    // re-derives it from the verified token and ignores what we send, but
    // sending a caller-supplied id would make that check the only thing
    // standing between an agent and someone else's transcript.
    const userId = userIdFromToken(token);
    if (!userId) {
      return text("The stored access token could not be read. Call `login` to sign in again.", true);
    }

    const { ok, status, data } = await callFunction(
      token,
      issuer,
      "generate-summary",
      // No `force`: regenerating is internal-only, because this endpoint bills
      // nothing and has no rate limit. See generate-summary/index.ts.
      { transcriptionId: id, userId },
      // Summarising a long transcript is an LLM round trip, not a database read.
      120_000,
    );
    if (!ok) return upstreamError("Generating the summary", status, data);

    const shareToken = data?.share_token;
    const skipped = data?.skipped === true;

    const lines = skipped
      ? [`${id} already has a summary, so nothing was regenerated — that is not an error.`]
      : [`A summary was generated for ${id}.`];

    if (shareToken) {
      lines.push("");
      // The skip path mints NOTHING — the link was already there. Reporting
      // "this also minted a share link" on that path would announce a side
      // effect that did not happen, which is how an agent ends up telling its
      // human it just published something it did not.
      lines.push(
        ...(skipped
          ? [
              "This transcript ALREADY had a publicly reachable share link, from when it was first",
              "summarised. Nothing new was created just now. Anyone holding the URL can read the",
              "transcript without signing in:",
            ]
          : [
              "NOTE — this ALSO MINTED a share link, which is how the web app has always worked:",
              "generating a summary creates a publicly reachable URL for the transcript. Anyone",
              "holding it can read the transcript without signing in:",
            ]),
        "",
        `  ${SITE()}/share/${shareToken}`,
        "",
        "Do not publish it unless the person asked you to share the transcript. list_shares shows",
        "every transcript on the account that currently has one.",
      );
    }

    lines.push(
      "",
      "The summary is stored on the transcription and is read in the web app. Generating one costs",
      "no LLM credits.",
    );
    return text(lines.join("\n"));
  });
}

export const listSharesDefinition = {
  name: "list_shares",
  description:
    "List every transcript on the signed-in person's account that has a share link, with the " +
    "public URL of each. Anyone holding one of those URLs can read that transcript without " +
    "signing in, so this is how you find out what is currently public. Read-only; revoking a link " +
    "is done in the web app. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleListShares(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await postgrest(
      token,
      issuer,
      "/transcriptions?select=id,original_filename,share_token,share_token_created_at" +
        "&share_token=not.is.null&order=share_token_created_at.desc&limit=200",
    );
    if (!ok) return upstreamError("Listing shared transcripts", status, data);

    const rows: any[] = Array.isArray(data) ? data : [];
    if (rows.length === 0) return text("No transcript on this account has a share link.");

    const lines = [
      `${rows.length} transcript${rows.length === 1 ? " has" : "s have"} a publicly reachable share link.`,
      "Anyone holding one of these URLs can read that transcript without signing in.",
      "",
    ];
    for (const row of rows) {
      lines.push(
        `${row.id}  ${row.original_filename ?? ""}`,
        `  ${SITE()}/share/${row.share_token}  (created ${row.share_token_created_at ?? "unknown"})`,
      );
    }
    lines.push(
      "",
      "Links are minted by generate_summary — in the web app and here, summarising a transcript is",
      "what makes it shareable. There is no tool here that revokes one; that is done in the web app.",
    );
    return text(lines.join("\n"));
  });
}

// ─── Audio ───────────────────────────────────────────────────────────────────

/**
 * The object path inside the `audio-files` bucket.
 *
 * `transcriptions.file_url` holds one of three shapes depending on how the file
 * arrived — a bare path, a public URL, or an already-signed URL. The web player
 * normalises the same three; this is that logic, kept in step deliberately.
 */
function toStoragePath(fileUrl: string): string {
  if (!fileUrl.startsWith("http")) return fileUrl;
  const match = fileUrl.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/audio-files\/(.+)$/,
  );
  if (match) return decodeURIComponent(match[1].split("?")[0]);
  return fileUrl;
}

export const getTranscriptAudioDefinition = {
  name: "get_transcript_audio",
  description:
    "Return a time-limited signed URL for the source audio or video of an existing transcription, " +
    "so it can be handed to another tool or streamed. Valid for one hour and supports HTTP Range " +
    "requests. This reads back media that already exists — it does not transcribe anything and " +
    "costs nothing. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: { type: "string", description: "The transcription ID (UUID)." },
    },
    required: ["transcription_id"],
  },
};

export async function handleGetTranscriptAudio(args: Record<string, unknown>): Promise<ToolResult> {
  const id = str(args, "transcription_id");
  if (!id) return text("`transcription_id` is required.", true);

  return withToken(async (token, issuer) => {
    const lookup = await postgrest(
      token,
      issuer,
      "/transcriptions?select=id,file_url,original_filename,file_extension,file_size_bytes," +
        `duration_seconds,status&id=eq.${encodeURIComponent(id)}`,
    );
    if (!lookup.ok) return upstreamError("Reading the transcription", lookup.status, lookup.data);

    const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
    if (!row) {
      return text(
        `No transcription ${id} is visible on this account. A transcription belonging to someone ` +
          "else is indistinguishable from one that does not exist.",
        true,
      );
    }
    if (!row.file_url) {
      return text(
        `Transcription ${id} has no source media recorded. Meeting-bot recordings and files whose ` +
          "retention window has passed can both look like this.",
        true,
      );
    }

    // Signed as the caller, so storage RLS decides — the same path the web
    // player takes. A URL minted with elevated rights would hand an agent
    // something its user never had.
    const signed = await signStorageObject(
      token,
      issuer,
      "audio-files",
      toStoragePath(String(row.file_url)),
      AUDIO_URL_TTL_S,
    );
    if (!signed.ok || !signed.url) {
      return upstreamError("Signing the media URL", signed.status, signed.data);
    }

    return text(
      [
        `Signed media URL for ${id} (${row.original_filename ?? "untitled"}):`,
        "",
        signed.url,
        "",
        `Valid for ${AUDIO_URL_TTL_S / 60} minutes, then it stops working — call this again for a fresh one.`,
        "It supports HTTP Range requests, so it can be streamed rather than downloaded whole.",
        "",
        row.duration_seconds ? `duration: ${row.duration_seconds}s` : "",
        row.file_size_bytes ? `size: ${(Number(row.file_size_bytes) / 1_048_576).toFixed(1)} MB` : "",
        row.file_extension ? `format: ${row.file_extension}` : "",
        "",
        "This reads back media that already exists. It does not transcribe anything and costs nothing.",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    );
  });
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export const chatWithTranscriptDefinition = {
  name: "chat_with_transcript",
  description:
    "Ask a question about an existing transcript and get an answer from the model, with the " +
    "transcript as context. SPENDS THE ACCOUNT'S LLM CREDITS — every message is billed against " +
    "them. If you already hold the transcript text, answering directly is cheaper and usually " +
    "just as good; this is for when you do not. Pass back the returned conversation_id to " +
    "continue a thread. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: { type: "string", description: "A completed transcription id." },
      message: { type: "string", description: "The question to ask about the transcript." },
      conversation_id: {
        type: "string",
        description: "Continue an existing thread. Omit to start a new one.",
      },
    },
    required: ["transcription_id", "message"],
  },
};

/**
 * transcript-chat answers over SSE, not JSON, so this consumes the stream and
 * returns the assembled answer.
 *
 * A truncated stream still returns whatever arrived: the person has already been
 * billed for what the model generated, and throwing it away would charge them
 * for nothing.
 */
export async function handleChatWithTranscript(args: Record<string, unknown>): Promise<ToolResult> {
  const id = str(args, "transcription_id");
  const message = str(args, "message");
  if (!id) return text("`transcription_id` is required.", true);
  if (!message) return text("`message` is required.", true);

  const conversationId = str(args, "conversation_id");

  return withToken(async (token, issuer) => {
    const body: Record<string, unknown> = { transcription_id: id, message };
    if (conversationId) body.conversation_id = conversationId;

    let res: Response;
    try {
      res = await fetch(`${functionsBaseFrom(issuer)}/transcript-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CHAT_BUDGET_MS),
      });
    } catch (err) {
      return text(
        `The chat request did not complete: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      return upstreamError("Chatting with the transcript", res.status, data);
    }

    // Errors BEFORE the stream starts come back as JSON; errors during it come
    // back as an SSE `error` event. Both are real and they look nothing alike.
    if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const data = await res.json().catch(() => null);
      return upstreamError("Chatting with the transcript", res.status, data);
    }

    let answer = "";
    let newConversationId = conversationId;
    let creditsRemaining: number | null = null;
    let tokensUsed: number | null = null;
    let streamError: string | null = null;
    let done = false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (!done) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a partial frame stays in
        // the buffer until the rest of it arrives.
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);

          const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const dataLine = frame.match(/^data:\s*(.*)$/m)?.[1];
          if (!event || dataLine === undefined) continue;

          let payload: any = null;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (event === "start" && payload?.conversation_id) {
            newConversationId = payload.conversation_id;
          } else if (event === "text" && typeof payload?.content === "string") {
            answer += payload.content;
          } else if (event === "error") {
            streamError = payload?.error ?? "The model returned no response.";
            done = true;
            break;
          } else if (event === "done") {
            newConversationId = payload?.conversation_id ?? newConversationId;
            creditsRemaining = payload?.credits_remaining ?? null;
            tokensUsed = payload?.tokens_used ?? null;
            done = true;
            break;
          }
        }
      }
    } catch (err) {
      if (!answer) {
        return text(
          `The chat stream failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* the stream may already be closed */
      }
    }

    if (streamError && !answer) return text(`The chat failed: ${streamError}`, true);
    if (!answer) {
      return text(
        "The model returned nothing. This usually means the transcript is empty or still processing.",
        true,
      );
    }

    const footer = [""];
    if (!done) {
      footer.push(
        `[The answer above is INCOMPLETE — this server stopped reading after ${CHAT_BUDGET_MS / 1000} seconds.`,
        "The full answer was generated and stored; open the transcript in the web app to read the rest.]",
      );
    }
    if (newConversationId) {
      footer.push(`conversation_id: ${newConversationId}  (pass this back to continue the thread)`);
    }
    if (tokensUsed !== null) footer.push(`tokens used: ${tokensUsed}`);
    if (creditsRemaining !== null) footer.push(`LLM credits remaining: ${creditsRemaining}`);

    return text([answer.trim(), ...footer].join("\n"));
  });
}
