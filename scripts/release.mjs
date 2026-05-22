#!/usr/bin/env node
/**
 * Release helper for the Scriptivox MCP server.
 *
 * version.txt at the repo root is the single source of truth for the version.
 * This script:
 *   1. Reads version.txt
 *   2. Propagates that version into every place it lives:
 *        - package.json + package-lock.json   (via `npm version`)
 *        - server.json   (top-level version, npm package, OCI image tag)
 *   3. Runs a pre-flight TypeScript build (fails before anything is published)
 *   4. Publishes to each registry, asking for confirmation before each push so
 *      you can approve or skip them individually:
 *        - npm           @scriptivox/mcp-server
 *        - Docker Hub    docker.io/sparkleofficialmain/scriptivox-mcp-server
 *        - MCP Registry  com.scriptivox.www/transcription
 *        - GitHub        commit + tag + push, which is what triggers Smithery
 *                        (its GitHub-connected, npx-based listing serves latest npm)
 *
 * Package name, image name and server name are all derived from the existing
 * config files, so version.txt is the only thing you ever edit by hand.
 *
 * Usage:
 *   npm run release                       # sync, build, then confirm each push
 *   node scripts/release.mjs --sync-only  # only rewrite the version in files
 *   node scripts/release.mjs --yes        # non-interactive: approve every step
 *   node scripts/release.mjs --skip-tests # npm publish with --ignore-scripts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- MCP Registry auth config (not version-related; see memory mcp-registry-publishing) ---
const MCP_AUTH_DOMAIN = 'www.scriptivox.com';
const MCP_AUTH_ALGORITHM = 'ecdsap384';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const syncOnly = args.includes('--sync-only');
const autoYes = args.includes('--yes') || args.includes('-y');
const skipTests = args.includes('--skip-tests') || args.includes('--ignore-scripts');

const p = (...s) => join(repoRoot, ...s);
const run = (cmd) => execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
// Run a command for its exit code without throwing or printing (used for checks
// like "is anything staged?" and "does this tag already exist?").
const tryRun = (cmd) => {
  try {
    execSync(cmd, { cwd: repoRoot, stdio: 'ignore' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

function readVersion() {
  if (!existsSync(p('version.txt'))) {
    throw new Error('version.txt not found at repo root — create it with a single version line, e.g. 1.1.2');
  }
  // first non-empty, non-comment line wins
  const line = readFileSync(p('version.txt'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!line) throw new Error('version.txt is empty');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(line)) {
    throw new Error(`"${line}" in version.txt is not a valid semver version (expected e.g. 1.1.2)`);
  }
  return line;
}

function syncServerJson(version) {
  const file = p('server.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  for (const pkg of json.packages ?? []) {
    if (pkg.registryType === 'npm') pkg.version = version;
    // OCI identifier looks like docker.io/owner/name:1.1.0 — swap only the tag
    if (pkg.registryType === 'oci') pkg.identifier = pkg.identifier.replace(/:[^:/]*$/, `:${version}`);
  }
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return json;
}

// mcp-publisher login wants the raw EC private scalar as hex. Derive it from
// key.pem with Node's crypto (no openssl needed): the JWK 'd' field is the scalar.
function mcpPrivateKeyHex() {
  if (!existsSync(p('key.pem'))) {
    throw new Error('key.pem not found — cannot authenticate to the MCP Registry');
  }
  const { d } = createPrivateKey(readFileSync(p('key.pem'))).export({ format: 'jwk' });
  return Buffer.from(d, 'base64url').toString('hex');
}

async function main() {
  const version = readVersion();
  console.log(`\nScriptivox MCP release — version.txt = ${version}\n`);

  console.log('Syncing package.json + package-lock.json...');
  run(`npm version ${version} --no-git-tag-version --allow-same-version`);

  console.log('Syncing server.json...');
  const server = syncServerJson(version);

  const npmName = JSON.parse(readFileSync(p('package.json'), 'utf8')).name;
  const ociPkg = (server.packages ?? []).find((x) => x.registryType === 'oci');
  const image = ociPkg ? ociPkg.identifier.replace(/:[^:/]*$/, '') : null;
  const serverName = server.name;

  console.log('\nVersion is now set everywhere:');
  console.log(`  npm           ${npmName}@${version}`);
  if (image) console.log(`  Docker Hub    ${image}:${version}`);
  console.log(`  MCP Registry  ${serverName}@${version}`);
  console.log(`  Smithery      serves latest npm via GitHub-connected listing (push to GitHub to sync)`);
  console.log('\nReview the file changes with: git diff');

  if (syncOnly) {
    console.log('\n--sync-only: stopping before build/publish.');
    return;
  }

  console.log('\nPre-flight build (npm run build)...');
  run('npm run build');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q) => {
    if (autoYes) { console.log(`${q} [y/N] y  (--yes)`); return true; }
    return /^y(es)?$/.test((await rl.question(`${q} [y/N] `)).trim().toLowerCase());
  };
  const results = [];

  try {
    if (await ask(`\nPublish to npm (${npmName}@${version})?`)) {
      try {
        run(`npm publish --access public${skipTests ? ' --ignore-scripts' : ''}`);
        results.push(['npm', 'published']);
      } catch (e) {
        results.push(['npm', 'FAILED: ' + e.message]);
      }
    } else results.push(['npm', 'skipped']);

    if (image && (await ask(`Build & push Docker image (${image}:${version} + :latest)?`))) {
      try {
        run(`docker build -t ${image}:${version} -t ${image}:latest .`);
        run(`docker push ${image}:${version}`);
        run(`docker push ${image}:latest`);
        results.push(['docker', 'pushed']);
      } catch (e) {
        results.push(['docker', 'FAILED: ' + e.message]);
      }
    } else results.push(['docker', 'skipped']);

    if (await ask(`Publish to MCP Registry (${serverName}@${version})?`)) {
      try {
        // Absolute path — a bare "mcp-publisher.exe" isn't found by execSync's
        // cmd.exe shell even with cwd set.
        const publisher = join(repoRoot, process.platform === 'win32' ? 'mcp-publisher.exe' : 'mcp-publisher');
        run(`"${publisher}" login http --domain ${MCP_AUTH_DOMAIN} --algorithm ${MCP_AUTH_ALGORITHM} --private-key ${mcpPrivateKeyHex()}`);
        run(`"${publisher}" publish`);
        results.push(['mcp-registry', 'published']);
      } catch {
        // Do NOT print the error message: it echoes the login command, which
        // contains the private key. The real error is in the live output above.
        results.push(['mcp-registry', 'FAILED (see output above)']);
      }
    } else results.push(['mcp-registry', 'skipped']);

    // Smithery (GitHub auto-deploy): pushing the version bump is what reaches
    // the GitHub-connected listing. Because smithery.yaml runs npx unpinned,
    // Smithery already serves the latest npm — this push also keeps the repo
    // and smithery.yaml in sync and records the release tag.
    if (await ask(`Commit, tag (v${version}) & push to GitHub (updates Smithery)?`)) {
      try {
        // Stage everything not gitignored so the release commit is complete
        // (secrets — key.pem, .env, *token*.txt — are all gitignored).
        run('git add -A');
        if (tryRun('git diff --cached --quiet') !== 0) {
          run(`git commit -m "release ${version}"`);
        } else {
          console.log('  (nothing to commit — files already at this version)');
        }
        if (tryRun(`git tag -a v${version} -m "release ${version}"`) !== 0) {
          console.log(`  (tag v${version} already exists — keeping it)`);
        }
        run('git push --follow-tags');
        results.push(['github/smithery', 'pushed']);
      } catch (e) {
        results.push(['github/smithery', 'FAILED: ' + e.message]);
      }
    } else results.push(['github/smithery', 'skipped']);
  } finally {
    rl.close();
  }

  console.log('\nSummary:');
  for (const [name, status] of results) console.log(`  ${name.padEnd(16)} ${status}`);
  console.log('\nSmithery has no separate publish step — its GitHub-connected, npx-based');
  console.log('listing serves whatever is latest on npm. The GitHub push above is what');
  console.log('triggers it to re-sync.');
}

main().catch((err) => {
  console.error('\nRelease failed:', err.message);
  process.exit(1);
});
