/**
 * Search Service
 * Content and filename search with ripgrep integration
 */

const { spawn } = require('child_process');
const path = require('path');
const { ValidationError } = require('../../../shared/errors');
const logger = require('../../../shared/logger/logger');

class SearchService {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
    this.ripgrepAvailable = null;
  }

  /**
   * Check if ripgrep is available
   */
  async isRipgrepAvailable() {
    if (this.ripgrepAvailable !== null) {
      return this.ripgrepAvailable;
    }

    return new Promise((resolve) => {
      const rg = spawn('rg', ['--version']);

      rg.on('error', () => {
        this.ripgrepAvailable = false;
        logger.info('ripgrep not available, using fallback search');
        resolve(false);
      });

      rg.on('close', (code) => {
        this.ripgrepAvailable = code === 0;
        if (this.ripgrepAvailable) {
          logger.info('ripgrep available for fast searching');
        }
        resolve(this.ripgrepAvailable);
      });
    });
  }

  /**
   * Search for content in files
   */
  async searchContent(query, options = {}) {
    const {
      path: searchPath = '',
      caseSensitive = false,
      regexp = false,
      maxResults = 100
    } = options;

    if (!query || query.trim().length === 0) {
      throw new ValidationError('Search query cannot be empty');
    }

    const absolutePath = this.fileSystemService.resolvePath(searchPath);

    // Check if ripgrep is available
    const useRipgrep = await this.isRipgrepAvailable();

    if (useRipgrep) {
      return this.searchWithRipgrep(query, absolutePath, searchPath, {
        caseSensitive,
        regexp,
        maxResults
      });
    } else {
      return this.searchWithFallback(query, absolutePath, searchPath, {
        caseSensitive,
        regexp,
        maxResults
      });
    }
  }

  /**
   * Search using ripgrep (fast)
   */
  async searchWithRipgrep(query, absolutePath, relativePath, options) {
    const { caseSensitive, regexp, maxResults } = options;

    return new Promise((resolve, reject) => {
      const args = [
        '--json',
        '--max-count', String(maxResults),
        '--max-columns', '500',
        '--max-filesize', '10M'
      ];

      // Case sensitivity
      if (!caseSensitive) {
        args.push('-i');
      }

      // Fixed string or regexp
      if (!regexp) {
        args.push('-F');
      }

      // Add query and search path
      args.push(query, absolutePath);

      const rg = spawn('rg', args);
      const results = [];
      let buffer = '';

      rg.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const item = JSON.parse(line);

            if (item.type === 'match') {
              const filePath = path.relative(absolutePath, item.data.path.text);
              const normalizedPath = filePath.split(path.sep).join('/');

              results.push({
                path: path.join(relativePath, normalizedPath),
                lineNumber: item.data.line_number,
                lineText: item.data.lines.text.trim(),
                matches: item.data.submatches.map(m => ({
                  start: m.start,
                  end: m.end,
                  text: m.match.text
                }))
              });

              if (results.length >= maxResults) {
                rg.kill();
              }
            }
          } catch (err) {
            logger.warn({ line, error: err.message }, 'Failed to parse ripgrep output');
          }
        }
      });

      rg.stderr.on('data', (data) => {
        logger.debug({ stderr: data.toString() }, 'ripgrep stderr');
      });

      rg.on('error', (error) => {
        logger.error({ error }, 'ripgrep execution error');
        reject(error);
      });

      rg.on('close', (code) => {
        // Code 0 = matches found, Code 1 = no matches, Code 2 = error
        if (code === 2) {
          logger.error({ code }, 'ripgrep exited with error');
          reject(new Error('Search failed'));
        } else {
          resolve({
            results,
            count: results.length,
            hasMore: results.length >= maxResults
          });
        }
      });
    });
  }

  /**
   * Fallback search using JavaScript (slower)
   */
  async searchWithFallback(query, absolutePath, relativePath, options) {
    const { caseSensitive, regexp, maxResults } = options;
    const results = [];
    const fs = require('fs').promises;

    // Create search pattern
    let searchPattern;
    if (regexp) {
      try {
        searchPattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
      } catch (err) {
        throw new ValidationError('Invalid regular expression');
      }
    } else {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchPattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
    }

    // Recursively search files
    async function searchDirectory(dirPath, relPath) {
      if (results.length >= maxResults) return;

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;

          // Skip hidden files and common ignore patterns
          if (entry.name.startsWith('.') ||
              entry.name === 'node_modules' ||
              entry.name === '__pycache__') {
            continue;
          }

          const fullPath = path.join(dirPath, entry.name);
          const itemRelPath = path.join(relPath, entry.name);

          if (entry.isDirectory()) {
            await searchDirectory(fullPath, itemRelPath);
          } else if (entry.isFile()) {
            await searchFile(fullPath, itemRelPath);
          }
        }
      } catch (err) {
        logger.warn({ dirPath, error: err.message }, 'Failed to search directory');
      }
    }

    async function searchFile(filePath, relPath) {
      try {
        const stats = await fs.stat(filePath);

        // Skip large files (>10MB)
        if (stats.size > 10 * 1024 * 1024) {
          return;
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;

          const line = lines[i];
          const matches = [];
          let match;

          // Reset regex lastIndex
          searchPattern.lastIndex = 0;

          while ((match = searchPattern.exec(line)) !== null) {
            matches.push({
              start: match.index,
              end: match.index + match[0].length,
              text: match[0]
            });

            // Prevent infinite loop on zero-width matches
            if (match.index === searchPattern.lastIndex) {
              searchPattern.lastIndex++;
            }
          }

          if (matches.length > 0) {
            results.push({
              path: path.join(relativePath, relPath).split(path.sep).join('/'),
              lineNumber: i + 1,
              lineText: line.trim(),
              matches
            });
          }
        }
      } catch (err) {
        // Skip binary files or files we can't read
        logger.debug({ filePath, error: err.message }, 'Failed to search file');
      }
    }

    await searchDirectory(absolutePath, '');

    return {
      results,
      count: results.length,
      hasMore: results.length >= maxResults
    };
  }

  /**
   * Search by filename
   */
  async searchByName(query, options = {}) {
    const {
      path: searchPath = '',
      caseSensitive = false,
      maxResults = 100
    } = options;

    if (!query || query.trim().length === 0) {
      throw new ValidationError('Search query cannot be empty');
    }

    const absolutePath = this.fileSystemService.resolvePath(searchPath);
    const results = [];
    const fs = require('fs').promises;

    const searchTerm = caseSensitive ? query : query.toLowerCase();

    async function searchDirectory(dirPath, relPath) {
      if (results.length >= maxResults) return;

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= maxResults) break;

          // Skip hidden files
          if (entry.name.startsWith('.')) {
            continue;
          }

          const fileName = caseSensitive ? entry.name : entry.name.toLowerCase();
          const fullPath = path.join(dirPath, entry.name);
          const itemRelPath = path.join(relPath, entry.name);

          // Check if name matches
          if (fileName.includes(searchTerm)) {
            const stats = await fs.stat(fullPath);
            results.push({
              name: entry.name,
              path: path.join(searchPath, itemRelPath).split(path.sep).join('/'),
              isDirectory: entry.isDirectory(),
              size: stats.size,
              modified: stats.mtime
            });
          }

          // Recurse into directories
          if (entry.isDirectory()) {
            await searchDirectory(fullPath, itemRelPath);
          }
        }
      } catch (err) {
        logger.warn({ dirPath, error: err.message }, 'Failed to search directory');
      }
    }

    await searchDirectory(absolutePath, '');

    return {
      results,
      count: results.length,
      hasMore: results.length >= maxResults
    };
  }
}

module.exports = SearchService;
