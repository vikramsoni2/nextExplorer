/**
 * Application Initialization
 * Sets up Express app with all middleware and routes
 */

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const config = require('./shared/config');
const logger = require('./shared/logger/logger');
const { bootstrap } = require('./shared/utils/bootstrap.util');
const { getDb, getRepositories } = require('./infrastructure/database');

// Infrastructure - Storage Adapters
const JsonStorageAdapter = require('./infrastructure/storage/json-storage.adapter');
const FileSystemAdapter = require('./infrastructure/storage/file-system.adapter');

// Core Services - Auth & Users
const { AuthService } = require('./core/domains/auth');
const { UsersService } = require('./core/domains/users');
const PasswordService = require('./core/domains/auth/password.service');

// Core Services - Files & Browse
const FileSystemService = require('./core/domains/files/file-system.service');
const BrowseService = require('./core/domains/browse/browse.service');
const UploadService = require('./core/domains/files/upload.service');
const DownloadService = require('./core/domains/files/download.service');

// Core Services - Search & Settings
const SearchService = require('./core/domains/search/search.service');
const SettingsService = require('./core/domains/settings/settings.service');
const FavoritesService = require('./core/domains/favorites/favorites.service');

// Core Services - Media & Editor
const MetadataService = require('./core/domains/media/metadata.service');
const EditorService = require('./core/domains/editor/editor.service');
const ThumbnailService = require('./core/domains/media/thumbnail.service');

// Core Services - System
const FeaturesService = require('./core/domains/system/features.service');
const VolumesService = require('./core/domains/system/volumes.service');
const UsageService = require('./core/domains/system/usage.service');

// Use Cases - Auth
const {
  LoginUseCase,
  SetupUseCase,
  LogoutUseCase,
  ChangePasswordUseCase
} = require('./core/use-cases/auth');

// Use Cases - Files
const CreateFolderUseCase = require('./core/use-cases/files/create-folder.use-case');
const RenameItemUseCase = require('./core/use-cases/files/rename-item.use-case');
const MoveItemsUseCase = require('./core/use-cases/files/move-items.use-case');
const CopyItemsUseCase = require('./core/use-cases/files/copy-items.use-case');
const DeleteItemsUseCase = require('./core/use-cases/files/delete-items.use-case');

// Use Cases - Users
const ListUsersUseCase = require('./core/use-cases/users/list-users.use-case');
const CreateUserUseCase = require('./core/use-cases/users/create-user.use-case');
const UpdateUserUseCase = require('./core/use-cases/users/update-user.use-case');
const ResetUserPasswordUseCase = require('./core/use-cases/users/reset-user-password.use-case');
const DeleteUserUseCase = require('./core/use-cases/users/delete-user.use-case');

// API Controllers
const AuthController = require('./api/v1/controllers/auth.controller');
const FilesController = require('./api/v1/controllers/files.controller');
const BrowseController = require('./api/v1/controllers/browse.controller');
const UploadController = require('./api/v1/controllers/upload.controller');
const DownloadController = require('./api/v1/controllers/download.controller');
const SearchController = require('./api/v1/controllers/search.controller');
const SettingsController = require('./api/v1/controllers/settings.controller');
const FavoritesController = require('./api/v1/controllers/favorites.controller');
const MetadataController = require('./api/v1/controllers/metadata.controller');
const EditorController = require('./api/v1/controllers/editor.controller');
const ThumbnailController = require('./api/v1/controllers/thumbnail.controller');
const UsersController = require('./api/v1/controllers/users.controller');
const SystemController = require('./api/v1/controllers/system.controller');

// API Routes
const createAuthRoutes = require('./api/v1/routes/auth.routes');
const createFilesRoutes = require('./api/v1/routes/files.routes');
const createBrowseRoutes = require('./api/v1/routes/browse.routes');
const createUploadRoutes = require('./api/v1/routes/upload.routes');
const createDownloadRoutes = require('./api/v1/routes/download.routes');
const createSearchRoutes = require('./api/v1/routes/search.routes');
const createSettingsRoutes = require('./api/v1/routes/settings.routes');
const createFavoritesRoutes = require('./api/v1/routes/favorites.routes');
const createMetadataRoutes = require('./api/v1/routes/metadata.routes');
const createEditorRoutes = require('./api/v1/routes/editor.routes');
const createThumbnailRoutes = require('./api/v1/routes/thumbnail.routes');
const createUsersRoutes = require('./api/v1/routes/users.routes');
const createSystemRoutes = require('./api/v1/routes/system.routes');

// API Middleware
const createAuthMiddleware = require('./api/v1/middlewares/auth.middleware');
const createAdminMiddleware = require('./api/v1/middlewares/admin.middleware');
const { errorHandler, notFoundHandler } = require('./api/v1/middlewares/error-handler.middleware');

/**
 * Initialize application
 * @returns {Promise<express.Application>} - Configured Express app
 */
async function initializeApp() {
  const app = express();

  logger.info('Initializing application...');

  // 1. Bootstrap (create directories)
  await bootstrap(config.directories);

  // 2. Initialize database
  const db = await getDb();
  const repositories = await getRepositories();

  // 3. Initialize storage adapters
  const jsonStorageAdapter = new JsonStorageAdapter(config.directories.data);
  const fileSystemAdapter = new FileSystemAdapter(config.directories.volume);

  // 4. Initialize core services
  const passwordService = PasswordService; // Singleton instance
  const authService = new AuthService(repositories);
  const usersService = new UsersService(repositories);

  const fileSystemService = new FileSystemService({ volumeRoot: config.directories.volume });
  const browseService = new BrowseService({ fileSystemService });
  const uploadService = new UploadService({ fileSystemService, volumeRoot: config.directories.volume });
  const downloadService = new DownloadService({ fileSystemService });

  const searchService = new SearchService({ fileSystemService });
  const settingsService = new SettingsService({ jsonStorageAdapter });
  const favoritesService = new FavoritesService({ jsonStorageAdapter, fileSystemService });

  const metadataService = new MetadataService({ fileSystemService });
  const editorService = new EditorService({ fileSystemService });
  const thumbnailService = new ThumbnailService({ fileSystemService, settingsService });

  const featuresService = new FeaturesService({ db });
  const volumesService = new VolumesService();
  const usageService = new UsageService({ fileSystemService });

  // 5. Initialize use cases - Auth
  const loginUseCase = new LoginUseCase({ authService });
  const setupUseCase = new SetupUseCase({ usersService, authService });
  const logoutUseCase = new LogoutUseCase({ authService });
  const changePasswordUseCase = new ChangePasswordUseCase({ usersService });

  // 6. Initialize use cases - Files
  const createFolderUseCase = new CreateFolderUseCase({ fileSystemService });
  const renameItemUseCase = new RenameItemUseCase({ fileSystemService });
  const moveItemsUseCase = new MoveItemsUseCase({ fileSystemService });
  const copyItemsUseCase = new CopyItemsUseCase({ fileSystemService });
  const deleteItemsUseCase = new DeleteItemsUseCase({ fileSystemService });

  // 7. Initialize use cases - Users
  const listUsersUseCase = new ListUsersUseCase({ usersRepository: repositories.usersRepository });
  const createUserUseCase = new CreateUserUseCase({
    usersRepository: repositories.usersRepository,
    authMethodsRepository: repositories.authMethodsRepository,
    passwordService
  });
  const updateUserUseCase = new UpdateUserUseCase({ usersRepository: repositories.usersRepository });
  const resetUserPasswordUseCase = new ResetUserPasswordUseCase({
    usersRepository: repositories.usersRepository,
    authMethodsRepository: repositories.authMethodsRepository,
    passwordService
  });
  const deleteUserUseCase = new DeleteUserUseCase({
    usersRepository: repositories.usersRepository,
    authMethodsRepository: repositories.authMethodsRepository
  });

  // 8. Initialize controllers
  const authController = new AuthController({
    loginUseCase,
    setupUseCase,
    logoutUseCase,
    changePasswordUseCase,
    authService,
    usersService
  });

  const filesController = new FilesController({
    createFolderUseCase,
    renameItemUseCase,
    moveItemsUseCase,
    copyItemsUseCase,
    deleteItemsUseCase
  });

  const browseController = new BrowseController({ browseService });
  const uploadController = new UploadController({ uploadService });
  const downloadController = new DownloadController({ downloadService });
  const searchController = new SearchController({ searchService });
  const settingsController = new SettingsController({ settingsService });
  const favoritesController = new FavoritesController({ favoritesService });
  const metadataController = new MetadataController({ metadataService });
  const editorController = new EditorController({ editorService });
  const thumbnailController = new ThumbnailController({ thumbnailService, fileSystemService });

  const usersController = new UsersController({
    listUsersUseCase,
    createUserUseCase,
    updateUserUseCase,
    resetUserPasswordUseCase,
    deleteUserUseCase
  });

  const systemController = new SystemController({
    featuresService,
    volumesService,
    usageService
  });

  // 9. Trust proxy (if behind reverse proxy)
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
    logger.info({ trustProxy: config.trustProxy }, 'Trust proxy configured');
  }

  // 10. Middleware - Order matters!

  // CORS
  app.use(cors(config.corsOptions));

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Session
  app.use(session({
    secret: config.auth.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: 'auto',
      maxAge: config.auth.session.maxAge,
      sameSite: 'lax'
    },
    name: config.auth.session.name
  }));

  // Request logging (if enabled)
  if (config.logging.enableHttpLogging) {
    const pinoHttp = require('pino-http');
    app.use(pinoHttp({ logger }));
  }

  // 11. Configure OIDC (if enabled)
  const { configureOidc } = require('./api/v1/middlewares/oidc.middleware');
  await configureOidc(app, repositories.usersRepository, repositories.authMethodsRepository);

  // 12. Create middleware
  const authMiddleware = createAuthMiddleware(authService);
  const adminMiddleware = createAdminMiddleware();

  // 13. Static file serving for thumbnails
  app.use('/static/thumbnails', express.static(config.directories.thumbnails));

  // 14. Routes
  // System routes (features endpoint doesn't require auth)
  const systemRoutes = createSystemRoutes(systemController, authMiddleware);
  app.use('/api/v1', systemRoutes);

  // Auth routes
  const authRoutes = createAuthRoutes(authController, authMiddleware);
  app.use('/api/v1/auth', authRoutes);

  // Files & Browse routes
  const filesRoutes = createFilesRoutes(filesController, authMiddleware);
  app.use('/api/v1/files', filesRoutes);

  const browseRoutes = createBrowseRoutes(browseController, authMiddleware);
  app.use('/api/v1/browse', browseRoutes);

  // Upload & Download routes
  const uploadMiddleware = uploadService.createUploadMiddleware();
  const uploadRoutes = createUploadRoutes(uploadController, uploadMiddleware, authMiddleware);
  app.use('/api/v1/upload', uploadRoutes);

  const downloadRoutes = createDownloadRoutes(downloadController, authMiddleware);
  app.use('/api/v1/files/download', downloadRoutes);

  // Search routes
  const searchRoutes = createSearchRoutes(searchController, authMiddleware);
  app.use('/api/v1/search', searchRoutes);

  // Settings & Favorites routes
  const settingsRoutes = createSettingsRoutes(settingsController, authMiddleware, adminMiddleware);
  app.use('/api/v1/settings', settingsRoutes);

  const favoritesRoutes = createFavoritesRoutes(favoritesController, authMiddleware);
  app.use('/api/v1/favorites', favoritesRoutes);

  // Media routes
  const metadataRoutes = createMetadataRoutes(metadataController, authMiddleware);
  app.use('/api/v1/metadata', metadataRoutes);

  const editorRoutes = createEditorRoutes(editorController, authMiddleware);
  app.use('/api/v1/editor', editorRoutes);

  const thumbnailRoutes = createThumbnailRoutes(thumbnailController, authMiddleware);
  app.use('/api/v1/thumbnails', thumbnailRoutes);

  // Users management routes (admin only)
  const usersRoutes = createUsersRoutes(usersController, authMiddleware, adminMiddleware);
  app.use('/api/v1/users', usersRoutes);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 15. Error handling - Must be last!
  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info({
    port: config.port,
    nodeEnv: config.nodeEnv,
    authMode: config.auth.mode
  }, 'Application initialized');

  return app;
}

module.exports = { initializeApp };
