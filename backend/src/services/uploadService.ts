import fs from 'fs';
import { unlink, rm, rename } from 'fs/promises';
import path from 'path';
import multer, { type StorageEngine } from 'multer';
import type { Request } from 'express';

import { ensureDir, pathExists } from '../utils/fsUtils';
import { findAvailableName, normalizeRelativePath, resolveVolumePath } from '../utils/pathUtils';
import { readMetaField } from '../utils/requestUtils';

interface UploadPaths {
  destinationPath: string;
  destinationDir: string;
}

type DestinationCallback = (error: Error | null, destination?: string) => void;
type FileCallback = (error: Error | null, info?: Partial<Express.Multer.File>) => void;

const resolveUploadPaths = (req: Request, file: Express.Multer.File): UploadPaths => {
  const relativePathMeta = readMetaField(req, 'relativePath');
  const uploadToMeta = readMetaField(req, 'uploadTo');

  const uploadTo = normalizeRelativePath(uploadToMeta);
  const relativePath = normalizeRelativePath(relativePathMeta) || path.basename(file.originalname);

  const destinationRoot = resolveVolumePath(uploadTo);
  const destinationPath = path.join(destinationRoot, relativePath);
  const destinationDir = path.dirname(destinationPath);

  return {
    destinationPath,
    destinationDir,
  };
};

type GetDestination = (req: Request, file: Express.Multer.File, cb: DestinationCallback) => void;

class CustomStorage implements StorageEngine {
  private readonly getDestination: GetDestination;

  constructor(opts?: { destination?: GetDestination }) {
    this.getDestination = opts?.destination ?? ((req, file, cb) => cb(null, '/uploads/'));
  }

  _handleFile(req: Request, file: Express.Multer.File, cb: FileCallback): void {
    this.getDestination(req, file, async (err) => {
      if (err) {
        cb(err);
        return;
      }

      try {
        const { destinationPath, destinationDir } = resolveUploadPaths(req, file);
        await ensureDir(destinationDir);

        let finalPath = destinationPath;
        if (await pathExists(finalPath)) {
          const desiredName = path.basename(destinationPath);
          const availableName = await findAvailableName(destinationDir, desiredName);
          finalPath = path.join(destinationDir, availableName);
        }

        const temporaryPath = `${finalPath}.uploading`;

        const cleanupTemporary = async () => {
          try {
            if (await pathExists(temporaryPath)) {
              await rm(temporaryPath, { force: true });
            }
          } catch (cleanupErr) {
            console.error('Failed to remove temporary upload file:', cleanupErr);
          }
        };

        const outStream = fs.createWriteStream(temporaryPath);
        const handleStreamError = async (streamErr: Error) => {
          await cleanupTemporary();
          cb(streamErr);
        };

        file.stream.on('error', handleStreamError);
        outStream.on('error', handleStreamError);

        outStream.on('finish', async () => {
          try {
            await rename(temporaryPath, finalPath);
            cb(null, {
              path: finalPath,
              size: outStream.bytesWritten,
              filename: path.basename(finalPath),
            });
          } catch (renameErr) {
            await cleanupTemporary();
            cb(renameErr as Error);
          }
        });

        file.stream.pipe(outStream);
      } catch (uploadError) {
        cb(uploadError as Error);
      }
    });
  }

  _removeFile(_req: Request, file: Express.Multer.File, cb: (error: Error | null) => void): void {
    if (!file || !file.path) {
      cb(null);
      return;
    }

    unlink(file.path)
      .then(() => cb(null))
      .catch((error: NodeJS.ErrnoException) => {
        if (error && error.code === 'ENOENT') {
          cb(null);
          return;
        }
        cb(error);
      });
  }
}

export const createUploadMiddleware = (): multer.Multer => multer({ storage: new CustomStorage({}) });
