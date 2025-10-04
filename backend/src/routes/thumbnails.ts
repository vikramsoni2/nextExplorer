import express, { type Request, type Response } from 'express';
import { stat } from 'fs/promises';
import path from 'path';

import { extensions } from '../config';
import { getThumbnail } from '../services/thumbnailService';
import { normalizeRelativePath, resolveVolumePath } from '../utils/pathUtils';

const router = express.Router();

const isPreviewable = (extension = ''): boolean => {
  if (!extension) {
    return false;
  }
  return extensions.previewable.has(extension.toLowerCase());
};

router.get('/thumbnails/*', async (req: Request, res: Response) => {
  try {
    const rawPath = req.params[0];
    const relativePath = normalizeRelativePath(rawPath ?? '');

    if (!relativePath) {
      return res.status(400).json({ error: 'A file path is required.' });
    }

    const absolutePath = resolveVolumePath(relativePath);
    const stats = await stat(absolutePath);

    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Thumbnails are only available for files.' });
    }

    const extension = path.extname(relativePath).slice(1).toLowerCase();
    if (extension === 'pdf') {
      return res.status(400).json({ error: 'Thumbnails are not available for PDF files.' });
    }

    if (!isPreviewable(extension)) {
      return res.status(400).json({ error: 'Thumbnails are not available for this file type.' });
    }

    const thumbnail = await getThumbnail(absolutePath);
    res.json({ thumbnail: thumbnail || '' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found.' });
    }

    console.error('Failed to resolve thumbnail', error);
    res.status(500).json({ error: 'Failed to generate thumbnail.' });
  }
});

export default router;
