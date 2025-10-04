import express, { type Request, type Response } from 'express';

import {
  createSessionToken,
  getStatus,
  invalidateSessionToken,
  isPasswordSet,
  isSessionTokenValid,
  setPassword,
  verifyPassword,
} from '../services/authService';
import { extractToken } from '../utils/auth';

const router = express.Router();

router.get('/status', (req: Request, res: Response) => {
  const token = extractToken(req);
  const status = getStatus();
  const authenticated = Boolean(token && isSessionTokenValid(token));

  res.json({
    ...status,
    authenticated,
  });
});

router.post('/setup', async (req: Request, res: Response) => {
  if (isPasswordSet()) {
    res.status(400).json({ error: 'Password has already been configured.' });
    return;
  }

  const password = typeof (req.body as Record<string, unknown>)?.password === 'string'
    ? ((req.body as Record<string, unknown>).password as string).trim()
    : '';

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return;
  }

  await setPassword(password);
  const token = createSessionToken();

  res.status(201).json({ token });
});

router.post('/login', async (req: Request, res: Response) => {
  if (!isPasswordSet()) {
    res.status(400).json({ error: 'Password setup is required before login.' });
    return;
  }

  const password = typeof (req.body as Record<string, unknown>)?.password === 'string'
    ? (req.body as Record<string, unknown>).password as string
    : '';

  if (!password) {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  const isValid = await verifyPassword(password);

  if (!isValid) {
    res.status(401).json({ error: 'Invalid password.' });
    return;
  }

  const token = createSessionToken();
  res.json({ token });
});

router.post('/logout', (req: Request, res: Response) => {
  const token = extractToken(req);
  if (token) {
    invalidateSessionToken(token);
  }

  res.status(204).end();
});

export default router;
