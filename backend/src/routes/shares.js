const express = require('express');
const fs = require('fs/promises');
const fss = require('fs');
const path = require('path');
const archiver = require('archiver');
const asyncHandler = require('../utils/asyncHandler');
const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} = require('../errors/AppError');
const {
  createShare,
  getShareById,
  getShareByToken,
  getSharesByOwnerId,
  getSharesForUser,
  updateShare,
  deleteShare,
  verifySharePassword,
  hasUserPermission,
  isShareExpired,
  trackShareAccess,
  getShareStats,
} = require('../services/sharesService');
const { createGuestSession } = require('../services/guestSessionService');
const { normalizeRelativePath, parsePathSpace } = require('../utils/pathUtils');
const { pathExists } = require('../utils/fsUtils');
const { resolvePathWithAccess } = require('../services/accessManager');
const { extensions, mimeTypes } = require('../config/index');
const { getSettings, getUserSettings } = require('../services/settingsService');
const { listDirectoryItems } = require('../services/directoryListingService');
const { encodeContentDisposition } = require('./files/utils');
const logger = require('../utils/logger');

const router = express.Router();

const buildPublicBaseUrl = (req) => {
  const { public: publicConfig } = require('../config/index');
  return publicConfig.origin || `${req.protocol}://${req.get('host')}`;
};

const encodeUrlPath = (value = '') =>
  String(value).split('/').filter(Boolean).map(encodeURIComponent).join('/');

const DIRECT_FILE_MODES = new Set(['auto', 'download', 'inline', 'raw', 'view']);
const TEXT_LIKE_EXTENSIONS = new Set([
  'bat',
  'bash',
  'c',
  'cfg',
  'cmd',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'env',
  'fish',
  'go',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'less',
  'log',
  'mjs',
  'md',
  'php',
  'ps1',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'toml',
  'ts',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);
const TEXT_LIKE_FILENAMES = new Set(['dockerfile', 'makefile', 'readme', 'license']);
const FORCE_PLAIN_TEXT_EXTENSIONS = new Set([
  'bat',
  'bash',
  'cmd',
  'fish',
  'htm',
  'html',
  'js',
  'jsx',
  'mjs',
  'ps1',
  'sh',
  'svg',
  'ts',
  'tsx',
  'zsh',
]);
const INLINE_MIME_PREFIXES = ['audio/', 'image/', 'text/', 'video/'];
const INLINE_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
]);

const normalizeDirectFileMode = (mode) => {
  const value = typeof mode === 'string' ? mode.toLowerCase() : 'auto';
  if (!DIRECT_FILE_MODES.has(value)) return 'auto';
  return value === 'view' ? 'inline' : value;
};

const isTextLikeFile = (filename, extension) => {
  const lowerName = filename.toLowerCase();
  return TEXT_LIKE_EXTENSIONS.has(extension) || TEXT_LIKE_FILENAMES.has(lowerName);
};

const getDirectFilePresentation = (filename, requestedMode) => {
  const mode = normalizeDirectFileMode(requestedMode);
  const extension = path.extname(filename).slice(1).toLowerCase();
  const detectedMimeType = mimeTypes[extension] || 'application/octet-stream';
  const textLike = isTextLikeFile(filename, extension);
  const inlineMime =
    INLINE_MIME_PREFIXES.some((prefix) => detectedMimeType.startsWith(prefix)) ||
    INLINE_MIME_TYPES.has(detectedMimeType);
  const canInline = textLike || inlineMime;
  const forceDownload = mode === 'download' || !canInline;
  const disposition = forceDownload ? 'attachment' : 'inline';

  let contentType = detectedMimeType;
  if (!forceDownload && textLike) {
    const shouldUsePlainText =
      mode === 'inline' ||
      detectedMimeType === 'application/octet-stream' ||
      FORCE_PLAIN_TEXT_EXTENSIONS.has(extension);
    contentType = shouldUsePlainText ? 'text/plain; charset=utf-8' : detectedMimeType;
  }

  return {
    contentType,
    disposition,
  };
};

const buildDirectFilePath = (shareToken, innerPath = '', mode = 'auto') => {
  const encodedToken = encodeURIComponent(shareToken);
  const encodedInnerPath = encodeUrlPath(innerPath);
  const normalizedMode = normalizeDirectFileMode(mode);
  const query = normalizedMode === 'auto' ? '' : `?mode=${encodeURIComponent(normalizedMode)}`;
  const pathPart = encodedInnerPath
    ? `/api/share/${encodedToken}/file/${encodedInnerPath}`
    : `/api/share/${encodedToken}/file`;
  return `${pathPart}${query}`;
};

const getSafeRedirectTarget = (target) => {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) {
    return null;
  }
  return target;
};

const redirectToShareAccess = (req, res, shareToken) => {
  const redirectTarget = getSafeRedirectTarget(req.originalUrl || '');
  const redirectQuery = redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget)}` : '';
  res.redirect(302, `/share/${encodeURIComponent(shareToken)}${redirectQuery}`);
};

const streamResolvedFile = async ({ absolutePath, stats, mode, req, res }) => {
  const filename = path.basename(absolutePath);
  const { contentType, disposition } = getDirectFilePresentation(filename, mode);

  const streamFile = (options = undefined) => {
    const stream = options
      ? fss.createReadStream(absolutePath, options)
      : fss.createReadStream(absolutePath);
    stream.on('error', (streamError) => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(streamError);
      }
    });
    stream.pipe(res);
  };

  const baseHeaders = {
    'Content-Type': contentType,
    'Content-Disposition': encodeContentDisposition(filename, disposition),
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const bytesPrefix = 'bytes=';
    if (!rangeHeader.startsWith(bytesPrefix)) {
      res.status(416).send('Malformed Range header');
      return;
    }

    const [startString, endString] = rangeHeader.slice(bytesPrefix.length).split('-');
    let start = Number(startString);
    let end = endString ? Number(endString) : stats.size - 1;

    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= stats.size) end = stats.size - 1;

    if (start > end) {
      res.status(416).send('Range Not Satisfiable');
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
    });
    streamFile({ start, end });
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': stats.size,
    'Accept-Ranges': 'bytes',
  });
  streamFile();
};

const streamResolvedDirectoryZip = async ({ absolutePath, archiveName, res }) => {
  const safeArchiveName = archiveName && archiveName.trim() ? archiveName.trim() : 'download';
  const filename = safeArchiveName.toLowerCase().endsWith('.zip')
    ? safeArchiveName
    : `${safeArchiveName}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', encodeContentDisposition(filename, 'attachment'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', (archiveError) => {
    logger.error({ err: archiveError }, 'Direct share archive creation failed');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create archive.' });
    } else {
      res.end();
    }
  });

  archive.pipe(res);
  archive.directory(absolutePath, path.basename(absolutePath) || safeArchiveName);
  await archive.finalize();
};

/**
 * POST /api/shares - Create a new share
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const {
      sourcePath,
      accessMode = 'readonly',
      sharingType = 'anyone',
      password,
      userIds,
      expiresAt,
      label,
    } = req.body;

    if (!sourcePath) {
      throw new ValidationError('Source path is required');
    }

    // Parse and validate source path
    const { space, rel } = parsePathSpace(sourcePath);

    if (space === 'share') {
      throw new ValidationError('Cannot create shares from shared paths');
    }

    // Resolve the path to check if it exists
    let resolved;
    try {
      const { accessInfo, resolved: resolvedWithAccess } = await resolvePathWithAccess(
        { user: req.user, guestSession: req.guestSession },
        sourcePath
      );
      if (!accessInfo?.canAccess || !resolvedWithAccess) {
        throw new ForbiddenError(accessInfo?.denialReason || 'Access denied');
      }
      if (accessMode === 'readwrite' && !accessInfo.canWrite) {
        throw new ValidationError('Cannot create a read-write share for a read-only path');
      }
      resolved = resolvedWithAccess;
    } catch (error) {
      if (error?.statusCode) throw error;
      throw new ValidationError('Invalid source path');
    }

    // Check if path exists
    if (!(await pathExists(resolved.absolutePath))) {
      throw new NotFoundError('Source path does not exist');
    }

    // Check if it's a directory
    const stats = await fs.stat(resolved.absolutePath);
    const isDirectory = stats.isDirectory();

    // Validate expiration date if provided
    let validExpiresAt = null;
    if (expiresAt) {
      const expiryDate = new Date(expiresAt);
      if (isNaN(expiryDate.getTime())) {
        throw new ValidationError('Invalid expiration date');
      }
      if (expiryDate <= new Date()) {
        throw new ValidationError('Expiration date must be in the future');
      }
      validExpiresAt = expiryDate.toISOString();
    }

    // Create the share
    const sourceSpaceForDb = resolved?.userVolume ? 'user_volume' : space;
    const sourcePathForDb = resolved?.userVolume
      ? `${resolved.userVolume.id}${resolved.innerRelativePath ? `/${resolved.innerRelativePath}` : ''}`
      : rel || resolved.innerRelativePath;

    const share = await createShare({
      ownerId: req.user.id,
      sourceSpace: sourceSpaceForDb,
      sourcePath: sourcePathForDb,
      isDirectory,
      accessMode,
      sharingType,
      password,
      userIds: sharingType === 'users' ? userIds : [],
      expiresAt: validExpiresAt,
      label,
    });

    // Generate share URL using PUBLIC_URL if configured, otherwise use request host
    const baseUrl = buildPublicBaseUrl(req);
    const shareUrl = `${baseUrl}/share/${share.shareToken}`;
    const directFileUrl = `${baseUrl}${buildDirectFilePath(share.shareToken)}`;

    res.status(201).json({
      ...share,
      shareUrl,
      directFileUrl,
    });
  })
);

/**
 * GET /api/shares - List user's shares
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const shares = await getSharesByOwnerId(req.user.id);

    res.json({ shares });
  })
);

/**
 * GET /api/shares/shared-with-me - List shares shared with the current user
 */
router.get(
  '/shared-with-me',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const shares = await getSharesForUser(req.user.id);

    res.json({ shares });
  })
);

/**
 * GET /api/shares/:id - Get share details (owner only)
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const share = await getShareById(req.params.id);

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    // Only owner can view details
    if (share.ownerId !== req.user.id) {
      throw new ForbiddenError('Access denied');
    }

    // Get statistics
    const stats = await getShareStats(share.id);

    res.json({
      ...share,
      stats,
    });
  })
);

/**
 * PUT /api/shares/:id - Update share
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const share = await getShareById(req.params.id);

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    // Only owner can update
    if (share.ownerId !== req.user.id) {
      throw new ForbiddenError('Access denied');
    }

    const updates = {};

    if ('accessMode' in req.body) {
      updates.accessMode = req.body.accessMode;
    }

    if ('sharingType' in req.body) {
      updates.sharingType = req.body.sharingType;
    }

    if ('password' in req.body) {
      updates.password = req.body.password;
    }

    if ('expiresAt' in req.body) {
      if (req.body.expiresAt) {
        const expiryDate = new Date(req.body.expiresAt);
        if (isNaN(expiryDate.getTime())) {
          throw new ValidationError('Invalid expiration date');
        }
        updates.expiresAt = expiryDate.toISOString();
      } else {
        updates.expiresAt = null;
      }
    }

    if ('label' in req.body) {
      updates.label = req.body.label;
    }

    if ('userIds' in req.body) {
      updates.userIds = req.body.userIds;
    }

    const updated = await updateShare(share.id, updates);

    res.json(updated);
  })
);

/**
 * DELETE /api/shares/:id - Delete share
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const share = await getShareById(req.params.id);

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    // Only owner can delete
    if (share.ownerId !== req.user.id) {
      throw new ForbiddenError('Access denied');
    }

    await deleteShare(share.id);

    res.status(204).end();
  })
);

/**
 * GET /api/share/:token/info - Get public share info (before authentication)
 */
router.get(
  '/:token/info',
  asyncHandler(async (req, res) => {
    const share = await getShareByToken(req.params.token);

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    // Return limited public info
    res.json({
      shareToken: share.shareToken,
      label: share.label,
      isDirectory: share.isDirectory,
      hasPassword: share.hasPassword,
      sharingType: share.sharingType,
      expiresAt: share.expiresAt,
      isExpired: isShareExpired(share),
    });
  })
);

/**
 * POST /api/share/:token/verify - Verify password for password-protected share
 */
router.post(
  '/:token/verify',
  asyncHandler(async (req, res) => {
    const { password } = req.body;

    const share = await getShareByToken(req.params.token);

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    if (isShareExpired(share)) {
      throw new ForbiddenError('Share has expired');
    }

    // Check if password is required
    if (!share.hasPassword) {
      // No password required, just create guest session
      if (share.sharingType === 'anyone') {
        const session = await createGuestSession({
          shareId: share.id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Set guest session cookie
        res.cookie('guestSession', session.id, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
          sameSite: 'lax',
          path: '/api', // Ensure cookie is sent for all /api/* requests
        });

        res.json({
          success: true,
          guestSessionId: session.id,
        });
        return;
      } else {
        // User-specific share without password still requires auth
        throw new UnauthorizedError('Authentication required');
      }
    }

    // Verify password
    const valid = await verifySharePassword(share.id, password);

    if (!valid) {
      throw new UnauthorizedError('Invalid password');
    }

    // Create guest session for anyone shares
    if (share.sharingType === 'anyone') {
      const session = await createGuestSession({
        shareId: share.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      // Set guest session cookie
      res.cookie('guestSession', session.id, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax',
        path: '/api', // Ensure cookie is sent for all /api/* requests
      });

      res.json({
        success: true,
        guestSessionId: session.id,
      });
    } else {
      // User-specific shares still need user authentication
      res.json({
        success: true,
        requiresAuth: true,
      });
    }
  })
);

/**
 * GET /api/share/:token/access - Access share (creates session if needed)
 */
router.get(
  '/:token/access',
  asyncHandler(async (req, res) => {
    const share = await getShareByToken(req.params.token);

    if (!share) {
      throw new NotFoundError('Share not found');
    }

    if (isShareExpired(share)) {
      throw new ForbiddenError('Share has expired');
    }

    // Track access
    await trackShareAccess(share.id);

    // Check if user has permission
    if (share.sharingType === 'users') {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const { hasUserPermission } = require('../services/sharesService');
      const permitted = await hasUserPermission(share.id, req.user.id);

      if (!permitted) {
        throw new ForbiddenError('Access denied');
      }
    } else {
      // Anyone share - always create a new guest session for this share
      // This ensures switching between shares in the same browser works correctly
      if (!req.user) {
        // Create guest session if no password required
        if (!share.hasPassword) {
          const session = await createGuestSession({
            shareId: share.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
          });

          // Set guest session cookie (overwrites any existing session)
          res.cookie('guestSession', session.id, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            sameSite: 'lax',
            path: '/api', // Ensure cookie is sent for all /api/* requests
          });

          return res.json({
            share: {
              shareToken: share.shareToken,
              label: share.label,
              sourcePath: `share/${share.shareToken}`,
              accessMode: share.accessMode,
              isDirectory: share.isDirectory,
            },
            guestSessionId: session.id,
          });
        } else {
          throw new UnauthorizedError('Password verification required');
        }
      }
    }

    // Return share access info
    res.json({
      share: {
        shareToken: share.shareToken,
        label: share.label,
        sourcePath: `share/${share.shareToken}`,
        accessMode: share.accessMode,
        isDirectory: share.isDirectory,
        expiresAt: share.expiresAt,
      },
      guestSessionId: req.guestSession?.id || null,
    });
  })
);

const handleDirectFileRequest = async (req, res) => {
  const shareToken = req.params.token;
  const rawInnerPath = (req.params.splat || []).join('/');
  const mode = normalizeDirectFileMode(req.query?.mode);
  let innerPath = '';

  try {
    innerPath = rawInnerPath ? normalizeRelativePath(rawInnerPath) : '';
  } catch (error) {
    throw new ValidationError('Invalid file path.');
  }

  const share = await getShareByToken(shareToken);
  if (!share) {
    throw new NotFoundError('Share not found');
  }

  if (isShareExpired(share)) {
    throw new ForbiddenError('Share has expired');
  }

  if (!share.isDirectory && innerPath) {
    throw new NotFoundError('Path not found');
  }

  if (share.sharingType === 'users') {
    if (!req.user || !req.user.id) {
      redirectToShareAccess(req, res, shareToken);
      return;
    }

    const permitted = await hasUserPermission(share.id, req.user.id);
    if (!permitted) {
      throw new ForbiddenError('Access denied');
    }
  }

  let guestSession = req.guestSession || null;

  if (share.sharingType === 'anyone' && !req.user) {
    if (share.hasPassword) {
      if (!guestSession || guestSession.shareId !== share.id) {
        redirectToShareAccess(req, res, shareToken);
        return;
      }
    } else {
      // Public direct file links should work without first visiting the Web UI.
      guestSession = guestSession?.shareId === share.id ? guestSession : { shareId: share.id };
    }
  }

  const logicalPath = innerPath ? `share/${shareToken}/${innerPath}` : `share/${shareToken}`;
  const context = { user: req.user, guestSession };
  const { accessInfo, resolved } = await resolvePathWithAccess(context, logicalPath);

  if (
    !accessInfo ||
    !accessInfo.canAccess ||
    !accessInfo.canRead ||
    !accessInfo.canDownload ||
    !resolved
  ) {
    throw new ForbiddenError(accessInfo?.denialReason || 'File access not allowed.');
  }

  if (!(await pathExists(resolved.absolutePath))) {
    throw new NotFoundError('Path not found');
  }

  const stats = await fs.stat(resolved.absolutePath);
  if (stats.isDirectory()) {
    await trackShareAccess(share.id);
    await streamResolvedDirectoryZip({
      absolutePath: resolved.absolutePath,
      archiveName:
        path.basename(resolved.absolutePath) ||
        share.label ||
        path.basename(share.sourcePath || '') ||
        'download',
      res,
    });
    return;
  }

  await trackShareAccess(share.id);
  await streamResolvedFile({ absolutePath: resolved.absolutePath, stats, mode, req, res });
};

/**
 * GET /api/share/:token/file/* - Open a shared file directly.
 *
 * This keeps the same share rules as the Web UI but streams the target file
 * itself, letting the browser preview supported formats or download others.
 */
router.get('/:token/file', asyncHandler(handleDirectFileRequest));
router.get('/:token/file/{*splat}', asyncHandler(handleDirectFileRequest));

/**
 * GET /api/share/:token/browse/* - Browse share contents
 *
 * For directory shares, returns the contents of the directory.
 * For file shares, treats the share as a virtual one-item directory
 * and returns a single item representing the shared file.
 *
 * Response shape matches /api/browse:
 * {
 *   items: [...],
 *   access: { canRead, canWrite, canUpload, canDelete, canShare, canDownload },
 *   path: 'share/<token>/<innerPath>'
 * }
 */
router.get(
  '/:token/browse/{*splat}',
  asyncHandler(async (req, res) => {
    const shareToken = req.params.token;
    const innerPath = (req.params.splat || []).join('/');

    const logicalPath = innerPath ? `share/${shareToken}/${innerPath}` : `share/${shareToken}`;

    const context = { user: req.user, guestSession: req.guestSession };
    const { accessInfo, resolved } = await resolvePathWithAccess(context, logicalPath);

    if (!accessInfo || !accessInfo.canAccess || !resolved) {
      throw new ForbiddenError(accessInfo?.denialReason || 'Access denied');
    }

    if (!(await pathExists(resolved.absolutePath))) {
      throw new NotFoundError('Path not found');
    }

    const stats = await fs.stat(resolved.absolutePath);

    // Determine thumbnail settings
    const settings = await getSettings();
    const userSettings = req.user?.id ? await getUserSettings(req.user.id) : {};
    const thumbsEnabled = settings?.thumbnails?.enabled !== false;
    const includeHiddenFiles = userSettings?.showHiddenFiles === true;

    // Directory share or navigating inside a directory share
    if (stats.isDirectory()) {
      const shareCache = new Map();
      if (resolved?.shareInfo?.shareToken) {
        // shareInfo on resolved is the full share object
        shareCache.set(resolved.shareInfo.shareToken, resolved.shareInfo);
      }
      const userVolumeCache = new Map();
      const items = await listDirectoryItems({
        absoluteDir: resolved.absolutePath,
        parentLogicalPath: resolved.relativePath,
        context,
        thumbsEnabled,
        excludeDownloadArtifacts: false,
        includeHiddenFiles,
        permissionRules: settings?.access?.rules || [],
        shareCache,
        userVolumeCache,
        itemExtras: () => ({
          access: {
            canRead: true,
            canWrite: accessInfo.canWrite,
            canDelete: accessInfo.canDelete,
            canShare: false,
            canDownload: true,
          },
        }),
      });

      const response = {
        items,
        access: {
          canRead: accessInfo.canRead,
          canWrite: accessInfo.canWrite,
          canUpload: accessInfo.canUpload,
          canDelete: accessInfo.canDelete,
          canShare: false,
          canDownload: accessInfo.canDownload,
        },
        current: {
          isDirectory: true,
        },
        path: resolved.relativePath,
      };

      // Add share metadata for breadcrumb display
      if (resolved?.shareInfo) {
        const share = resolved.shareInfo;
        const pathParts = (share.sourcePath || '').split('/').filter(Boolean);
        response.shareInfo = {
          label: share.label,
          sourceFolderName: pathParts[pathParts.length - 1] || '',
        };
      }

      return res.json(response);
    }

    // File share (virtual one-item directory)
    const name = path.basename(resolved.absolutePath);
    const ext = path.extname(name).slice(1).toLowerCase();
    const kind = ext.length > 10 ? 'unknown' : ext || 'unknown';

    const item = {
      name,
      path: resolved.relativePath,
      dateModified: stats.mtime,
      size: stats.size,
      kind,
      access: {
        canRead: true,
        canWrite: accessInfo.canWrite,
        canDelete: accessInfo.canDelete,
        canShare: false,
        canDownload: true,
      },
    };

    if (
      thumbsEnabled &&
      !stats.isDirectory() &&
      kind !== 'pdf' &&
      extensions.previewable.has(ext)
    ) {
      item.supportsThumbnail = true;
    }

    const response = {
      items: [item],
      access: {
        canRead: accessInfo.canRead,
        canWrite: accessInfo.canWrite,
        canUpload: false,
        canDelete: accessInfo.canDelete,
        canShare: false,
        canDownload: accessInfo.canDownload,
      },
      current: {
        isDirectory: false,
      },
      path: resolved.relativePath,
    };

    // Add share metadata for breadcrumb display
    if (resolved?.shareInfo) {
      const share = resolved.shareInfo;
      const pathParts = (share.sourcePath || '').split('/').filter(Boolean);
      response.shareInfo = {
        label: share.label,
        sourceFolderName: pathParts[pathParts.length - 1] || '',
      };
    }

    return res.json(response);
  })
);

module.exports = router;
