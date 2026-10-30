// ============================================================================
// CLI library — the pure parts of the updater, testable without network.
//
// Distribution model: the SDK is a FOLDER vendored into the mini-program
// (TCMPP packs the project folder; node_modules never ships). The repo
// publishes, per tag, `sdk/manifest.json` listing every file with its
// SHA-256. The updater fetches the manifest for the wanted tag, downloads
// each file from raw.githubusercontent.com, verifies every hash, and swaps
// the folder atomically. No tar, no dependencies, Node 18+.
// ============================================================================

import { createHash } from 'node:crypto';

export const REPO = 'LPIX-11/-sonatel-os-maxit-mini-sdk';
export const DEFAULT_DIR = 'sdk';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;
export const API_BASE = `https://api.github.com/repos/${REPO}`;

/**
 * @param {Buffer|string} content
 * @returns {string} lower-case hex sha256
 */
export const sha256 = (content) => createHash('sha256').update(content).digest('hex');

/**
 * `1.2.3` or `v1.2.3` → `v1.2.3`; `latest` and `main` pass through.
 * @param {string} version
 * @returns {string}
 */
export const tagOf = (version) => {
  const v = String(version || 'latest').trim();
  if (v === 'latest' || v === 'main') {
    return v;
  }
  return v.startsWith('v') ? v : `v${v}`;
};

/**
 * Compare two semver strings. Pre-release tags are ignored.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a < b
 */
export const compareVersions = (a, b) => {
  const parse = (v) =>
    String(v || '0')
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) {
      return (pa[i] || 0) - (pb[i] || 0);
    }
  }
  return 0;
};

/**
 * Check a manifest's shape.
 * @param {*} manifest
 * @returns {{version: string, files: Array<{path: string, sha256: string, bytes: number}>}}
 * @throws {Error}
 */
export const assertManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    throw new Error('manifest: not an object with a files array');
  }
  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    throw new Error('manifest: missing or malformed version');
  }
  manifest.files.forEach((f) => {
    if (!f || typeof f.path !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256 || '')) {
      throw new Error(`manifest: bad entry ${JSON.stringify(f)}`);
    }
    if (f.path.includes('..') || f.path.startsWith('/')) {
      throw new Error(`manifest: refusing path ${f.path}`);
    }
  });
  return manifest;
};

/**
 * Verify one downloaded file against its manifest entry.
 * @param {{path: string, sha256: string}} entry
 * @param {Buffer} content
 * @returns {void}
 * @throws {Error}
 */
export const verifyFile = (entry, content) => {
  const actual = sha256(content);
  if (actual !== entry.sha256) {
    throw new Error(
      `integrity: ${entry.path} expected ${entry.sha256.slice(0, 12)}… got ${actual.slice(0, 12)}…`
    );
  }
};

/**
 * The CHANGELOG sections strictly newer than `from`, up to and including `to`.
 * Sections start with `## [x.y.z]` or `## x.y.z`.
 * @param {string} changelog - the whole CHANGELOG.md
 * @param {string|null} from - the installed version (null = everything)
 * @param {string} to - the target version
 * @returns {string}
 */
export const changelogBetween = (changelog, from, to) => {
  const sections = String(changelog || '').split(/^(?=## )/m);
  const picked = sections.filter((section) => {
    const m = /^## \[?v?(\d+\.\d+\.\d+)/.exec(section);
    if (!m) {
      return false;
    }
    const v = m[1];
    return compareVersions(v, to) <= 0 && (!from || compareVersions(v, from) > 0);
  });
  return picked.join('').trim();
};

/**
 * The raw URL of one file at one ref.
 * @param {string} ref - tag or branch
 * @param {string} path - repo-relative
 * @returns {string}
 */
export const rawUrl = (ref, path) => `${RAW_BASE}/${ref}/${path}`;
