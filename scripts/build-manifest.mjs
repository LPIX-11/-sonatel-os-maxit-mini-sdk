#!/usr/bin/env node
// ============================================================================
// Build dist/sdk/manifest.json — the file list + SHA-256 the updater verifies
// — over the OBFUSCATED distributable (dist/sdk/), not the source. Run it after
// scripts/build-sdk.mjs.
//
//   node scripts/build-manifest.mjs           # write
//   node scripts/build-manifest.mjs --check   # fail if stale (CI)
//
// `--check` hashes the committed dist/sdk/ files and compares them to the
// committed manifest. It never rebuilds, so it is deterministic regardless of
// the obfuscator; CI proves dist matches the source separately, by rebuilding
// and diffing (see .github/workflows/ci.yml).
// ============================================================================

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST_DIR = join(ROOT, 'dist', 'sdk');
const MANIFEST = join(DIST_DIR, 'manifest.json');
const check = process.argv.includes('--check');

/** The manifest describes everything in dist/sdk except the manifest itself. */
const EXCLUDED = (path) => path.endsWith('manifest.json');

const walk = async (dir) => {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
};

const main = async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  let entries;
  try {
    entries = (await walk(DIST_DIR)).sort();
  } catch (_e) {
    console.error('✖ dist/sdk is missing — run `yarn build` first');
    process.exit(1);
  }

  const files = [];
  for (const full of entries) {
    // Paths are repo-relative (dist/sdk/index.js): the updater fetches them
    // raw at a tag and strips the dist/sdk/ prefix to place them in ./sdk.
    const path = relative(ROOT, full);
    if (EXCLUDED(path)) {
      continue;
    }
    const content = await readFile(full);
    files.push({
      path,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.length,
    });
  }

  // No timestamp: the manifest must be byte-reproducible so CI can rebuild it
  // and diff it against what was committed.
  const manifest = { version, files };
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  const distVersion = `${version}\n`;

  if (check) {
    const problems = [];
    let current = null;
    try {
      current = JSON.parse(await readFile(MANIFEST, 'utf8'));
    } catch (_e) {
      problems.push('dist/sdk/manifest.json is missing — run `yarn build && yarn manifest`');
    }
    if (current) {
      const same =
        current.version === version && JSON.stringify(current.files) === JSON.stringify(files);
      if (!same) {
        problems.push('dist/sdk/manifest.json is stale — run `yarn manifest`');
      }
    }
    try {
      if ((await readFile(join(DIST_DIR, 'VERSION'), 'utf8')) !== distVersion) {
        problems.push('dist/sdk/VERSION differs from package.json');
      }
    } catch (_e) {
      problems.push('dist/sdk/VERSION is missing');
    }
    if (problems.length) {
      problems.forEach((p) => console.error(`✖ ${p}`));
      process.exit(1);
    }
    console.log(`✔ manifest fresh (${files.length} files, ${version})`);
    return;
  }

  await writeFile(MANIFEST, next);
  console.log(`✔ wrote dist/sdk/manifest.json (${files.length} files, ${version})`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
