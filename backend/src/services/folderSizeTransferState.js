const path = require('path');

// Runtime coordination for directories currently being copied or moved. SQLite
// keeps the pending index entry; this set prevents refreshes from scanning a
// tree before its filesystem write has completed.
const activeDirectories = new Set();

const begin = (absolutePath) => {
  if (absolutePath) activeDirectories.add(absolutePath);
};

const finish = (absolutePath) => {
  if (absolutePath) activeDirectories.delete(absolutePath);
};

const isRelatedToActiveTransfer = (absolutePath) => {
  if (!absolutePath) return false;
  for (const activePath of activeDirectories) {
    if (
      absolutePath === activePath ||
      absolutePath.startsWith(`${activePath}${path.sep}`) ||
      activePath.startsWith(`${absolutePath}${path.sep}`)
    ) {
      return true;
    }
  }
  return false;
};

module.exports = {
  begin,
  finish,
  isRelatedToActiveTransfer,
};
