/**
 * Volumes Service
 * List available volumes
 */

const fs = require('fs').promises;
const config = require('../../../shared/config');
const logger = require('../../../shared/logger/logger');

class VolumesService {
  constructor() {
    this.volumeRoot = config.directories.volume;
    this.excludedFiles = config.excludedFiles || [];
  }

  /**
   * Get list of volumes
   */
  async getVolumes() {
    try {
      const entries = await fs.readdir(this.volumeRoot, { withFileTypes: true });

      const volumes = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !this.excludedFiles.includes(name))
        .map((name) => ({
          name,
          path: name,
          kind: 'volume',
        }));

      return volumes;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch volumes');
      throw error;
    }
  }
}

module.exports = VolumesService;
