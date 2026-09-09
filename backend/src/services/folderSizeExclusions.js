const config = require('../config');
const { createPathExclusions } = require('./pathExclusions');

/**
 * Folders the recursive size calculation leaves alone.
 *
 * A Docker overlay tree or a snapshot directory is hundreds of thousands of
 * entries whose total nobody wants, and walking it is the whole cost of the
 * index. One list comes from the environment and the interface cannot edit it;
 * the other belongs to whoever administers the instance.
 */
module.exports = createPathExclusions({
  settingsCategory: 'system',
  settingsKey: 'folderSize',
  readEnvironmentPaths: () => config.folderSize.envExcludedPaths || [],
});
