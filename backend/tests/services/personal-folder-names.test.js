import { describe, it, expect, afterEach } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * Two accounts could be handed the same personal folder, and each would see
 * the other's private files.
 *
 * `USER_FOLDER_NAME_ORDER` decides which field names the folder, and nothing
 * about that order guarantees a distinct answer: `username` carries no
 * uniqueness constraint, and `bob@a.com` and `bob@b.com` both yield `bob`
 * under `email_local`. A default install is safe — `id` comes first and ids
 * are unique — but the environment reference recommends `username,id` to reuse
 * an existing /home/<username> layout, which is exactly where it bites.
 */

let envContext;

const build = async (env = {}) => {
  envContext = await setupTestEnv({ tag: 'personal-folders-', env });
  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  const { claimPersonalFolderName } = envContext.requireFresh('src/services/personalFolders');
  const { getUserFolderName } = envContext.requireFresh('src/utils/pathUtils');
  return { db, claimPersonalFolderName, getUserFolderName };
};

/** An account, created at a given moment so the order between them is fixed. */
const addUser = (db, { id, email, username, createdAt }) => {
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, '["user"]', ?, ?)`
  ).run(id, email, username, username, createdAt, createdAt);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
};

const nameOf = (db, id) =>
  db.prepare('SELECT personal_folder_name AS name FROM users WHERE id = ?').get(id).name;

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('the folder an account owns', () => {
  it('gives the preferred name to whoever asks first', async () => {
    const { db, claimPersonalFolderName } = await build({ USER_FOLDER_NAME_ORDER: 'username,id' });
    const first = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(claimPersonalFolderName(db, first)).toBe('bob');
    expect(nameOf(db, 'u-1')).toBe('bob');
  });

  // The collision the review found, and what it costs: without this the second
  // account resolves to the first account's directory.
  it('does not give the same name twice', async () => {
    const { db, claimPersonalFolderName } = await build({ USER_FOLDER_NAME_ORDER: 'username,id' });
    const first = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const second = addUser(db, {
      id: 'u-2',
      email: 'bob@b.com',
      username: 'bob',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    claimPersonalFolderName(db, first);
    const assigned = claimPersonalFolderName(db, second);

    expect(assigned).not.toBe('bob');
    expect(assigned).toBe('u-2');
    expect(nameOf(db, 'u-1')).toBe('bob');
  });

  // `email_local` cannot be made unique — two domains, one local part — so a
  // constraint on `username` alone would not have covered this.
  it('separates two accounts whose email local parts match', async () => {
    const { db, claimPersonalFolderName } = await build({
      USER_FOLDER_NAME_ORDER: 'email_local,id',
    });
    const first = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob-a',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const second = addUser(db, {
      id: 'u-2',
      email: 'bob@b.com',
      username: 'bob-b',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    expect(claimPersonalFolderName(db, first)).toBe('bob');
    expect(claimPersonalFolderName(db, second)).not.toBe('bob');
  });

  it('keeps the name an account already holds', async () => {
    const { db, claimPersonalFolderName } = await build({ USER_FOLDER_NAME_ORDER: 'username,id' });
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    claimPersonalFolderName(db, user);
    const again = claimPersonalFolderName(
      db,
      db.prepare('SELECT * FROM users WHERE id = ?').get('u-1')
    );

    expect(again).toBe('bob');
  });

  // A renamed account does not move house: the folder it has been using is
  // the one it keeps.
  it('does not follow a username change', async () => {
    const { db, claimPersonalFolderName, getUserFolderName } = await build({
      USER_FOLDER_NAME_ORDER: 'username,id',
    });
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    claimPersonalFolderName(db, user);

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('robert', 'u-1');
    const renamed = db.prepare('SELECT * FROM users WHERE id = ?').get('u-1');

    expect(
      getUserFolderName({ ...renamed, personalFolderName: renamed.personal_folder_name })
    ).toBe('bob');
  });

  it('leaves a default install exactly as it was', async () => {
    const { db, claimPersonalFolderName } = await build();
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // The shipped order puts `id` first, and ids are unique.
    expect(claimPersonalFolderName(db, user)).toBe('u-1');
  });
});

// The check before the write is an optimisation; this is the guarantee. Two
// requests racing past that check land here, and the loser walks on to its next
// candidate rather than sharing a folder.
describe('the constraint underneath', () => {
  it('refuses two accounts the same folder name outright', async () => {
    const { db } = await build({ USER_FOLDER_NAME_ORDER: 'username,id' });
    addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    addUser(db, {
      id: 'u-2',
      email: 'bob@b.com',
      username: 'bob',
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    db.prepare('UPDATE users SET personal_folder_name = ? WHERE id = ?').run('bob', 'u-1');

    expect(() =>
      db.prepare('UPDATE users SET personal_folder_name = ? WHERE id = ?').run('bob', 'u-2')
    ).toThrow(/UNIQUE/i);
  });

  // Unclaimed accounts must not collide with each other, or the index would
  // stop the second one from being created at all.
  it('lets any number of accounts hold no name yet', async () => {
    const { db } = await build();
    addUser(db, {
      id: 'u-1',
      email: 'a@example.com',
      username: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    addUser(db, {
      id: 'u-2',
      email: 'b@example.com',
      username: 'b',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    db.prepare('UPDATE users SET personal_folder_name = NULL').run();
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE personal_folder_name IS NULL').get().n
    ).toBe(2);
  });
});

describe('accounts that existed before the names did', () => {
  // Which of two colliding accounts keeps the folder cannot be left to whoever
  // signs in first after an upgrade: the one that has been using it wins.
  it('gives the name to the older account', async () => {
    envContext = await setupTestEnv({
      tag: 'personal-folders-backfill-',
      env: { USER_FOLDER_NAME_ORDER: 'username,id' },
    });
    const dbService = envContext.requireFresh('src/services/db');
    const db = await dbService.getDb();
    const { claimAllPersonalFolderNames } = envContext.requireFresh('src/services/personalFolders');

    addUser(db, {
      id: 'u-new',
      email: 'bob@b.com',
      username: 'bob',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    addUser(db, {
      id: 'u-old',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    db.prepare('UPDATE users SET personal_folder_name = NULL').run();

    expect(claimAllPersonalFolderNames(db)).toBe(2);
    expect(nameOf(db, 'u-old')).toBe('bob');
    expect(nameOf(db, 'u-new')).toBe('u-new');
  });
});

/**
 * The two paths that only open when something goes wrong between the read and
 * the write.
 *
 * `claimPersonalFolderName` reads the names already taken, then writes the
 * first free one. Two accounts signing in at the same moment both read the same
 * answer, and the unique index is what stops them both keeping it — the loser
 * gets an exception and has to walk on to its next candidate. Neither that
 * recovery nor the give-up after it had ever run.
 *
 * The database is handed in, so a test can be the thing that goes wrong: a
 * wrapper that refuses the writes it is told to refuse and passes everything
 * else through untouched.
 */
describe('two accounts racing for the same name', () => {
  /** A database that refuses the first `n` name writes the way the index does. */
  const refusingWrites = (db, refusals) => ({
    prepare: (sql) => {
      const statement = db.prepare(sql);
      if (!/UPDATE users SET personal_folder_name/i.test(sql)) return statement;
      return {
        ...statement,
        run: (...args) => {
          if (refusals.count > 0) {
            refusals.count -= 1;
            throw new Error('UNIQUE constraint failed: users.personal_folder_name');
          }
          return statement.run(...args);
        },
        all: (...args) => statement.all(...args),
        get: (...args) => statement.get(...args),
      };
    },
  });

  it('walks on to the next name when the index refuses the first', async () => {
    const { db, claimPersonalFolderName } = await build({
      USER_FOLDER_NAME_ORDER: 'username,id',
    });
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    user.personal_folder_name = null;

    const claimed = claimPersonalFolderName(refusingWrites(db, { count: 1 }), user);

    expect(claimed).toBe('u-1');
  });

  it('records the name it settled on', async () => {
    const { db, claimPersonalFolderName } = await build({
      USER_FOLDER_NAME_ORDER: 'username,id',
    });
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    user.personal_folder_name = null;

    claimPersonalFolderName(refusingWrites(db, { count: 1 }), user);

    expect(nameOf(db, 'u-1')).toBe('u-1');
  });

  /**
   * An error that is not the index refusing is not a race, and swallowing it
   * would turn a broken database into a silent wrong answer.
   */
  it('does not mistake another failure for a lost race', async () => {
    const { db, claimPersonalFolderName } = await build();
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    user.personal_folder_name = null;
    const broken = {
      prepare: (sql) => {
        const statement = db.prepare(sql);
        if (!/UPDATE users SET personal_folder_name/i.test(sql)) return statement;
        return {
          ...statement,
          run: () => {
            throw new Error('database is locked');
          },
          all: (...args) => statement.all(...args),
          get: (...args) => statement.get(...args),
        };
      },
    };

    expect(() => claimPersonalFolderName(broken, user)).toThrow(/database is locked/i);
  });

  /**
   * Unreachable while `id` is in the order, which it always is. Losing every
   * race is still not worth an exception on a sign-in path: the account gets no
   * name, and the caller derives one as it did before any of this existed.
   */
  it('gives up quietly when every candidate is refused', async () => {
    const { db, claimPersonalFolderName } = await build();
    const user = addUser(db, {
      id: 'u-1',
      email: 'bob@a.com',
      username: 'bob',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    user.personal_folder_name = null;

    const claimed = claimPersonalFolderName(refusingWrites(db, { count: 99 }), user);

    expect(claimed).toBeNull();
  });
});

describe('an account with nothing to identify it', () => {
  it('is given no name at all', async () => {
    const { db, claimPersonalFolderName } = await build();

    expect(claimPersonalFolderName(db, {})).toBeNull();
    expect(claimPersonalFolderName(db, null)).toBeNull();
  });
});
