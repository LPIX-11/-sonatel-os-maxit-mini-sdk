import { describe, it, expect } from 'vitest';
import {
  tagOf,
  compareVersions,
  assertManifest,
  verifyFile,
  changelogBetween,
  sha256,
} from './lib.js';

describe('tagOf / compareVersions', () => {
  it('normalises tags and compares semver', () => {
    expect(tagOf('1.2.3')).toBe('v1.2.3');
    expect(tagOf('v1.2.3')).toBe('v1.2.3');
    expect(tagOf('latest')).toBe('latest');
    expect(tagOf(undefined)).toBe('latest');
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('v2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
  });
});

describe('assertManifest / verifyFile', () => {
  const good = {
    version: '0.1.0',
    files: [{ path: 'sdk/index.js', sha256: 'a'.repeat(64), bytes: 1 }],
  };

  it('accepts a well-formed manifest and refuses bad shapes and path escapes', () => {
    expect(assertManifest(good)).toBe(good);
    expect(() => assertManifest({})).toThrow(/files array/);
    expect(() => assertManifest({ version: 'x', files: [] })).toThrow(/version/);
    expect(() =>
      assertManifest({
        version: '1.0.0',
        files: [{ path: '../etc/passwd', sha256: 'a'.repeat(64) }],
      })
    ).toThrow(/refusing/);
    expect(() =>
      assertManifest({ version: '1.0.0', files: [{ path: 'a', sha256: 'zz' }] })
    ).toThrow(/bad entry/);
  });

  it('verifies a file by its hash', () => {
    const content = Buffer.from('hello');
    expect(() => verifyFile({ path: 'x', sha256: sha256(content) }, content)).not.toThrow();
    expect(() => verifyFile({ path: 'x', sha256: 'a'.repeat(64) }, content)).toThrow(/integrity/);
  });
});

describe('changelogBetween', () => {
  const log = `# Changelog\n\n## [0.3.0] - 2026-11\n- c\n\n## [0.2.0] - 2026-10\n- b\n\n## [0.1.0] - 2026-10\n- a\n`;

  it('picks the sections newer than the installed version, up to the target', () => {
    expect(changelogBetween(log, '0.1.0', '0.3.0')).toBe(
      '## [0.3.0] - 2026-11\n- c\n\n## [0.2.0] - 2026-10\n- b'
    );
    expect(changelogBetween(log, '0.2.0', '0.2.0')).toBe('');
    expect(changelogBetween(log, null, '0.1.0')).toBe('## [0.1.0] - 2026-10\n- a');
  });
});
