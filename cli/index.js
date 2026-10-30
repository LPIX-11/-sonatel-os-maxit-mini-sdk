#!/usr/bin/env node
// ============================================================================
// maxit-mini-sdk — vendor or update the SDK folder inside a mini-program.
//
//   npx @sonatel-os/maxit-mini-sdk update            # latest release → ./sdk
//   npx @sonatel-os/maxit-mini-sdk update 1.2.0      # a given version
//   npx @sonatel-os/maxit-mini-sdk update --dir utils/sdk
//   npx @sonatel-os/maxit-mini-sdk check             # is an update available?
//   npx @sonatel-os/maxit-mini-sdk version           # what is installed here
//
// No dependency is added to the mini-program: npx runs this from its cache,
// and what lands in the project is the plain `sdk/` folder TCMPP packs.
// ============================================================================

import { mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import {
  API_BASE,
  DEFAULT_DIR,
  assertManifest,
  changelogBetween,
  compareVersions,
  rawUrl,
  tagOf,
  verifyFile,
} from './lib.js';

const USER_AGENT = 'maxit-mini-sdk-cli';

/** @param {string} message */
const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

/**
 * @param {string} url
 * @param {'json'|'text'|'buffer'} as
 * @returns {Promise<*>}
 */
const fetchAs = async (url, as) => {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  if (as === 'json') {
    return res.json();
  }
  if (as === 'text') {
    return res.text();
  }
  return Buffer.from(await res.arrayBuffer());
};

/**
 * Fetch the SDK manifest at a ref. The obfuscated build lives at
 * `dist/sdk/manifest.json`; older tags carried a readable `sdk/manifest.json`,
 * so fall back to that.
 * @param {string} ref
 * @returns {Promise<Object>}
 */
const fetchManifest = async (ref) => {
  try {
    return assertManifest(await fetchAs(rawUrl(ref, 'dist/sdk/manifest.json'), 'json'));
  } catch (_e) {
    return assertManifest(await fetchAs(rawUrl(ref, 'sdk/manifest.json'), 'json'));
  }
};

/**
 * Resolve the git ref to install: the latest release's tag, or the one asked.
 * @param {string} wanted - 'latest' | 'main' | 'vX.Y.Z'
 * @returns {Promise<string>}
 */
const resolveRef = async (wanted) => {
  if (wanted !== 'latest') {
    return wanted;
  }
  try {
    const release = await fetchAs(`${API_BASE}/releases/latest`, 'json');
    if (release && release.tag_name) {
      return release.tag_name;
    }
  } catch (_e) {
    // No release yet (a fresh repo): fall back to main.
  }
  return 'main';
};

/**
 * The version installed in `dir`, or null.
 * @param {string} dir
 * @returns {Promise<string|null>}
 */
const installedVersion = async (dir) => {
  try {
    return (await readFile(join(dir, 'VERSION'), 'utf8')).trim();
  } catch (_e) {
    return null;
  }
};

/**
 * Parse argv: `<command> [version] [--dir path] [--force]`.
 * @param {string[]} argv
 * @returns {{command: string, version: string, dir: string, force: boolean}}
 */
const parseArgs = (argv) => {
  const out = { command: argv[0] || 'help', version: 'latest', dir: DEFAULT_DIR, force: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') {
      out.dir = argv[i + 1] || out.dir;
      i += 1;
    } else if (a === '--force') {
      out.force = true;
    } else if (!a.startsWith('-')) {
      out.version = a;
    }
  }
  return out;
};

/**
 * Download every manifest file into a staging folder, verified.
 * @param {string} ref
 * @param {Object} manifest
 * @param {string} staging
 */
const download = async (ref, manifest, staging) => {
  for (const entry of manifest.files) {
    const content = await fetchAs(rawUrl(ref, entry.path), 'buffer');
    verifyFile(entry, content);
    const target = join(staging, entry.path.replace(/^(?:dist\/)?sdk\//, ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    console.log(`  ✓ ${entry.path}`);
  }
};

/**
 * Replace `dir` with `staging` atomically (rename), keeping a backup until done.
 * @param {string} staging
 * @param {string} dir
 */
const swap = async (staging, dir) => {
  const backup = `${dir}.previous`;
  await rm(backup, { recursive: true, force: true });
  if (existsSync(dir)) {
    await rename(dir, backup);
  }
  await rename(staging, dir);
  await rm(backup, { recursive: true, force: true });
};

const update = async ({ version, dir, force }) => {
  const target = resolve(process.cwd(), dir);
  const ref = await resolveRef(tagOf(version));
  console.log(`maxit-mini-sdk · ref ${ref} → ${dir}/`);

  const manifest = await fetchManifest(ref);
  const current = await installedVersion(target);
  if (current && !force && compareVersions(current, manifest.version) >= 0 && ref !== 'main') {
    console.log(`already at ${current} (manifest ${manifest.version}). Use --force to rewrite.`);
    return;
  }

  const staging = `${target}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await download(ref, manifest, staging);
    await swap(staging, target);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }

  console.log(`✔ ${current ? `${current} → ` : ''}${manifest.version} installed in ${dir}/`);
  try {
    const changelog = await fetchAs(rawUrl(ref, 'CHANGELOG.md'), 'text');
    const notes = changelogBetween(changelog, current, manifest.version);
    if (notes) {
      console.log(`\n${notes}\n`);
    }
  } catch (_e) {
    // The changelog is a courtesy.
  }
  const files = await readdir(target);
  if (!files.includes('index.js')) {
    fail('the installed folder has no index.js — the manifest is incomplete, report it');
  }
};

const check = async ({ dir }) => {
  const current = await installedVersion(resolve(process.cwd(), dir));
  const ref = await resolveRef('latest');
  const manifest = await fetchManifest(ref);
  if (!current) {
    console.log(`not installed in ${dir}/ — latest is ${manifest.version}`);
    process.exit(2);
  }
  if (compareVersions(current, manifest.version) < 0) {
    console.log(`update available: ${current} → ${manifest.version}`);
    process.exit(2);
  }
  console.log(`up to date: ${current}`);
};

const version = async ({ dir }) => {
  const current = await installedVersion(resolve(process.cwd(), dir));
  console.log(current || `not installed in ${dir}/`);
};

const help = () => {
  console.log(`maxit-mini-sdk — the Max It host SDK, vendored into your mini-program

  update [version] [--dir sdk] [--force]   install or update the sdk/ folder
  check  [--dir sdk]                       exit 2 when an update is available
  version [--dir sdk]                      print the installed version
`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const commands = { update, check, version, help, '--help': help, '-h': help };
  const run = commands[args.command];
  if (!run) {
    help();
    fail(`unknown command: ${args.command}`);
  }
  await run(args);
};

main().catch((err) => fail(err && err.message ? err.message : String(err)));
