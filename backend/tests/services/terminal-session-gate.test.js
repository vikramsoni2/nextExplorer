import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * The gate in front of a shell.
 *
 * The terminal hands somebody a shell on the host the application runs on, and
 * in a container that is often root. What stands between a request and that
 * shell is a one-time token, and until now nothing exercised any of it: the
 * service measured twenty per cent covered, the lowest in the application.
 *
 * These test the gate itself and nothing pretends to be a terminal. What is
 * deliberately not here is the pseudo-terminal's own lifecycle — data, resize,
 * exit — because standing a fake in for `node-pty` would raise the number
 * without adding a single guarantee. The end-to-end file beside this one spawns
 * a real shell instead.
 */

let currentEnv;

const load = async () => {
  currentEnv = await setupTestEnv({ tag: 'terminal-gate-', modules: ['src/services/terminalService'] });
  return currentEnv.requireFresh('src/services/terminalService');
};

const admin = { id: 'admin-1', roles: ['admin'] };
const ordinary = { id: 'user-1', roles: ['user'] };

afterEach(async () => {
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

describe('who may ask for a shell', () => {
  it('gives an administrator a token', async () => {
    const terminal = await load();

    expect(typeof terminal.createSessionToken(admin)).toBe('string');
  });

  it('refuses somebody who is not one', async () => {
    const terminal = await load();

    expect(() => terminal.createSessionToken(ordinary)).toThrow(/admin privileges/i);
  });

  it('refuses them with a forbidden rather than a failure', async () => {
    const terminal = await load();

    try {
      terminal.createSessionToken(ordinary);
      throw new Error('should have refused');
    } catch (error) {
      expect(error.status).toBe(403);
    }
  });

  it('refuses a request carrying no account at all', async () => {
    const terminal = await load();

    try {
      terminal.createSessionToken(null);
      throw new Error('should have refused');
    } catch (error) {
      expect(error.status).toBe(400);
    }
  });

  it('refuses an account whose roles are not a list', async () => {
    const terminal = await load();

    expect(() => terminal.createSessionToken({ id: 'x', roles: 'admin' })).toThrow(
      /admin privileges/i
    );
  });
});

describe('the token itself', () => {
  it('is long enough not to be guessed', async () => {
    const terminal = await load();

    expect(terminal.createSessionToken(admin)).toHaveLength(64);
  });

  it('is different every time', async () => {
    const terminal = await load();

    expect(terminal.createSessionToken(admin)).not.toBe(terminal.createSessionToken(admin));
  });

  it('remembers who asked for it', async () => {
    const terminal = await load();

    const session = terminal.validateSessionToken(terminal.createSessionToken(admin));

    expect(session).toMatchObject({ userId: 'admin-1', roles: ['admin'] });
  });

  it('carries the folder the terminal should open in', async () => {
    const terminal = await load();

    const session = terminal.validateSessionToken(
      terminal.createSessionToken(admin, { cwd: '/mnt/Docs' })
    );

    expect(session.cwd).toBe('/mnt/Docs');
  });

  it('carries no folder when none was asked for', async () => {
    const terminal = await load();

    expect(terminal.validateSessionToken(terminal.createSessionToken(admin)).cwd).toBeNull();
  });
});

describe('using a token', () => {
  /**
   * Once. A token travels in a URL, which is the part of a request that ends up
   * in proxy logs and browser history — so the second use of one must open
   * nothing.
   */
  it('works the first time', async () => {
    const terminal = await load();
    const token = terminal.createSessionToken(admin);

    expect(terminal.validateSessionToken(token)).not.toBeNull();
  });

  it('does not work the second time', async () => {
    const terminal = await load();
    const token = terminal.createSessionToken(admin);
    terminal.validateSessionToken(token);

    expect(terminal.validateSessionToken(token)).toBeNull();
  });

  it('does not work if it was never issued', async () => {
    const terminal = await load();

    expect(terminal.validateSessionToken('a'.repeat(64))).toBeNull();
  });

  it('does not work when there is no token at all', async () => {
    const terminal = await load();

    expect(terminal.validateSessionToken(null)).toBeNull();
    expect(terminal.validateSessionToken('')).toBeNull();
  });

  /** A token left in a tab overnight is not a way in the next morning. */
  it('does not work once it has expired', async () => {
    const terminal = await load();
    terminal.tokenTtlMs = 20;
    const token = terminal.createSessionToken(admin);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(terminal.validateSessionToken(token)).toBeNull();
  });

  it('is forgotten rather than kept once it has expired', async () => {
    const terminal = await load();
    terminal.tokenTtlMs = 20;
    const token = terminal.createSessionToken(admin);
    await new Promise((resolve) => setTimeout(resolve, 40));
    terminal.validateSessionToken(token);

    expect(terminal.sessionTokens.has(token)).toBe(false);
  });

  it('is still good just before it expires', async () => {
    const terminal = await load();
    terminal.tokenTtlMs = 60 * 1000;

    expect(terminal.validateSessionToken(terminal.createSessionToken(admin))).not.toBeNull();
  });
});

describe('the folder a terminal opens in', () => {
  it('is the one that was asked for when it is a folder', async () => {
    const terminal = await load();
    const dir = path.join(currentEnv.volumeDir, 'Work');
    await fs.mkdir(dir, { recursive: true });

    expect(await terminal.resolveWorkingDirectory({ absolutePath: dir })).toBe(dir);
  });

  /** A shell cannot open in a file, and saying so beats failing later. */
  it('is nothing when what was asked for is a file', async () => {
    const terminal = await load();
    const file = path.join(currentEnv.volumeDir, 'note.txt');
    await fs.writeFile(file, 'not a folder');

    expect(await terminal.resolveWorkingDirectory({ absolutePath: file })).toBeNull();
  });

  it('is nothing when nothing was asked for', async () => {
    const terminal = await load();

    expect(await terminal.resolveWorkingDirectory({})).toBeNull();
    expect(await terminal.resolveWorkingDirectory(undefined)).toBeNull();
  });
});

describe('whether the terminal is on at all', () => {
  it('is off when the configuration says so', async () => {
    const terminal = await load();

    expect(terminal.initialize({ enabled: false })).toBe(false);
    expect(terminal.isAvailable()).toBe(false);
  });

  it('is on when it is enabled and its dependency loads', async () => {
    const terminal = await load();

    expect(terminal.initialize({ enabled: true })).toBe(true);
    expect(terminal.isAvailable()).toBe(true);
  });

  it('stays on without loading its dependency twice', async () => {
    const terminal = await load();
    terminal.initialize({ enabled: true });
    const loaded = terminal.pty;

    expect(terminal.initialize({ enabled: true })).toBe(true);
    expect(terminal.pty).toBe(loaded);
  });

  /** Turning it off after it was on has to take effect, not linger. */
  it('goes off again when it is disabled afterwards', async () => {
    const terminal = await load();
    terminal.initialize({ enabled: true });

    terminal.initialize({ enabled: false });

    expect(terminal.isAvailable()).toBe(false);
  });

  it('starts no WebSocket server while it is off', async () => {
    const terminal = await load();
    terminal.initialize({ enabled: false });

    expect(terminal.createWebSocketServer({})).toBeNull();
  });
});
