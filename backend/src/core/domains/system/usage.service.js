/**
 * Usage Service
 * Disk usage information for directories
 */

const { promisify } = require('util');
const { exec } = require('child_process');
const logger = require('../../../shared/logger/logger');

const execp = promisify(exec);

class UsageService {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  /**
   * Get directory size using du command (fast)
   */
  async getDirectorySize(absolutePath) {
    try {
      // -sb: summarize in bytes, don't follow symlinks
      const { stdout } = await execp(`du -sb "${absolutePath}"`, {
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer for large outputs
      });

      // Output format: "12345\t/path/to/dir"
      const size = parseInt(stdout.split('\t')[0], 10);
      return size || 0;
    } catch (error) {
      logger.debug({ error, path: absolutePath }, 'Failed to get directory size');
      return 0;
    }
  }

  /**
   * Get filesystem usage using df command
   */
  async getFilesystemUsage(absolutePath) {
    try {
      const { stdout } = await execp(`df -Pk "${absolutePath}"`);

      // Parse df output
      // Format:
      // Filesystem     1024-blocks      Used Available Capacity Mounted on
      // /dev/disk1s1     976490576 123456789 852033787    13%   /

      const line = stdout.trim().split('\n').pop();
      const parts = line.trim().split(/\s+/);

      const totalKb = parseInt(parts[1], 10) || 0;
      const availKb = parseInt(parts[3], 10) || 0;

      return {
        total: totalKb * 1024,
        free: availKb * 1024
      };
    } catch (error) {
      logger.debug({ error, path: absolutePath }, 'Failed to get filesystem usage');
      return {
        total: 0,
        free: 0
      };
    }
  }

  /**
   * Get usage information for path
   */
  async getUsage(relativePath = '') {
    const absolutePath = this.fileSystemService.resolvePath(relativePath);

    // Run both commands in parallel for maximum speed
    const [size, fsUsage] = await Promise.all([
      this.getDirectorySize(absolutePath),
      this.getFilesystemUsage(absolutePath)
    ]);

    return {
      path: relativePath,
      size,
      free: fsUsage.free,
      total: fsUsage.total
    };
  }
}

module.exports = UsageService;
