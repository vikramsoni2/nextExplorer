import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * Names a path is allowed to be made of.
 *
 * The NUL check is the one worth pinning, and not only for what it refuses. It
 * used to be written as a literal NUL byte inside the string, which is valid
 * JavaScript and does exactly the right thing — but it also made git classify
 * the whole file as binary, so `git diff` showed `Bin 13871 -> 25738 bytes`
 * for every change to it and no review of this file could see a single line.
 *
 * Written as `'\0'` it is the same check, and the file is text again.
 */

let envContext;
let pathUtils;

beforeAll(async () => {
  envContext = await setupTestEnv({ tag: 'valid-name-test-' });
  pathUtils = envContext.requireFresh('src/utils/pathUtils');
});

afterAll(async () => {
  await envContext.cleanup();
});

const NUL = String.fromCharCode(0);

describe('the name a file may be given', () => {
  it('is returned unchanged when there is nothing wrong with it', () => {
    expect(pathUtils.ensureValidName('rapport.docx')).toBe('rapport.docx');
  });

  /**
   * A NUL truncates the path at the system call, so `photo\0.txt` reaches the
   * filesystem as `photo` — a name the caller never asked for, and one that
   * may already exist.
   */
  it('cannot contain a NUL byte', () => {
    expect(() => pathUtils.ensureValidName(`photo${NUL}.txt`)).toThrow(/invalid characters/i);
  });

  it('cannot contain a path separator', () => {
    expect(() => pathUtils.ensureValidName('a/b.txt')).toThrow();
  });

  it('cannot be empty', () => {
    expect(() => pathUtils.ensureValidName('')).toThrow();
    expect(() => pathUtils.ensureValidName('   ')).toThrow();
  });
});

describe('the file this check lives in', () => {
  /**
   * A single byte decides whether every future diff of this file is readable.
   * Cheap to assert, and it says why the escape is there so nobody writes the
   * literal back.
   */
  it('holds no control byte that would make git call it binary', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', '..', 'src', 'utils', 'pathUtils.js'));

    const offenders = [...source].filter((byte) => byte < 9 || (byte > 13 && byte < 32));

    expect(offenders).toEqual([]);
  });
});
