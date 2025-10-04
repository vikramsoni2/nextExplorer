import express, { type Request, type Response } from 'express';
import { readdir } from 'fs/promises';

import { directories, excludedFiles } from '../config';

const router = express.Router();

router.get('/volumes', async (_req: Request, res: Response) => {
  try {
    const entries = await readdir(directories.volume, { withFileTypes: true });

    const volumeData = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !excludedFiles.includes(name))
      .map((name) => ({
        name,
        path: name,
        kind: 'volume' as const,
      }));

    res.json(volumeData);
  } catch (error) {
    console.error('Failed to fetch volumes:', error);
    res.status(500).json({ error: 'An error occurred while fetching the volumes.' });
  }
});

export default router;
