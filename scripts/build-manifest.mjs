#!/usr/bin/env node
// ============================================================================
// Build sdk/manifest.json — the file list + SHA-256 the updater verifies —
// and keep sdk/VERSION and sdk/index.js's VERSION in step with package.json.
//
//   node scripts/build-manifest.mjs           # write
//   node scripts/build-manifest.mjs --check   # fail if anything is stale (CI)
// ============================================================================

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SDK_DIR = join(ROOT, 'sdk');
const MANIFEST = join(SDK_DIR, 'manifest.json');
const check = process.argv.includes('--check');

/** Files that are part of the repo but never vendored. */
const EXCLUDED = (path) => /\.test\.js$/.test(path) || path.endsWith('manifest.json');

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

  const files = [];
  for (const full of (await walk(SDK_DIR)).sort()) {
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

  const manifest = { version, generatedAt: new Date().toISOString(), files };
  const next = `${JSON.stringify(manifest, null, 2)}\n`;

  const versionFile = `${version}\n`;
  const indexPath = join(SDK_DIR, 'index.js');
  const index = await readFile(indexPath, 'utf8');
  const indexNext = index.replace(
    /export const VERSION = '[^']*';/,
    `export const VERSION = '${version}';`
  );

  if (check) {
    const problems = [];
    let current = null;
    try {
      current = JSON.parse(await readFile(MANIFEST, 'utf8'));
    } catch (_e) {
      problems.push('sdk/manifest.json is missing');
    }
    if (current) {
      const same =
        current.version === version && JSON.stringify(current.files) === JSON.stringify(files);
      if (!same) {
        problems.push('sdk/manifest.json is stale — run `yarn manifest`');
      }
    }
    if ((await readFile(join(SDK_DIR, 'VERSION'), 'utf8')) !== versionFile) {
      problems.push('sdk/VERSION differs from package.json');
    }
    if (index !== indexNext) {
      problems.push('sdk/index.js VERSION differs from package.json');
    }
    if (problems.length) {
      problems.forEach((p) => console.error(`✖ ${p}`));
      process.exit(1);
    }
    console.log(`✔ manifest fresh (${files.length} files, ${version})`);
    return;
  }

  await writeFile(MANIFEST, next);
  await writeFile(join(SDK_DIR, 'VERSION'), versionFile);
  if (index !== indexNext) {
    await writeFile(indexPath, indexNext);
  }
  console.log(`✔ wrote sdk/manifest.json (${files.length} files, ${version})`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
