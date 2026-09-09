const config = require('../config');
const { createPathExclusions } = require('./pathExclusions');

/**
 * Folders the search index has no business reading.
 *
 * Nothing is excluded by default. With the index answering in place of the
 * live content scan, a folder left out is a folder that cannot be found by
 * what is inside it — that decision belongs to whoever owns the volume, not to
 * a list of names someone thought looked like noise.
 */
module.exports = createPathExclusions({
  settingsCategory: 'system',
  settingsKey: 'searchIndex',
  readEnvironmentPaths: () => config.search?.index?.exclude || [],
});
