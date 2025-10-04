import type { NextFunction, Request, Response } from 'express';

import { isPasswordSet, isSessionTokenValid } from '../services/authService';
import { extractToken } from '../utils/auth';

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestPath = req.path || '';
  const apiRoute = requestPath.startsWith('/api');
  const isAuthRoute = requestPath.startsWith('/api/auth');

  if (!apiRoute) {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  if (!isPasswordSet()) {
    if (isAuthRoute) {
      next();
      return;
    }

    res.status(503).json({ error: 'Password setup required.' });
    return;
  }

  if (isAuthRoute) {
    next();
    return;
  }

  const token = extractToken(req);

  if (!token || !isSessionTokenValid(token)) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.sessionToken = token;
  next();
};

export default authMiddleware;
