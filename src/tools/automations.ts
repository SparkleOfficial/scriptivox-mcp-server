import {
  type ToolResult,
  text,
  json,
  callFunction,
  postgrest,
  upstreamError,
  withToken,
  userIdFromToken,
  str,
} from "./user-client.js";

/**
 * Automations — the closest thing this product already has to agent behaviour.
 *
 * An automation is a saved chain of steps (LLM prompts, webhooks) a person built
 * in the web app and runs over a finished transcript. Exposing them means an
 * agent can use work its human already designed, rather than reinventing it one
 * prompt at a time.
 *
 * Mirrors the hosted implementation in the main repo
 * (src/lib/mcp/automationTools.ts) and hits the SAME endpoints with the same
 * shapes.
 *
 * ── The schema is `automation`, not `public` ────────────────────────────────
 *
 * Every table here lives in the `automation` schema, which PostgREST reaches
 * only when the request carries `Accept-Profile: automation`. Without it the
 * query silently addresses `public` and comes back "relation does not exist",
 * which reads like a permissions problem and is not one.
 *
 * ── Running one is not free ─────────────────────────────────────────────────
 *
 * `automation-run` executes LLM steps and bills the person's LLM credits. The
 * tool description says so, because an agent that does not know a call costs
 * money will make it speculatively.
 */

export const listAutomationsDefinition = {
  name: "list_automations",
  description:
    "List the automations on the signed-in person's account — saved chains of steps they built in " +
    "the web app to run over a finished transcript. Read-only, and there is deliberately no tool " +
    "here that creates or edits one. Requires `login`.",
  inputSchema: { type: "object" as const, properties: {} },
};

export async function handleListAutomations(): Promise<ToolResult> {
  return withToken(async (token, issuer) => {
    const { ok, status, data } = await postgrest(
      token,
      issuer,
      "/automations?select=id,name,description,workspace_id,folder_id,stop_on_step_failure," +
        "created_at,updated_at&deleted_at=is.null&order=updated_at.desc&limit=200",
      { schema: "automation" },
    );
    if (!ok) return upstreamError("Listing automations", status, data);

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return text(
        "No automations on this account. They are built in the web app — there is no tool here " +
          "that creates one, deliberately: an automation is a chain of prompts and webhooks its " +
          "owner should have seen before it runs on their credits.",
      );
    }
    return json(rows);
  });
}

export const runAutomationDefinition = {
  name: "run_automation",
  description:
    "Run one of the signed-in person's existing automations over one completed transcription. " +
    "SPENDS THE ACCOUNT'S LLM CREDITS as its steps execute. Returns a run_id immediately — " +
    "automations are long-running and do not finish inside this call, so poll get_automation_run " +
    "until the status is succeeded or failed. Re-running the same automation over the same " +
    "transcript is suppressed rather than duplicated. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      automation_id: { type: "string", description: "From list_automations." },
      transcription_id: {
        type: "string",
        description: "A COMPLETED transcription. Anything else is refused.",
      },
    },
    required: ["automation_id", "transcription_id"],
  },
};

export async function handleRunAutomation(args: Record<string, unknown>): Promise<ToolResult> {
  const automationId = str(args, "automation_id");
  const transcriptionId = str(args, "transcription_id");
  if (!automationId) {
    return text("`automation_id` is required. Call list_automations for the ids.", true);
  }
  if (!transcriptionId) return text("`transcription_id` is required.", true);

  return withToken(async (token, issuer) => {
    // user_id comes from the TOKEN. automation-run 403s when body.user_id does
    // not equal the verified user — passing through a caller-supplied id would
    // make that check the only thing between an agent and someone else's credits.
    const userId = userIdFromToken(token);
    if (!userId) {
      return text("The stored access token could not be read. Call `login` to sign in again.", true);
    }

    const { ok, status, data } = await callFunction(token, issuer, "automation-run", {
      automation_id: automationId,
      transcription_id: transcriptionId,
      user_id: userId,
      trigger_type: "manual",
    });

    if (!ok) {
      if (status === 400 && /completed transcriptions/i.test(String(data?.error ?? ""))) {
        return text(
          `Automations only run on completed transcriptions. ${transcriptionId} is currently ` +
            `"${data?.current_status ?? "not completed"}" — wait for it to finish and call again.`,
          true,
        );
      }
      return upstreamError("Running the automation", status, data);
    }

    const runId = data?.run_id;
    if (!runId) return text("The automation started but returned no run id.", true);

    if (data?.duplicate) {
      return text(
        [
          `This automation was already ${data.status} for ${transcriptionId}; no second run was started.`,
          "",
          `run_id: ${runId}`,
          `status: ${data.status}`,
          "",
          "Poll get_automation_run with that id. Re-running the same automation over the same",
          "transcript is suppressed on purpose, so this costs nothing.",
        ].join("\n"),
      );
    }

    return text(
      [
        `Automation ${automationId} is running over ${transcriptionId}.`,
        "",
        `run_id: ${runId}`,
        `status: ${data?.status ?? "running"}`,
        "",
        "This does not finish inside one tool call. Poll get_automation_run with the run id until its",
        'status is "succeeded" or "failed".',
        "",
        "LLM steps in this automation spend the account's LLM credits as they execute.",
      ].join("\n"),
    );
  });
}

export const getAutomationRunDefinition = {
  name: "get_automation_run",
  description:
    "Check the progress of an automation run started by run_automation: overall status, plus each " +
    "step with its status, model, duration and error. Poll this the way you would poll " +
    "transcribe_status. Read-only. Requires `login`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      run_id: { type: "string", description: "The run_id returned by run_automation." },
    },
    required: ["run_id"],
  },
};

export async function handleGetAutomationRun(args: Record<string, unknown>): Promise<ToolResult> {
  const runId = str(args, "run_id");
  if (!runId) return text("`run_id` is required — the id run_automation returned.", true);

  return withToken(async (token, issuer) => {
    const run = await postgrest(
      token,
      issuer,
      "/automation_runs?select=id,automation_id,transcription_id,status,trigger_type," +
        "current_step_position,error,stats,started_at,finished_at,created_at" +
        `&id=eq.${encodeURIComponent(runId)}`,
      { schema: "automation" },
    );
    if (!run.ok) return upstreamError("Reading the automation run", run.status, run.data);

    const row = Array.isArray(run.data) ? run.data[0] : null;
    if (!row) {
      return text(
        `No automation run ${runId} is visible on this account. A run belonging to someone else is ` +
          "indistinguishable from one that does not exist.",
        true,
      );
    }

    // Step rows are what make a failure diagnosable — "failed" on its own tells
    // an agent nothing about which step or why.
    const steps = await postgrest(
      token,
      issuer,
      "/automation_step_runs?select=step_name,step_kind,status,error,http_status,duration_ms," +
        `model_used,attempt,started_at,finished_at&automation_run_id=eq.${encodeURIComponent(runId)}` +
        "&order=started_at.asc&limit=100",
      { schema: "automation" },
    );

    const lines = [
      `run_id: ${row.id}`,
      `status: ${row.status}`,
      `automation_id: ${row.automation_id}`,
      `transcription_id: ${row.transcription_id ?? "—"}`,
      `trigger: ${row.trigger_type}`,
      `started: ${row.started_at ?? "—"}`,
      `finished: ${row.finished_at ?? "— (still running)"}`,
    ];
    if (row.error) lines.push(`error: ${row.error}`);

    if (steps.ok && Array.isArray(steps.data) && steps.data.length > 0) {
      lines.push("", "--- steps ---");
      for (const s of steps.data as any[]) {
        const bits = [
          `${String(s.status).padEnd(9)} ${s.step_name ?? s.step_kind ?? "step"}`,
          s.model_used ? `model=${s.model_used}` : "",
          s.http_status ? `http=${s.http_status}` : "",
          s.duration_ms ? `${s.duration_ms}ms` : "",
          s.attempt > 1 ? `attempt ${s.attempt}` : "",
        ].filter(Boolean);
        lines.push("  " + bits.join("  "));
        if (s.error) lines.push(`    error: ${s.error}`);
      }
    }

    if (row.status === "running") lines.push("", "Still running. Poll again in a few seconds.");
    lines.push("", "Step outputs are stored on the run and are readable in the web app.");

    return text(lines.join("\n"), row.status === "failed");
  });
}
