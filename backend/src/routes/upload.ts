import express, { type Request, type Response } from 'express';
import { stat } from 'fs/promises';
import path from 'path';

import { directories } from '../config';
import { createUploadMiddleware } from '../services/uploadService';
import { normalizeRelativePath } from '../utils/pathUtils';

const router = express.Router();
const upload = createUploadMiddleware();

interface UploadedFileMetadata {
  name: string;
  path: string;
  dateModified: Date;
  size: number;
  kind: string;
}

router.post('/upload', upload.fields([{ name: 'filedata', maxCount: 50 }]), async (req: Request, res: Response) => {
  try {
    const filesField = (req.files as Record<string, Express.Multer.File[]> | undefined)?.filedata;
    const files = Array.isArray(filesField) ? filesField : [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files were provided.' });
    }

    const fileData: UploadedFileMetadata[] = [];

    for (const file of files) {
      const fileStats = await stat(file.path);
      const relativeFilePath = normalizeRelativePath(path.relative(directories.volume, file.path));
      const parentPath = normalizeRelativePath(path.dirname(relativeFilePath));
      const storedName = path.basename(relativeFilePath);
      const extension = path.extname(storedName).toLowerCase().replace('.', '');

      fileData.push({
        name: storedName,
        path: parentPath,
        dateModified: fileStats.mtime,
        size: fileStats.size,
        kind: extension,
      });
    }

    res.json(fileData);
  } catch (error) {
    console.error('Upload failed:', error);
    res.status(500).send('Server error');
  }
});

export default router;
