#!/usr/bin/env node
// ============================================================================
// Build the distributable the partners actually install.
//
//   node scripts/build-sdk.mjs
//
// The readable source lives in sdk/ (the team edits it, the tests run against
// it). What a mini-program vendors is NOT that source: it is a single bundled,
// obfuscated file under dist/sdk/, so a partner cannot read or patch the SDK
// in place. The build is deterministic — a fixed seed and pinned tool versions
// — so CI can rebuild it and prove the committed dist matches the source.
//
// Steps:
//   1. keep sdk/VERSION and sdk/index.js's VERSION in step with package.json;
//   2. bundle the sdk/index.js graph into one ESM file (esbuild, minified),
//      which inlines every module and mangles all internal names;
//   3. obfuscate that bundle (javascript-obfuscator): string array, control
//      flow flattening, number expressions — the public export names and the
//      host payload strings are preserved, only made unreadable, never changed;
//   4. write dist/sdk/index.js and dist/sdk/VERSION.
//
// The manifest (dist/sdk/manifest.json) is written by scripts/build-manifest.mjs
// AFTER this, over the obfuscated output.
// ============================================================================

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC_DIR = join(ROOT, 'sdk');
const SRC_INDEX = join(SRC_DIR, 'index.js');
const DIST_DIR = join(ROOT, 'dist', 'sdk');
const DIST_INDEX = join(DIST_DIR, 'index.js');

// A fixed seed makes the obfuscation reproducible: the same source always
// yields the same bytes, so CI can rebuild dist/ and diff it against what was
// committed. Bump it only on purpose.
const OBFUSCATION_SEED = 20261030;

/**
 * Obfuscator options tuned for a vendored mini-program module.
 *
 * `renameGlobals` is OFF so the module's export bindings survive (the app does
 * `import { miniSDK } from './sdk/index.js'`). String *values* are encoded but
 * decoded back to the exact same strings at runtime, so host payload keys like
 * `nom_marchand`, `caction` and the `merchantPay` api name are preserved to the
 * byte. `transformObjectKeys` stays OFF for the same reason — belt and braces.
 */
const OBFUSCATOR_OPTIONS = {
  target: 'browser',
  seed: OBFUSCATION_SEED,
  compact: true,
  renameGlobals: false,
  identifierNamesGenerator: 'mangled-shuffled',
  simplify: true,
  numbersToExpressions: true,
  stringArray: true,
  stringArrayThreshold: 0.8,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  splitStrings: true,
  splitStringsChunkLength: 8,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

const main = async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  // 1. Version source of truth: package.json → sdk/VERSION + the VERSION const.
  await writeFile(join(SRC_DIR, 'VERSION'), `${version}\n`);
  const srcIndex = await readFile(SRC_INDEX, 'utf8');
  const srcIndexNext = srcIndex.replace(
    /export const VERSION = '[^']*';/,
    `export const VERSION = '${version}';`
  );
  if (srcIndex !== srcIndexNext) {
    await writeFile(SRC_INDEX, srcIndexNext);
  }

  // 2. Bundle the whole graph into one minified ESM file.
  const bundled = await build({
    entryPoints: [SRC_INDEX],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2019',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    write: false,
  });
  const code = bundled.outputFiles[0].text;

  // 3. Obfuscate the bundle.
  const obfuscated = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS).getObfuscatedCode();

  // 4. Emit dist/sdk/.
  await rm(join(ROOT, 'dist'), { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  const header =
    `// @sonatel-os/maxit-mini-sdk ${version} — generated, obfuscated bundle. Do not edit.\n` +
    `// Source: https://github.com/LPIX-11/-sonatel-os-maxit-mini-sdk (readable sdk/).\n`;
  await writeFile(DIST_INDEX, `${header}${obfuscated}\n`);
  await writeFile(join(DIST_DIR, 'VERSION'), `${version}\n`);

  console.log(
    `✔ built dist/sdk/index.js (${version}, ${obfuscated.length} bytes obfuscated, seed ${OBFUSCATION_SEED})`
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
