/**
 * Editor Service
 * Read and write text files
 */

const { ValidationError, FileNotFoundError } = require('../../../shared/errors');
const logger = require('../../../shared/logger/logger');

class EditorService {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
    this.maxFileSize = 10 * 1024 * 1024; // 10MB max for text editing
  }

  /**
   * Read file content
   */
  async readFile(relativePath) {
    // Check if file exists
    if (!(await this.fileSystemService.exists(relativePath))) {
      throw new FileNotFoundError(relativePath);
    }

    // Check if it's a file (not directory)
    const stats = await this.fileSystemService.stat(relativePath);
    if (stats.isDirectory()) {
      throw new ValidationError('Cannot read directory as file');
    }

    // Check file size
    if (stats.size > this.maxFileSize) {
      throw new ValidationError(`File too large for editing (max ${this.maxFileSize / 1024 / 1024}MB)`);
    }

    try {
      const content = await this.fileSystemService.readFile(relativePath);

      // Detect encoding and check if it's a text file
      if (!this.isTextContent(content)) {
        throw new ValidationError('File appears to be binary and cannot be edited');
      }

      return {
        content,
        size: stats.size,
        modified: stats.mtime,
        encoding: 'utf-8'
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.error({ error, path: relativePath }, 'Failed to read file');
      throw new ValidationError('Failed to read file: ' + error.message);
    }
  }

  /**
   * Write file content
   */
  async writeFile(relativePath, content) {
    if (typeof content !== 'string') {
      throw new ValidationError('Content must be a string');
    }

    // Check content size
    const contentSize = Buffer.byteLength(content, 'utf-8');
    if (contentSize > this.maxFileSize) {
      throw new ValidationError(`Content too large (max ${this.maxFileSize / 1024 / 1024}MB)`);
    }

    try {
      // Check if file exists
      const exists = await this.fileSystemService.exists(relativePath);

      // If file exists, create backup
      if (exists) {
        await this.createBackup(relativePath);
      }

      // Write file
      await this.fileSystemService.writeFile(relativePath, content);

      const stats = await this.fileSystemService.stat(relativePath);

      logger.info({
        path: relativePath,
        size: stats.size,
        isNew: !exists
      }, 'File saved');

      return {
        path: relativePath,
        size: stats.size,
        modified: stats.mtime
      };
    } catch (error) {
      logger.error({ error, path: relativePath }, 'Failed to write file');
      throw new ValidationError('Failed to write file: ' + error.message);
    }
  }

  /**
   * Create backup of file before editing
   */
  async createBackup(relativePath) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${relativePath}.backup-${timestamp}`;

      await this.fileSystemService.copy(relativePath, backupPath);

      logger.debug({ originalPath: relativePath, backupPath }, 'Backup created');
    } catch (error) {
      // Don't fail if backup fails, just log it
      logger.warn({ error, path: relativePath }, 'Failed to create backup');
    }
  }

  /**
   * Check if content appears to be text (not binary)
   */
  isTextContent(content) {
    // Check for null bytes (common in binary files)
    if (content.includes('\0')) {
      return false;
    }

    // Sample first 8KB
    const sample = content.slice(0, 8192);
    let nonTextChars = 0;

    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);

      // Check for control characters (except common text ones)
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonTextChars++;
      }
    }

    // If more than 10% non-text chars, likely binary
    return (nonTextChars / sample.length) < 0.1;
  }

  /**
   * Get supported text file extensions
   */
  getSupportedExtensions() {
    return [
      '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.xml', '.yaml', '.yml', '.toml', '.ini',
      '.sh', '.bash', '.py', '.rb', '.php',
      '.java', '.c', '.cpp', '.h', '.go', '.rs',
      '.sql', '.log', '.csv', '.env',
      '.vue', '.svelte', '.astro'
    ];
  }

  /**
   * Check if file extension is supported
   */
  isSupportedExtension(filename) {
    const ext = filename.toLowerCase().match(/\.[^.]*$/);
    if (!ext) return false;

    return this.getSupportedExtensions().includes(ext[0]);
  }
}

module.exports = EditorService;
