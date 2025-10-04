import type { Server } from 'http';
import cors from 'cors';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

import { corsOptions, directories, port } from './config';
import authMiddleware from './middleware/authMiddleware';
import registerRoutes from './routes';
import authRoutes from './routes/auth';
import { initializeAuth } from './services/authService';
import { ensureDir } from './utils/fsUtils';

const app: Application = express();

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

void (async () => {
  try {
    await ensureDir(directories.cache);
    await ensureDir(directories.thumbnails);
    await initializeAuth();
  } catch (error) {
    console.error('Failed to initialize application:', error);
  }
})();

app.use('/api/auth', authRoutes);
app.use(authMiddleware);

app.use('/static/thumbnails', express.static(directories.thumbnails));

registerRoutes(app);

const frontendDir = path.resolve(__dirname, 'public');
const indexFile = path.join(frontendDir, 'index.html');

if (fs.existsSync(frontendDir) && fs.existsSync(indexFile)) {
  app.use(express.static(frontendDir));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/static/thumbnails')) {
      return next();
    }

    if (!['GET', 'HEAD'].includes(req.method)) {
      return next();
    }

    res.sendFile(indexFile);
  });
}

const server: Server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

export { app, server };
