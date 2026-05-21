# Smithery Submission — Log

Working notes for the Smithery listing. Same kind of cheat-sheet as
`DOCKER_MCP_SUBMISSION.md`, so future-us can resume without re-deriving
what we did.

## Status snapshot

- **Listing:** https://smithery.ai/servers/sparkleofficialmain/scriptivox
- **Namespace:** `sparkleofficialmain` (org `org_01KNBW0HKQWW9SZFCF11DSYHR2`)
- **Qualified name:** `sparkleofficialmain/scriptivox`
- **MCP URL:** `https://scriptivox--sparkleofficialmain.run.tools` (Smithery's run.tools gateway)
- **Quality score:** 82/100 (climbs once verification + screenshots done)
- **Latest release:** `ffb372e9-b0f2-4c28-87ca-e6e3f1734010` (stdio, v1.1.1, SUCCESS)
- **Visibility:** public (`unlisted: false`)

## What we shipped to Smithery

Smithery distributes us as a **local stdio server via MCPB bundle**.
End users' MCP clients (Claude Desktop, Cursor, etc.) download the
bundle and run `node server/dist/index.js` locally — Smithery doesn't
host the server itself, it hosts the bundle artifact + metadata +
discoverability surface.

### Bundle contents (~3.3 MB)

- `manifest.json` — server metadata, user_config schema, and the full
  14-tool list with `inputSchema` per tool
- `server/dist/` — compiled JS from our TypeScript
- `server/package.json` + `node_modules/` — production deps only
  (`npm ci --omit=dev`)
- ignored at pack time: source TS, dev deps, .git, etc.

Bundle lives at `/tmp/scriptivox-bundle/scriptivox.mcpb` on the build
machine. **Do not commit it** — it's a generated artifact and gets
rebuilt each release.

## Things that bit us during the submission

### 1. Schema conflict between MCPB and Smithery

Smithery's publish API **requires** `inputSchema` per tool in
`manifest.json#tools[]`. Anthropic's MCPB v0.4 schema **forbids**
anything beyond `name` and `description` in that array
(`additionalProperties: false`).

So the official `mcpb pack` CLI refuses to package any bundle that
would satisfy Smithery. Workaround: build the bundle ourselves with
plain `zip`:

```bash
cd /tmp/scriptivox-bundle
zip -qr scriptivox.mcpb manifest.json server/
```

The resulting file is structurally identical to what `mcpb pack`
produces — Smithery accepts it and the install flow works. We just
bypass the MCPB validator on the way out the door. Watch this if the
MCPB spec ever catches up (then we can use the official CLI again).

### 2. Default-unlisted after publish

Smithery hides new servers from search until you flip the visibility.
Fixed via:

```bash
curl -X PATCH https://api.smithery.ai/servers/sparkleofficialmain/scriptivox \
  -H "Authorization: Bearer $SMITHERY_API" \
  -d '{"unlisted": false}'
```

### 3. Metadata empty after first publish

The first release returned "No description, No capabilities, 28/100
score" because the bundle scanner can't run the server with
credentials to introspect tools, and Smithery's PATCH API is the
intended way to set most metadata. Fixed by PATCH-ing
`displayName`, `description`, `homepage`, `repositoryUrl`, `license`,
`backlinkUrl`, plus uploading an icon via `PUT /icon`. Tool list got
fixed by embedding the full 14-tool schema in `manifest.json#tools`
and republishing (per the workaround above).

## Verification status

- ✅ Homepage is set (`https://platform.scriptivox.com`)
- ✅ TXT record on `platform.scriptivox.com`
      (`smithery-verification=dff3497a0aa2ef064c095f094558e04be968f876b66a5e32920044d5cca2ded9`)
      added via Cloudflare DNS
- ⏳ Link to Smithery (backlink): added the Smithery README badge to
      `SparkleOfficial/scriptivox-mcp-server@98591cc`. If Smithery scans
      the README via `repositoryUrl`, this passes. If not, fallback is
      to add the badge to `scriptivox.com` SiteFooter and update the
      Smithery `backlinkUrl` field to `https://scriptivox.com`.
- ⏳ Screenshots (optional, score booster) — none yet
- ⏳ Vendor verification badge (the official-vendor checkmark) —
      pending completion of the above checks

## Where settings live

| Where | What | How to change |
|---|---|---|
| `manifest.json` in bundle | Tool list, user_config schema, server entry point, runtime, keywords | Edit, re-zip, republish (see below) |
| Smithery REST API (`PATCH /servers/...`) | displayName, description, homepage, repositoryUrl, backlinkUrl, license, iconUrl, unlisted | `curl -X PATCH ... -d '{...}'` |
| Smithery REST API (`PUT /servers/.../icon`) | Icon image (PNG/JPEG/SVG/WebP, ≤1 MB) | `curl -X PUT ... -F "icon=@file.png"` |
| Smithery dashboard | Verification flow, screenshots, badge variants | Web UI only |
| Cloudflare DNS | TXT record for verification | dash.cloudflare.com → scriptivox.com → DNS |

## Republish recipe

When the underlying npm package changes (e.g. we bump to 1.2.0):

```bash
# 1. Rebuild dist/ in mcp-server/
cd /Users/arshnoorsingh/Desktop/scriptivox-fresh/mcp-server
npm run build

# 2. Refresh the staging dir
rm -rf /tmp/scriptivox-bundle && mkdir -p /tmp/scriptivox-bundle/server
cp -r dist /tmp/scriptivox-bundle/server/
cp package.json package-lock.json /tmp/scriptivox-bundle/server/
cd /tmp/scriptivox-bundle/server && npm ci --omit=dev

# 3. Update manifest.json (bump "version", refresh "tools" if changed)
#    Keep all the embedded tool schemas — they need inputSchema for Smithery

# 4. Zip (bypass mcpb pack — see schema-conflict note above)
cd /tmp/scriptivox-bundle
zip -qr scriptivox.mcpb manifest.json server/

# 5. Publish
SMITHERY_API_KEY="$SMITHERY_API" smithery mcp publish ./scriptivox.mcpb \
  -n sparkleofficialmain/scriptivox
```

To refresh just the metadata without touching the bundle, skip steps
1–5 and PATCH the REST API.

## Auth notes

- Smithery CLI auth: `smithery auth login` (OAuth in browser), or
  `export SMITHERY_API_KEY=<token from smithery.ai/account/api-keys>`
- Our API key is in `.env.local` as `SMITHERY_API`
  (org-scoped, written for the `sparkleofficialmain` namespace)

## Cross-channel snapshot

| Channel | Status |
|---|---|
| npm `@scriptivox/mcp-server@1.1.1` | ✅ live |
| Docker Hub `:1.1.1` multi-arch | ✅ live |
| GitHub `SparkleOfficial/scriptivox-mcp-server` v1.1.1 | ✅ live |
| Docker MCP Catalog PR #3688 | 🔄 awaiting review |
| Smithery `sparkleofficialmain/scriptivox` | ✅ live |
| mcp.so + mcpservers.org | ✅ submitted |
| Official MCP Registry | ⏸ blocked on abhishek's private key |
