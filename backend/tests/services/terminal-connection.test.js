import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * The connection, end to end, with a real shell.
 *
 * Everything here runs against a real HTTP server, a real WebSocket client and
 * — for the last group — a real pseudo-terminal. Nothing stands in for
 * `node-pty`: a fake would raise the coverage of this file without adding one
 * guarantee, and the guarantee wanted is precisely that a shell starts, answers
 * and stops.
 *
 * The refusals matter more than the success. A connection carrying no token,
 * one that was never issued, or one already used must be closed before any
 * shell exists.
 */

/** The byte the application prefixes to a control frame, so it is not typing. */
const CONTROL_PREFIX = '\u001e';

let currentEnv;
let server;
let sockets = [];

const start = async () => {
  currentEnv = await setupTestEnv({
    tag: 'terminal-conn-',
    modules: ['src/services/terminalService'],
  });
  const terminal = currentEnv.requireFresh('src/services/terminalService');
  terminal.initialize({ enabled: true });

  server = http.createServer();
  // The loopback address by name: a bare `listen(0)` binds the wildcard, and
  // the kernel may hand out a port something else already holds on 127.0.0.1.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const wss = terminal.createWebSocketServer(server);
  expect(wss).not.toBeNull();

  return { terminal, port: server.address().port };
};

const connect = (port, token) => {
  const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal${query}`);
  sockets.push(ws);
  return ws;
};

const closedWith = (ws) =>
  new Promise((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: String(reason || '') }));
  });

/** Everything the shell sends, minus the control frames the application adds. */
const shellOutput = (ws, until, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(
      () => reject(new Error(`never saw ${until}; saw ${JSON.stringify(seen)}`)),
      timeoutMs
    );
    ws.on('message', (raw) => {
      const text = Buffer.from(raw).toString('utf8');
      if (text.startsWith(CONTROL_PREFIX)) return;
      seen += text;
      if (seen.includes(until)) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
  });

afterEach(async () => {
  for (const ws of sockets) {
    try {
      ws.terminate();
    } catch (_) {
      // Already gone.
    }
  }
  sockets = [];
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (currentEnv) {
    const terminal = currentEnv.loaded?.('src/services/terminalService');
    try {
      terminal?.cleanup?.();
    } catch (_) {
      // Nothing running.
    }
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

describe('a connection with no right to be here', () => {
  it('is closed when it carries no token', async () => {
    const { port } = await start();

    expect((await closedWith(connect(port))).code).toBe(1008);
  });

  it('is closed when the token was never issued', async () => {
    const { port } = await start();

    expect((await closedWith(connect(port, 'a'.repeat(64)))).code).toBe(1008);
  });

  it('says why', async () => {
    const { port } = await start();

    expect((await closedWith(connect(port, 'nope'))).reason).toMatch(/invalid or expired/i);
  });

  /**
   * The single-use rule, end to end. A token travels in the URL — the part of a
   * request that reaches proxy logs and browser history — so opening a second
   * shell with the same one has to be impossible from outside, not only in the
   * map that holds it.
   */
  it('is closed when the token has already opened a shell', async () => {
    const { terminal, port } = await start();
    const token = terminal.createSessionToken({ id: 'admin-1', roles: ['admin'] });

    const first = connect(port, token);
    await new Promise((resolve) => first.on('open', resolve));

    expect((await closedWith(connect(port, token))).code).toBe(1008);
  });

  it('starts no shell for a connection it refused', async () => {
    const { terminal, port } = await start();

    await closedWith(connect(port, 'nope'));

    expect(terminal.terminals.size).toBe(0);
  });
});

describe('a connection that is allowed through', () => {
  const withShell = async () => {
    const { terminal, port } = await start();
    // A predictable shell rather than whatever the machine running the tests
    // happens to prefer.
    process.env.SHELL = '/bin/sh';
    const token = terminal.createSessionToken({ id: 'admin-1', roles: ['admin'] });
    const ws = connect(port, token);
    await new Promise((resolve) => ws.on('open', resolve));
    return { terminal, ws };
  };

  it('starts a shell', async () => {
    const { terminal } = await withShell();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(terminal.terminals.size).toBe(1);
  });

  /** The whole point: what is typed reaches a shell, and its answer comes back. */
  it('runs what is typed and sends the answer back', async () => {
    const { ws } = await withShell();
    const waiting = shellOutput(ws, 'nextexplorer-was-here');

    ws.send('echo nextexplorer-was-here\n');

    expect(await waiting).toContain('nextexplorer-was-here');
  });

  it('forgets the shell when the connection goes away', async () => {
    const { terminal, ws } = await withShell();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(terminal.terminals.size).toBe(1);

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(terminal.terminals.size).toBe(0);
  });

  /** A malformed control frame must not take the shell down with it. */
  it('survives a control message that is not valid JSON', async () => {
    const { ws } = await withShell();
    const waiting = shellOutput(ws, 'still-alive');

    ws.send(`${CONTROL_PREFIX}{not json`);
    ws.send('echo still-alive\n');

    expect(await waiting).toContain('still-alive');
  });

  it('accepts a resize and keeps going', async () => {
    const { ws } = await withShell();
    const waiting = shellOutput(ws, 'after-resize');

    ws.send(`${CONTROL_PREFIX}${JSON.stringify({ type: 'resize', cols: 120, rows: 40 })}`);
    ws.send('echo after-resize\n');

    expect(await waiting).toContain('after-resize');
  });
});
