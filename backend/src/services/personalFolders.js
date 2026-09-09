const { getUserFolderNameCandidates } = require('../utils/pathUtils');
const logger = require('../utils/logger');

/**
 * One personal folder per account, and never someone else's.
 *
 * The folder an account gets is derived from `USER_FOLDER_NAME_ORDER`, and
 * nothing about that order guarantees a distinct answer per account. `username`
 * carries no uniqueness constraint — the original schema had one, the migrated
 * table does not, and an OIDC provider supplies the value as it pleases — while
 * `email_local` cannot be unique by construction: `bob@a.com` and `bob@b.com`
 * both yield `bob`. Two accounts that derive the same name are handed the same
 * directory, and each sees the other's private files.
 *
 * A default install is safe, since the default order puts `id` first and ids
 * are unique. But the environment reference recommends `username,id` outright,
 * to reuse an existing /home/<username> layout, and that is where the collision
 * lives.
 *
 * So the name is claimed rather than derived on the fly: the first account to
 * ask for `bob` keeps it, a second one walks down its own preference order to
 * the next free name, and `id` is always last in that order so the walk always
 * ends. The claim is stored on the account and a unique index enforces it, so
 * two requests racing cannot both win.
 *
 * What this deliberately does not do is refuse the login, or refuse the
 * configuration. Someone whose username collides still gets a folder — their
 * own — and the layout the documentation recommends keeps working for everyone
 * it works for today.
 */

/** Rows that already hold a name, so a candidate can be tested against them. */
const takenNames = (db, userId) => {
  const rows = db
    .prepare(
      'SELECT personal_folder_name AS name FROM users WHERE personal_folder_name IS NOT NULL AND id != ?'
    )
    .all(userId);
  return new Set(rows.map((row) => row.name));
};

/**
 * Give this account a folder name of its own, and answer it. Idempotent: an
 * account that already holds one keeps it.
 */
const claimPersonalFolderName = (db, user) => {
  if (!user?.id) return null;

  const held = user.personal_folder_name || user.personalFolderName;
  if (typeof held === 'string' && held.trim()) return held.trim();

  const taken = takenNames(db, user.id);
  const candidates = getUserFolderNameCandidates(user);

  for (const candidate of candidates) {
    if (taken.has(candidate)) continue;

    try {
      db.prepare('UPDATE users SET personal_folder_name = ? WHERE id = ?').run(candidate, user.id);

      if (candidate !== candidates[0]) {
        logger.warn(
          { userId: user.id, preferred: candidates[0], assigned: candidate },
          'Personal folder name was already taken by another account; assigned the next one'
        );
      }
      return candidate;
    } catch (error) {
      // The unique index refusing is another account winning the same name
      // between the read above and this write. Try the next candidate.
      if (!/UNIQUE constraint failed/i.test(error?.message || '')) throw error;
    }
  }

  // Unreachable while `id` is in the order — it is appended to every
  // configuration, and an id is unique — but a name is not worth an exception
  // on a login path.
  logger.error({ userId: user.id }, 'No personal folder name could be claimed');
  return null;
};

/**
 * Give every account a name, oldest first.
 *
 * Order matters on an instance that already has a collision: the account that
 * has been using the folder is the one that keeps it, rather than whoever
 * happens to sign in first after the upgrade.
 */
const claimAllPersonalFolderNames = (db) => {
  const rows = db
    .prepare(
      `SELECT id, email, username, display_name, personal_folder_name
       FROM users
       WHERE personal_folder_name IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .all();

  let claimed = 0;
  for (const row of rows) {
    if (claimPersonalFolderName(db, row)) claimed += 1;
  }
  return claimed;
};

module.exports = { claimPersonalFolderName, claimAllPersonalFolderNames };
