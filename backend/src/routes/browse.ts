import express, { type Request, type Response } from 'express';
import { readdir, stat } from 'fs/promises';
import path from 'path';

import { excludedFiles, extensions } from '../config';
import { getThumbnailPathIfExists, queueThumbnailGeneration } from '../services/thumbnailService';
import { pathExists } from '../utils/fsUtils';
import { normalizeRelativePath, resolveVolumePath } from '../utils/pathUtils';

interface DirectoryItem {
  name: string;
  path: string;
  dateModified: Date;
  size: number;
  kind: string;
  thumbnail?: string;
}

const router = express.Router();
const previewableExtensions = extensions.previewable;

router.get('/browse/*', async (req: Request, res: Response) => {
  try {
    const relativePath = normalizeRelativePath(req.params[0] ?? '');
    const directoryPath = resolveVolumePath(relativePath);

    if (!(await pathExists(directoryPath))) {
      return res.status(404).json({ error: 'Path not found.' });
    }

    const files = await readdir(directoryPath);
    const filteredFiles = files
      .filter((file) => !excludedFiles.includes(file))
      .filter((file) => path.extname(file).toLowerCase() !== '.download');

    const fileDataPromises = filteredFiles.map(async (file) => {
      const filePath = path.join(directoryPath, file);
      const stats = await stat(filePath);

      let extension = stats.isDirectory() ? 'directory' : path.extname(file).slice(1).toLowerCase();
      if (extension.length > 10) {
        extension = 'unknown';
      }

      const item: DirectoryItem = {
        name: file,
        path: relativePath,
        dateModified: stats.mtime,
        size: stats.size,
        kind: extension,
      };

      if (stats.isFile() && previewableExtensions.has(extension.toLowerCase()) && extension !== 'pdf') {
        try {
          const existingThumbnail = await getThumbnailPathIfExists(filePath);
          if (existingThumbnail) {
            item.thumbnail = existingThumbnail;
          } else {
            queueThumbnailGeneration(filePath);
          }
        } catch (error) {
          console.log(`Failed to schedule thumbnail for ${filePath}: Continuing`, error);
        }
      }

      return item;
    });

    const fileData = await Promise.all(fileDataPromises);
    return res.json(fileData);
  } catch (error) {
    console.error('Failed to read directory:', error);
    return res.status(500).json({ error: 'An error occurred while reading the directory.' });
  }
});

export default router;
