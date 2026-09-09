import { describe, expect, it } from 'vitest';

// eslint-disable-next-line global-require
const {
  normalizeArchivePassword,
  isArchivePasswordError,
} = require('../../src/services/archiveService');

describe('archive service password handling', () => {
  it('accepts a short-lived password without transforming it', () => {
    expect(normalizeArchivePassword('correct horse battery staple')).toBe(
      'correct horse battery staple'
    );
    expect(normalizeArchivePassword('')).toBe('');
    expect(normalizeArchivePassword(undefined)).toBeNull();
  });

  it('rejects values that cannot safely be sent to the extractor prompt', () => {
    expect(() => normalizeArchivePassword('line one\nline two')).toThrow('Invalid archive password.');
    expect(() => normalizeArchivePassword('tab\tpassword')).toThrow('Invalid archive password.');
    expect(() => normalizeArchivePassword('x'.repeat(4097))).toThrow('Invalid archive password.');
    expect(() => normalizeArchivePassword({ secret: 'nope' })).toThrow('Invalid archive password.');
  });

  it('recognizes encrypted archive failures without exposing extractor output', () => {
    expect(isArchivePasswordError(new Error('ERROR: Wrong password : secret.7z'))).toBe(true);
    expect(isArchivePasswordError(new Error('Data Error in encrypted file. Wrong password?'))).toBe(
      true
    );
    expect(isArchivePasswordError(new Error('Enter password (will not be echoed):'))).toBe(true);
    expect(isArchivePasswordError(new Error('Unexpected end of archive'))).toBe(false);
  });
});

describe('archive extraction size guard', () => {
  it('aborts an extraction that outgrows the limit even without a usable listing', async (ctx) => {
    const os = require('node:os');
    const path = require('node:path');
    const fs = require('node:fs/promises');
    const { extractArchive, isSevenZipAvailable } = require('../../src/services/archiveService');

    if (!(await isSevenZipAvailable())) {
      // The guard only applies to the 7-Zip path; the JS fallback is bounded
      // by its own declared-size check in the route. Skip rather than pass,
      // so a machine without 7-Zip does not report this as covered.
      ctx.skip();
      return;
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-size-guard-'));
    try {
      const source = path.join(root, 'payload');
      await fs.mkdir(source);
      // Highly compressible content: small archive, large expansion.
      await fs.writeFile(path.join(source, 'big.bin'), Buffer.alloc(8 * 1024 * 1024, 0));

      const archive = path.join(root, 'payload.zip');
      const { createZipArchive } = require('../../src/services/archiveService');
      await createZipArchive([source], archive, undefined, {});

      const destination = path.join(root, 'out');
      await fs.mkdir(destination);

      await expect(
        extractArchive(archive, destination, undefined, { maxBytes: 1024 })
      ).rejects.toThrow(/allowed size/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
