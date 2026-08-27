import {
  type ToolResult,
  text,
  json,
  callFunction,
  postgrest,
  upstreamError,
  withToken,
  str,
} from "./user-client.js";

/**
 * Meeting bots — the ONE tool in the user-token tier that creates new
 * transcription work, and therefore the only one that needs a policy of its own.
 *
 * ── Why this is allowed at all ──────────────────────────────────────────────
 *
 * Everything else an agent can reach with a web credential consumes something
 * already paid for: filing, tagging, summarising, reading back audio. A meeting
 * bot does not — it produces a NEW transcript on a plan that includes unlimited
 * transcription and is priced for one human at a keyboard.
 *
 * It is here because "record my 3pm" is a thing a person genuinely asks their
 * assistant to do, and refusing it would make the assistant useless for the one
 * meeting workflow the product actually has. That is a deliberate exception to
 * the boundary, not an oversight, and it is bounded three ways:
 *
 *   1. ONE MEETING PER CALL. `meeting_url` is a single string. There is no
 *      array form and no loop — a request to "record all of these" has to be N
 *      separate, individually-rate-limited calls, each of which the human can
 *      see. Bulk recording is the shape this exception must never take.
 *   2. RATE LIMITED. See RECENT_BOT_LIMIT below.
 *   3. A SMALL SURFACE. start-meeting-bot accepts seventeen-odd fields. Four
 *      are exposed. A tool with seventeen optional parameters is one an agent
 *      uses wrongly, and every field left off is a decision its owner already
 *      made in the web app and does not need re-made by a model.
 *
 * Nothing here can transcribe a FILE or a URL — that still belongs to the
 * metered API tools, which take an sk_live_ key.
 *
 * Mirrors the hosted implementation in the main repo
 * (src/lib/mcp/meetingTools.ts), limits included.
 */

const RECENT_BOT_LIMIT = 5;
const RECENT_BOT_WINDOW_MINUTES = 60;

/** Recognised meeting hosts. A bot cannot join anything else, so say so early. */
const SUPPORTED_HOSTS =
  /(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)/i;

export const startMeetingBotDefinition = {
  name: "start_meeting_bot",
  description:
    "Send a bot to join ONE Zoom, Google Meet, Teams or Webex call and record it, producing a " +
    "speaker-attributed transcript after the call ends. This is the only tool here that creates " +
    "new transcription work, so it takes a single meeting_url — never a list — and is rate " +
    "limited to 5 bots per hour per account. It consumes the account's meeting minutes. The " +
    "transcript is not available when this returns; track it with list_scheduled_meetings. " +
    "Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meeting_url: {
        type: "string",
        description:
          "The meeting link to join (Zoom, Google Meet, Teams or Webex). ONE url — this tool does " +
          "not take a list.",
      },
      title: { type: "string", description: "Title for the resulting transcript. Optional." },
      language: {
        type: "string",
        description: "ISO 639-1 language code for the meeting audio. Optional; auto-detected when omitted.",
      },
      scheduled_time: {
        type: "string",
        description: "ISO 8601 time for the bot to join. Omit to join immediately. Must be in the future.",
      },
    },
    required: ["meeting_url"],
  },
};

export async function handleStartMeetingBot(args: Record<string, unknown>): Promise<ToolResult> {
  // Guard the SHAPE before the value. An agent that passes an array here has
  // read this tool as a bulk recorder, and the useful answer says it is not one
  // — rather than "expected string, got object".
  if (Array.isArray(args.meeting_url)) {
    return text(
      "This tool records ONE meeting per call. `meeting_url` is a single URL, not a list.\n\n" +
        "Bulk-recording meetings is deliberately not possible here: each bot produces a new " +
        "transcript, and that is a decision a person should make one meeting at a time. Call this " +
        "once per meeting.",
      true,
    );
  }

  const meetingUrl = str(args, "meeting_url");
  if (!meetingUrl) {
    return text("`meeting_url` is required — the Zoom, Google Meet, Teams or Webex link to join.", true);
  }

  let parsed: URL;
  try {
    parsed = new URL(meetingUrl);
  } catch {
    return text(`\`meeting_url\` is not a URL: ${meetingUrl}`, true);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return text("`meeting_url` must be an http(s) URL.", true);
  }
  if (!SUPPORTED_HOSTS.test(parsed.hostname)) {
    return text(
      `The bot cannot join ${parsed.hostname}. Supported platforms are Zoom, Google Meet, ` +
        "Microsoft Teams and Webex. Nothing was scheduled.",
      true,
    );
  }

  const scheduledTime = str(args, "scheduled_time");
  if (scheduledTime && Number.isNaN(Date.parse(scheduledTime))) {
    return text('`scheduled_time` must be an ISO 8601 timestamp, e.g. "2026-08-27T15:00:00Z".', true);
  }
  if (scheduledTime && Date.parse(scheduledTime) < Date.now() - 60_000) {
    return text(
      `\`scheduled_time\` (${scheduledTime}) is in the past. Omit it to join now, or pass a future time.`,
      true,
    );
  }

  return withToken(async (token, issuer) => {
    // ── Rate limit ──────────────────────────────────────────────────────────
    const since = new Date(Date.now() - RECENT_BOT_WINDOW_MINUTES * 60_000).toISOString();
    const recent = await postgrest(
      token,
      issuer,
      `/meeting_bots?select=id,created_at&created_at=gte.${encodeURIComponent(since)}` +
        `&order=created_at.desc&limit=${RECENT_BOT_LIMIT + 1}`,
      { schema: "meeting" },
    );
    if (!recent.ok) {
      // Fail CLOSED. The limit is the only bound on this exception, and a read
      // failure is not evidence that the account is under it.
      return upstreamError("Checking the meeting-bot rate limit", recent.status, recent.data);
    }
    const rows: any[] = Array.isArray(recent.data) ? recent.data : [];
    if (rows.length >= RECENT_BOT_LIMIT) {
      const oldest = rows[rows.length - 1]?.created_at;
      return text(
        [
          `Rate limit: ${rows.length} meeting bots have already been started on this account in the ` +
            `last ${RECENT_BOT_WINDOW_MINUTES} minutes, and the ceiling is ${RECENT_BOT_LIMIT}. No bot was started.`,
          "",
          oldest ? `The oldest of those was at ${oldest}; the window rolls forward from there.` : "",
          "",
          "A meeting bot produces a new transcript on a plan meant for one person, so this is bounded",
          "on purpose. If a person really needs more, they can start them from the web app.",
        ]
          .filter((l) => l !== "")
          .join("\n"),
        true,
      );
    }

    const body: Record<string, unknown> = { meetingUrl };
    const title = str(args, "title");
    const language = str(args, "language");
    if (title) body.title = title;
    if (language) body.language = language;
    if (scheduledTime) body.scheduledTime = scheduledTime;

    const { ok, status, data } = await callFunction(token, issuer, "start-meeting-bot", body, 45_000);

    if (!ok) {
      if (status === 403 && /meeting minutes/i.test(String(data?.error ?? ""))) {
        return text(
          "This account has no meeting minutes remaining, so no bot was started. Meeting minutes " +
            "refill on the plan cycle; a larger plan grants more.",
          true,
        );
      }
      if (status === 503) {
        return text(
          "Every meeting bot is currently in use, so none could be dispatched. This is transient — " +
            "try again in a minute. Nothing was scheduled and nothing was charged.",
          true,
        );
      }
      return upstreamError("Starting the meeting bot", status, data);
    }

    // The pool-depleted path returns 202 with a QUEUED dispatch and no
    // transcription yet. It has a different id and a different cancel tool, so
    // it must not be reported as a running bot.
    if (data?.queued) {
      return text(
        [
          "Meeting bots are busy, so this one was QUEUED and will be dispatched automatically before",
          "the meeting starts.",
          "",
          `dispatch_id: ${data.dispatch_id}`,
          `scheduled_time: ${data.scheduled_time}`,
          "",
          "There is no transcription yet. Cancel it with cancel_scheduled_bot and this dispatch_id —",
          "NOT with stop_meeting_bot, which acts on bots that already exist.",
        ].join("\n"),
      );
    }

    return text(
      [
        scheduledTime
          ? `A meeting bot is scheduled to join ${meetingUrl} at ${scheduledTime}.`
          : `A meeting bot is joining ${meetingUrl} now.`,
        "",
        `transcription_id: ${data?.transcription_id}`,
        `job_id: ${data?.job_id}`,
        `bot_status: ${data?.bot_status ?? "joining"}`,
        "",
        "The transcript is produced after the call ends — it is not available now. Track it with",
        "list_scheduled_meetings, or read the transcription id above once the meeting is over.",
        "",
        "Stop the bot with stop_meeting_bot and the transcription_id or job_id above.",
        "",
        "This consumes the account's meeting minutes.",
      ].join("\n"),
    );
  });
}

export const stopMeetingBotDefinition = {
  name: "stop_meeting_bot",
  description:
    "Tell a meeting bot that is currently in a call to leave. Whatever it recorded up to that " +
    "point is still processed into a transcript — this ends the recording, it does not discard " +
    "it. Identify the bot by transcription_id or job_id from list_scheduled_meetings. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: { type: "string", description: "The transcription the bot is recording into." },
      job_id: { type: "string", description: "The meeting-bot job id. Either this or transcription_id." },
    },
  },
};

export async function handleStopMeetingBot(args: Record<string, unknown>): Promise<ToolResult> {
  const transcriptionId = str(args, "transcription_id");
  const jobId = str(args, "job_id");
  if (!transcriptionId && !jobId) {
    return text(
      "Either `transcription_id` or `job_id` is required. Call list_scheduled_meetings to find them.",
      true,
    );
  }

  return withToken(async (token, issuer) => {
    const body: Record<string, unknown> = {};
    if (transcriptionId) body.transcriptionId = transcriptionId;
    if (jobId) body.jobId = jobId;

    const { ok, status, data } = await callFunction(token, issuer, "stop-meeting-bot", body);
    if (!ok) return upstreamError("Stopping the meeting bot", status, data);

    return text(
      [
        `The meeting bot for ${transcriptionId || jobId} has been told to leave the call.`,
        "",
        "Anything it recorded before now is still processed into a transcript — stopping the bot ends",
        "the recording, it does not discard it.",
        "",
        data?.message ? String(data.message) : "",
      ]
        .filter((l) => l !== "")
        .join("\n"),
    );
  });
}

export const cancelScheduledBotDefinition = {
  name: "cancel_scheduled_bot",
  description:
    "Cancel a meeting bot that has not joined yet, so it never joins. Use transcription_id for a " +
    "scheduled bot that already exists, or dispatch_id for one still queued because every bot was " +
    "busy — a queued dispatch has no transcription and is reachable only by its dispatch_id. " +
    "list_scheduled_meetings returns both, labelled. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transcription_id: { type: "string", description: "A scheduled bot that already exists." },
      dispatch_id: { type: "string", description: "A dispatch still queued, with no transcription yet." },
    },
  },
};

export async function handleCancelScheduledBot(args: Record<string, unknown>): Promise<ToolResult> {
  const transcriptionId = str(args, "transcription_id");
  const dispatchId = str(args, "dispatch_id");
  if (!transcriptionId && !dispatchId) {
    return text(
      "Either `transcription_id` (a scheduled bot that already exists) or `dispatch_id` (one still " +
        "queued) is required. Call list_scheduled_meetings — it returns both, labelled.",
      true,
    );
  }

  return withToken(async (token, issuer) => {
    const body: Record<string, unknown> = {};
    // dispatchId alone is the queued-dispatch path; sending both makes the
    // function take the transcription branch and ignore the dispatch.
    if (transcriptionId) body.transcriptionId = transcriptionId;
    else body.dispatchId = dispatchId;

    const { ok, status, data } = await callFunction(token, issuer, "cancel-scheduled-bot", body);
    if (!ok) return upstreamError("Cancelling the scheduled bot", status, data);

    return text(`Cancelled. The bot will not join.${data?.message ? `\n\n${data.message}` : ""}`);
  });
}

export const listScheduledMeetingsDefinition = {
  name: "list_scheduled_meetings",
  description:
    "List the signed-in person's meeting bots that are scheduled or currently running, plus any " +
    "dispatches still queued waiting for a free bot. This is where the transcription_id, job_id " +
    "and dispatch_id that stop_meeting_bot and cancel_scheduled_bot need come from. Read-only. " +
    "Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleListScheduledMeetings(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    // TWO stores, because a scheduled bot lives in one of two places depending
    // on whether Recall had capacity when it was booked. A queued dispatch has
    // NO transcription and NO meeting_bots row — it is reachable only by its
    // dispatch id, which is why omitting it would leave cancel_scheduled_bot
    // unusable for exactly the bookings most likely to need cancelling.
    const [bots, queued] = await Promise.all([
      postgrest(
        token,
        issuer,
        "/meeting_bots?select=id,transcription_id,meeting_url,status,bot_status,scheduled_time," +
          "recording_started_at,recording_ended_at,created_at,source" +
          '&status=in.("pending","processing")&order=created_at.desc&limit=100',
        { schema: "meeting" },
      ),
      postgrest(
        token,
        issuer,
        "/bot_dispatch_queue?select=id,meeting_url,join_at,status,attempts,last_error,created_at" +
          "&status=eq.queued&order=join_at.asc&limit=100",
        { schema: "meeting" },
      ),
    ]);

    if (!bots.ok) return upstreamError("Listing meeting bots", bots.status, bots.data);
    if (!queued.ok) return upstreamError("Listing queued dispatches", queued.status, queued.data);

    const botRows: any[] = Array.isArray(bots.data) ? bots.data : [];
    const queuedRows: any[] = Array.isArray(queued.data) ? queued.data : [];

    if (botRows.length === 0 && queuedRows.length === 0) {
      return text("No meeting bot is scheduled or running on this account.");
    }

    return json({
      bots: botRows.map((b) => ({
        ...b,
        cancel_with: "stop_meeting_bot or cancel_scheduled_bot, using transcription_id",
      })),
      queued_dispatches: queuedRows.map((q) => ({
        ...q,
        dispatch_id: q.id,
        cancel_with: "cancel_scheduled_bot, using dispatch_id — these have no transcription yet",
      })),
    });
  });
}
