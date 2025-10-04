import { access, mkdir } from 'fs/promises';

export const ensureDir = async (targetPath: string): Promise<void> => {
  await mkdir(targetPath, { recursive: true });
};

export const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
};
