import express, { type Request, type Response } from 'express';
import { readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

import { ensureDir } from '../utils/fsUtils';
import { normalizeRelativePath, resolveVolumePath } from '../utils/pathUtils';

const router = express.Router();

const extractPathFromBody = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.path === 'string' && record.path.trim()) {
    return record.path;
  }
  return null;
};

router.post('/editor', async (req: Request, res: Response) => {
  try {
    const pathValue = extractPathFromBody(req.body);
    if (!pathValue) {
      return res.status(400).json({ error: 'A valid file path is required.' });
    }

    const relativePath = normalizeRelativePath(pathValue);
    const absolutePath = resolveVolumePath(relativePath);
    const stats = await stat(absolutePath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot open a directory in the editor.' });
    }

    const data = await readFile(absolutePath, { encoding: 'utf-8' });
    return res.json({ content: data });
  } catch (error) {
    console.error('Error reading the file:', error);
    return res.status(500).json({ error: 'Failed to read file.' });
  }
});

router.put('/editor', async (req: Request, res: Response) => {
  try {
    const pathValue = extractPathFromBody(req.body);
    if (!pathValue) {
      return res.status(400).json({ error: 'A valid file path is required.' });
    }

    const content = typeof (req.body as Record<string, unknown>)?.content === 'string'
      ? (req.body as Record<string, unknown>).content as string
      : '';

    const relativePath = normalizeRelativePath(pathValue);
    const absolutePath = resolveVolumePath(relativePath);
    await ensureDir(path.dirname(absolutePath));
    await writeFile(absolutePath, content, { encoding: 'utf-8' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error writing to the file:', error);
    return res.status(500).json({ error: 'Failed to update file.' });
  }
});

export default router;
