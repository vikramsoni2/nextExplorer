import archiver from 'archiver';
import express, { type Request, type Response } from 'express';
import { createReadStream } from 'fs';
import type { Stats } from 'fs';
import { mkdir, rename, stat } from 'fs/promises';
import path from 'path';

import { extensions, mimeTypes } from '../config';
import { deleteItems, transferItems, type TransferItemInput } from '../services/fileTransferService';
import { pathExists } from '../utils/fsUtils';
import {
  combineRelativePath,
  ensureValidName,
  findAvailableFolderName,
  normalizeRelativePath,
  resolveVolumePath,
} from '../utils/pathUtils';

interface DirectoryItemMetadata {
  name: string;
  path: string;
  kind: string;
  size: number;
  dateModified: Date;
}

interface TransferRequestBody {
  items?: unknown;
  destination?: unknown;
}

interface RenameRequestBody {
  path?: unknown;
  name?: unknown;
  newName?: unknown;
}

interface CreateFolderBody {
  path?: unknown;
  destination?: unknown;
  name?: unknown;
}

interface DownloadTarget {
  relativePath: string;
  absolutePath: string;
  stats: Stats;
}

const router = express.Router();

const buildItemMetadata = async (
  absolutePath: string,
  relativeParent: string,
  name: string,
): Promise<DirectoryItemMetadata> => {
  const stats = await stat(absolutePath);
  const kind = stats.isDirectory()
    ? 'directory'
    : (() => {
      const extension = path.extname(name).slice(1).toLowerCase();
      return extension.length > 10 ? 'unknown' : extension || 'unknown';
    })();

  return {
    name,
    path: relativeParent,
    kind,
    size: stats.size,
    dateModified: stats.mtime,
  };
};

router.post('/files/folder', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateFolderBody | undefined;
    const destination = typeof body?.path === 'string' ? body.path : typeof body?.destination === 'string' ? body.destination : '';
    const requestedName = typeof body?.name === 'string' ? body.name : undefined;

    const parentRelative = normalizeRelativePath(destination || '');
    const parentAbsolute = resolveVolumePath(parentRelative);

    let parentStats: Stats;
    try {
      parentStats = await stat(parentAbsolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new Error('Destination path does not exist.');
      }
      throw error;
    }

    if (!parentStats.isDirectory()) {
      throw new Error('Destination must be an existing directory.');
    }

    const baseName = requestedName && requestedName.trim()
      ? ensureValidName(requestedName)
      : 'Untitled Folder';

    const finalName = await findAvailableFolderName(parentAbsolute, baseName);
    const folderAbsolute = path.join(parentAbsolute, finalName);

    await mkdir(folderAbsolute);

    const item = await buildItemMetadata(folderAbsolute, parentRelative, finalName);
    res.status(201).json({ success: true, item });
  } catch (error) {
    const message = (error as Error)?.message || 'Create folder failed.';
    console.error('Create folder failed:', error);
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/files/rename', async (req: Request, res: Response) => {
  try {
    const body = req.body as RenameRequestBody | undefined;
    const parentPath = typeof body?.path === 'string' ? body.path : '';
    const originalName = typeof body?.name === 'string' ? body.name : undefined;
    const newNameRaw = typeof body?.newName === 'string' ? body.newName : undefined;

    if (!originalName) {
      throw new Error('Original name is required.');
    }

    const parentRelative = normalizeRelativePath(parentPath);
    const parentAbsolute = resolveVolumePath(parentRelative);

    const currentRelative = combineRelativePath(parentRelative, originalName);
    const currentAbsolute = resolveVolumePath(currentRelative);

    if (!(await pathExists(currentAbsolute))) {
      throw new Error('Item not found.');
    }

    const validatedNewName = newNameRaw ? ensureValidName(newNameRaw) : null;

    if (!validatedNewName) {
      throw new Error('A new name is required.');
    }

    if (validatedNewName === originalName) {
      const item = await buildItemMetadata(currentAbsolute, parentRelative, originalName);
      res.json({ success: true, item });
      return;
    }

    const targetRelative = combineRelativePath(parentRelative, validatedNewName);
    const targetAbsolute = resolveVolumePath(targetRelative);

    if (await pathExists(targetAbsolute)) {
      throw new Error(`The name "${validatedNewName}" is already taken.`);
    }

    await rename(currentAbsolute, targetAbsolute);

    const item = await buildItemMetadata(targetAbsolute, parentRelative, validatedNewName);
    res.json({ success: true, item });
  } catch (error) {
    const message = (error as Error)?.message || 'Rename operation failed.';
    console.error('Rename operation failed:', error);
    res.status(400).json({ success: false, error: message });
  }
});

const asTransferItems = (value: unknown): TransferItemInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is TransferItemInput => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    return typeof (item as TransferItemInput).name === 'string';
  });
};

router.post('/files/copy', async (req: Request, res: Response) => {
  try {
    const body = req.body as TransferRequestBody | undefined;
    const items = asTransferItems(body?.items);
    const destination = typeof body?.destination === 'string' ? body.destination : '';
    const result = await transferItems(items, destination, 'copy');
    res.json({ success: true, ...result });
  } catch (error) {
    const message = (error as Error)?.message || 'Copy operation failed.';
    console.error('Copy operation failed:', error);
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/files/move', async (req: Request, res: Response) => {
  try {
    const body = req.body as TransferRequestBody | undefined;
    const items = asTransferItems(body?.items);
    const destination = typeof body?.destination === 'string' ? body.destination : '';
    const result = await transferItems(items, destination, 'move');
    res.json({ success: true, ...result });
  } catch (error) {
    const message = (error as Error)?.message || 'Move operation failed.';
    console.error('Move operation failed:', error);
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/files', async (req: Request, res: Response) => {
  try {
    const items = asTransferItems((req.body as TransferRequestBody | undefined)?.items);
    const results = await deleteItems(items);
    res.json({ success: true, items: results });
  } catch (error) {
    const message = (error as Error)?.message || 'Delete operation failed.';
    console.error('Delete operation failed:', error);
    res.status(400).json({ success: false, error: message });
  }
});

const collectInputPaths = (...sources: unknown[]): string[] => {
  const collected: string[] = [];

  const add = (value: unknown): void => {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }

    if (typeof value === 'string') {
      if (value.trim()) {
        collected.push(value);
      }
      return;
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.relativePath === 'string') {
        add(record.relativePath);
        return;
      }

      if (typeof record.path === 'string' && typeof record.name === 'string') {
        try {
          add(combineRelativePath(record.path, record.name));
        } catch (error) {
          // ignore invalid combined paths and continue collecting
        }
        return;
      }

      if (typeof record.path === 'string') {
        add(record.path);
      }
    }
  };

  sources.forEach(add);
  return collected;
};

const toPosix = (value = ''): string => value.replace(/\\/g, '/');

const stripBasePath = (relativePath: string, basePath: string): string => {
  const relPosix = toPosix(relativePath);
  const basePosix = toPosix(basePath);

  if (!basePosix) {
    return relPosix;
  }

  if (relPosix === basePosix) {
    const segments = relPosix.split('/');
    return segments[segments.length - 1] || relPosix;
  }

  const basePrefix = basePosix.endsWith('/') ? basePosix : `${basePosix}/`;
  if (relPosix.startsWith(basePrefix)) {
    const trimmed = relPosix.slice(basePrefix.length);
    return trimmed || relPosix.split('/').pop() || relPosix;
  }

  return relPosix;
};

const handleDownloadRequest = async (paths: string[], res: Response, basePath = ''): Promise<void> => {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('At least one path is required.');
  }

  const normalizedPaths = [...new Set(paths.map((item) => normalizeRelativePath(item)).filter(Boolean))];
  if (normalizedPaths.length === 0) {
    throw new Error('No valid paths provided.');
  }

  const baseNormalized = basePath ? normalizeRelativePath(basePath) : '';

  const targets: DownloadTarget[] = await Promise.all(normalizedPaths.map(async (relativePath) => {
    const absolutePath = resolveVolumePath(relativePath);
    const stats = await stat(absolutePath);
    return { relativePath, absolutePath, stats };
  }));

  const hasDirectory = targets.some(({ stats }) => stats.isDirectory());
  const shouldArchive = hasDirectory || targets.length > 1;

  if (!shouldArchive) {
    const [{ absolutePath, relativePath }] = targets;
    const filename = (() => {
      if (!baseNormalized) {
        return path.basename(absolutePath);
      }

      const relativePosix = stripBasePath(relativePath, baseNormalized);
      const basename = relativePosix.split('/').pop();
      return basename || path.basename(absolutePath);
    })();

    res.download(absolutePath, filename, (err) => {
      if (err) {
        console.error('Download failed:', err);
        if (!res.headersSent) {
          res.status(500).send('Failed to download file.');
        }
      }
    });
    return;
  }

  const archiveName = (() => {
    if (targets.length === 1) {
      const segments = targets[0].relativePath
        ? targets[0].relativePath.split(path.sep).filter(Boolean)
        : [];
      const baseName = segments.length > 0
        ? segments[segments.length - 1]
        : path.basename(targets[0].absolutePath);
      return `${baseName || 'download'}.zip`;
    }

    if (baseNormalized) {
      const segments = baseNormalized.split(path.sep).filter(Boolean);
      const baseName = segments.length > 0 ? segments[segments.length - 1] : baseNormalized;
      if (baseName) {
        return `${baseName}.zip`;
      }
    }

    return 'download.zip';
  })();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (archiveError) => {
    console.error('Archive creation failed:', archiveError);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create archive.' });
    } else {
      res.end();
    }
  });

  archive.pipe(res);

  targets.forEach(({ relativePath, absolutePath, stats: entryStats }) => {
    const entryNameRaw = stripBasePath(relativePath, baseNormalized);
    const entryName = entryNameRaw
      ? entryNameRaw.replace(/\\/g, '/').replace(/^\/+/, '')
      : path.basename(absolutePath);

    if (entryStats.isDirectory()) {
      archive.directory(absolutePath, entryName);
    } else {
      archive.file(absolutePath, { name: entryName || path.basename(absolutePath) });
    }
  });

  await archive.finalize();
};

router.post('/download', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const basePath = typeof body?.basePath === 'string'
      ? body.basePath
      : typeof body?.currentPath === 'string'
        ? body.currentPath
        : '';
    const paths = collectInputPaths(body?.path, body?.paths, body?.items);
    await handleDownloadRequest(paths, res, basePath);
  } catch (error) {
    console.error('Download request failed:', error);
    if (!res.headersSent) {
      const message = (error as Error)?.message || 'Failed to download files.';
      res.status(400).json({ error: message });
    }
  }
});

router.get('/preview', async (req: Request, res: Response) => {
  try {
    const relative = req.query?.path;
    if (typeof relative !== 'string' || !relative) {
      return res.status(400).json({ error: 'A file path is required.' });
    }

    const relativePath = normalizeRelativePath(relative);
    const absolutePath = resolveVolumePath(relativePath);
    const stats = await stat(absolutePath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot preview a directory.' });
    }

    const extension = path.extname(absolutePath).slice(1).toLowerCase();

    if (!extensions.previewable.has(extension)) {
      return res.status(415).json({ error: 'Preview is not available for this file type.' });
    }

    const mimeType = mimeTypes[extension] || 'application/octet-stream';
    const isVideo = extensions.videos.includes(extension);

    const streamFile = (options?: { start: number; end: number }) => {
      const stream = options ? createReadStream(absolutePath, options) : createReadStream(absolutePath);
      stream.on('error', (streamError) => {
        console.error('Preview stream failed:', streamError);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(streamError);
        }
      });
      stream.pipe(res);
    };

    if (isVideo) {
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
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });
        streamFile({ start, end });
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
      });
      streamFile();
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stats.size,
    });
    streamFile();
  } catch (error) {
    console.error('Preview request failed:', error);
    if (!res.headersSent) {
      const message = (error as Error)?.message || 'Failed to generate preview.';
      res.status(400).json({ error: message });
    } else {
      res.end();
    }
  }
});

export default router;
