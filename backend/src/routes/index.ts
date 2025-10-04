import type { Application } from 'express';

import browseRoutes from './browse';
import editorRoutes from './editor';
import favoritesRoutes from './favorites';
import fileRoutes from './files';
import thumbnailRoutes from './thumbnails';
import uploadRoutes from './upload';
import volumeRoutes from './volumes';

const registerRoutes = (app: Application): void => {
  app.use('/api', uploadRoutes);
  app.use('/api', fileRoutes);
  app.use('/api', browseRoutes);
  app.use('/api', editorRoutes);
  app.use('/api', volumeRoutes);
  app.use('/api', favoritesRoutes);
  app.use('/api', thumbnailRoutes);
};

export default registerRoutes;
