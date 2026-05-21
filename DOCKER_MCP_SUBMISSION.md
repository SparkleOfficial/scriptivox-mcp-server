# Docker MCP Catalog Submission — Log

Working notes for the Docker MCP Hub submission. Not meant to be pretty —
just enough that future-us (or anyone resuming this) can pick up the
thread without re-deriving everything.

## Status snapshot

- **PR:** https://github.com/docker/mcp-registry/pull/3688 (open, awaiting review)
- **Opened:** 2026-05-20
- **Expected review time:** 1–2 weeks
- **Owner on file:** sparkleofficialmain@gmail.com (also arsh@scriptivox.com on the credentials form)

## What got published where

| Channel | Status | Location |
|---|---|---|
| npm | ✅ Live | `@scriptivox/mcp-server@1.1.0` |
| Docker Hub | ✅ Live | `sparkleofficialmain/scriptivox-mcp-server:1.1.0` and `:latest` (multi-arch: linux/amd64 + linux/arm64) |
| GitHub | ✅ Live | `SparkleOfficial/scriptivox-mcp-server` (v1.1.0 tag pushed) |
| Docker MCP Catalog | 🔄 PR open | docker/mcp-registry#3688 |
| Smithery | ⏸ Blocked | Public form only supports HTTP servers; our stdio server can't self-list |
| Official MCP Registry | ⏸ Blocked | Need private key for `com.scriptivox.www` namespace from prior April publish (abhishek handling) |

## Docker submission — what we actually did

### 1. Fixed the source repo first

Three things were wrong in `SparkleOfficial/scriptivox-mcp-server` that
would have failed Docker's automated checks:

- **Dockerfile was single-stage** and `COPY dist/` failed from a fresh
  clone because `dist/` is gitignored. Rewrote as multi-stage so
  TypeScript is compiled inside the image.
- **`.dockerignore` excluded `src/`** which the multi-stage build needs
  in the builder stage. Removed that line and added broader exclusions
  for things that shouldn't ship in the image (LICENSE, SECURITY.md,
  scripts/, etc.).
- **`LICENSE` was the MCP project's transitional Apache 2.0 + MIT +
  CC-BY-4.0 combined notice** (copy-paste mistake from earlier). Docker
  catalog license auto-detection flagged it as "Other" instead of MIT.
  Replaced with the clean standard MIT text. Now matches package.json.
- Also added `SECURITY.md` because the submission checklist requires a
  documented vulnerability-reporting path.

All committed and pushed: `SparkleOfficial/scriptivox-mcp-server@2bbcb9c`.

### 2. Built and pushed the multi-arch image

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t sparkleofficialmain/scriptivox-mcp-server:1.1.0 \
  -t sparkleofficialmain/scriptivox-mcp-server:latest \
  --push .
```

### 3. Prepared the catalog entry locally

Cloned `docker/mcp-registry` to `/tmp/docker-mcp-registry`, created
`servers/scriptivox/` with two files:

- **`server.yaml`** — metadata, image ref, category (`ai`), tags,
  pinned commit SHA, secret schema (`SCRIPTIVOX_API_KEY`)
- **`tools.json`** — extracted live from the running MCP server via a
  stdio integration test. Contains all 14 tool schemas. Including this
  prevents catalog-build from having to launch the container during
  validation.

### 4. Validated locally

```bash
cd /tmp/docker-mcp-registry
task validate -- --name scriptivox
# All 11 checks pass: Name, Directory, Title, YAML, Commit pinned,
# Secrets, Config env, License (MIT), Icon, Remote validation, OAuth
task build --tools --pull-community scriptivox
# "14 tools found" + "Image pulled as sparkleofficialmain/scriptivox-mcp-server"
task catalog -- scriptivox
# Generates catalogs/scriptivox/catalog.yaml — verified license: "MIT License"
```

Note: `--pull-community` is required because we publish the image
ourselves to `sparkleofficialmain/...` rather than having Docker build
it. Without that flag, `task build` errors with "server is not docker
built".

### 5. Forked, branched, pushed, PR'd

```bash
# Forked docker/mcp-registry into SparkleOfficial
gh repo fork docker/mcp-registry --clone=false

# Clean working clone at /tmp/docker-mcp-registry-fork
git clone https://github.com/SparkleOfficial/mcp-registry.git /tmp/docker-mcp-registry-fork

# Branch + commit
git checkout -b add-scriptivox-server
# (copied servers/scriptivox/ from /tmp/docker-mcp-registry)
git commit -m "Add scriptivox MCP server" ...
git push -u origin add-scriptivox-server
```

**Hiccup hit during push:** GitHub push protection flagged the example
secret value (`sk_live_xxxxxxxxx...`) as a Stripe API key because of
the `sk_live_` prefix. Changed the `example:` field in server.yaml to
`your-scriptivox-api-key` to match the convention other entries use
(`<YOUR_API_KEY>`, `your-aws-secret-access-key`, etc.). Re-validated,
amended, pushed clean.

PR opened with the standard Docker MCP submission template, all 6
basic-requirements and 5 submitter-checklist boxes ticked:
https://github.com/docker/mcp-registry/pull/3688

### 6. Submitted test credentials

Docker's reviewers can't test a credentialed server without an API key,
so we submitted one via https://forms.gle/6Lw3nsvu2d6nFg8e6.

Form fields:
- PR URL: https://github.com/docker/mcp-registry/pull/3688
- Email: arsh@scriptivox.com
- Test credentials: `SCRIPTIVOX_API_KEY=<value from .env.local SCRIPTIVOX_TEST_DOCKER>`
- Additional details: server info, multi-arch note, quick-test recipe
  (call transcribe_url with a short public mp3 → poll
  transcription_status), contact emails

The test key has ~$5 of balance reserved specifically for review. It's
separate from the main production key, so we can rotate or revoke it
without touching real customers.

## Things to remember

### After the PR merges

1. **Rotate the test API key.** It was shared via Google Forms — even
   if Docker handles it carefully, treat it as exposed. Revoke
   `SCRIPTIVOX_TEST_DOCKER` from `.env.local` and delete the row from
   the API keys table.
2. **Bump `source.commit` for future updates.** Each time we ship a
   new version of the MCP server, we need to either update the pin
   ourselves (PR) or wait for Docker's `mcp-registry-bot` to auto-bump
   it (the "chore: update pin for X" PRs you see in their merged
   history).
3. **Check the catalog rendering.** Should appear at the Docker MCP
   catalog UI under category `ai` once merged.

### Working directories (these are throwaway, not in this repo)

- `/tmp/docker-mcp-registry` — upstream clone, used for local validation
- `/tmp/docker-mcp-registry-fork` — SparkleOfficial fork, contains the
  `add-scriptivox-server` branch tied to the PR

If you blow these away and need them back, re-clone:
```bash
git clone https://github.com/docker/mcp-registry.git /tmp/docker-mcp-registry
git clone https://github.com/SparkleOfficial/mcp-registry.git /tmp/docker-mcp-registry-fork
```

### Auth notes

- The fork lives under the `SparkleOfficial` GitHub account, not
  `arsh-911`. Push operations to the fork need `gh auth switch --user
  SparkleOfficial` (then switch back when done).
- Global git author config (`sparkle <arshnoor.ca@gmail.com>`) is what
  appears as commit Author on the PR — that's the correct identity.

### What didn't make it in

- **Smithery:** their public form is HTTP-server-only. To get a stdio
  server listed we'd need to contact their support / use a different
  submission path. Punted.
- **Official MCP Registry:** abhishek published to the
  `com.scriptivox.www` namespace back in April using `mcp-publisher`,
  and the private key from that publish isn't on this machine. Either
  recover the key from abhishek or generate fresh DNS-verified
  credentials. Punted to abhishek.

## Reference files in this repo

- `Dockerfile` — multi-stage, builds TypeScript inside the image
- `.dockerignore` — keeps the image lean, must NOT exclude `src/`
- `SECURITY.md` — vulnerability disclosure path (required by Docker)
- `server.json` — Official MCP Registry metadata (for the abhishek-blocked path)
- `package.json` — `license: MIT` (must match LICENSE)
