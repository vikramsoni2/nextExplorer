import express, { type Request, type Response } from 'express';

import { addFavorite, getFavorites, removeFavorite } from '../services/appConfigService';

const router = express.Router();

const extractErrorDetails = (error: unknown): { status: number; message: string } => {
  const status = typeof (error as { status?: number })?.status === 'number'
    ? Number((error as { status?: number }).status)
    : 500;
  const message = (error as Error)?.message || 'Failed to update favorites.';
  return { status, message };
};

router.get('/favorites', async (_req: Request, res: Response) => {
  try {
    const favorites = await getFavorites();
    res.json(favorites);
  } catch (error) {
    console.error('Failed to load favorites:', error);
    res.status(500).json({ error: 'Failed to load favorites.' });
  }
});

router.post('/favorites', async (req: Request, res: Response) => {
  try {
    const body = req.body as { path?: unknown; icon?: unknown } | undefined;
    const favorite = await addFavorite({ path: body?.path, icon: body?.icon });
    res.json(favorite);
  } catch (error) {
    const { status, message } = extractErrorDetails(error);
    if (status >= 500) {
      console.error('Failed to add favorite:', error);
    }
    res.status(status).json({ error: message });
  }
});

router.delete('/favorites', async (req: Request, res: Response) => {
  try {
    const body = req.body as { path?: unknown } | undefined;
    const favorites = await removeFavorite(body?.path);
    res.json(favorites);
  } catch (error) {
    const { status, message } = extractErrorDetails(error);
    if (status >= 500) {
      console.error('Failed to remove favorite:', error);
    }
    res.status(status).json({ error: message });
  }
});

export default router;
