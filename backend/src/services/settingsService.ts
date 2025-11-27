const storage = require('./storage/jsonStorage');
const { normalizeRelativePath } = require('../utils/pathUtils');

export type AccessPermission = 'rw' | 'ro' | 'hidden';

export interface ThumbnailSettings {
  enabled: boolean;
  size: number;
  quality: number;
  concurrency: number;
}

export interface AccessRule {
  id: string;
  path: string;
  recursive: boolean;
  permissions: AccessPermission;
}

export interface Settings {
  thumbnails: ThumbnailSettings;
  access: {
    rules: AccessRule[];
  };
}

export type PartialSettings = {
  thumbnails?: Partial<ThumbnailSettings>;
  access?: {
    rules?: AccessRule[];
  };
};

/**
 * Sanitize thumbnail settings
 */
const sanitizeThumbnails = (thumbnails: Partial<ThumbnailSettings> | undefined = {}): ThumbnailSettings => {
  return {
    enabled: typeof thumbnails.enabled === 'boolean' ? thumbnails.enabled : true,
    size: Number.isFinite(thumbnails.size as number)
      ? Math.max(64, Math.min(1024, Math.floor((thumbnails.size as number) || 0)))
      : 200,
    quality: Number.isFinite(thumbnails.quality as number)
      ? Math.max(1, Math.min(100, Math.floor((thumbnails.quality as number) || 0)))
      : 70,
    concurrency: Number.isFinite(thumbnails.concurrency as number)
      ? Math.max(1, Math.min(50, Math.floor((thumbnails.concurrency as number) || 0)))
      : 10,
  };
};

/**
 * Sanitize access control rules
 */
const sanitizeAccessRules = (rules: unknown = []): AccessRule[] => {
  if (!Array.isArray(rules)) return [];
  
  return rules
    .map(rule => {
      if (!rule || typeof rule !== 'object') return null;
      
      // Validate path
      let normalizedPath;
      try {
        normalizedPath = normalizeRelativePath(rule.path || '');
      } catch {
        return null; // Invalid path
      }
      
      if (!normalizedPath) return null;
      
      // Validate permissions
      const permissions: AccessPermission = ['rw', 'ro', 'hidden'].includes((rule as any).permissions) 
        ? (rule as any).permissions 
        : 'rw';
      
      return {
        id: (rule as any).id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        path: normalizedPath,
        recursive: Boolean((rule as any).recursive),
        permissions,
      };
    })
    .filter(Boolean) as AccessRule[];
};

/**
 * Sanitize complete settings object
 */
const sanitize = (settings: PartialSettings): Settings => {
  return {
    thumbnails: sanitizeThumbnails(settings?.thumbnails),
    access: {
      rules: sanitizeAccessRules(settings?.access?.rules),
    },
  };
};

/**
 * Get current settings
 */
const getSettings = async (): Promise<Settings> => {
  const data = await storage.get();
  return data.settings || ({
    thumbnails: { enabled: true, size: 200, quality: 70, concurrency: 10 },
    access: { rules: [] },
  } as Settings);
};

/**
 * Update settings with partial data
 * Deep merges with existing settings
 */
const setSettings = async (partial: PartialSettings): Promise<Settings> => {
  const current = await getSettings();
  
  // Deep merge
  const merged = {
    thumbnails: { ...current.thumbnails, ...(partial.thumbnails || {}) },
    access: {
      rules: partial.access?.rules !== undefined 
        ? partial.access.rules 
        : current.access.rules,
    },
  };
  
  // Sanitize and save
  const updated = await storage.update((data) => ({
    ...data,
    settings: sanitize(merged),
  }));
  
  return updated.settings;
};

/**
 * Update settings with an updater function
 */
const updateSettings = async (
  updater: ((current: Settings) => PartialSettings | Settings) | undefined,
): Promise<Settings> => {
  const current = await getSettings();
  const next = typeof updater === 'function' ? updater(current) : current;
  return setSettings(next);
};

export {
  getSettings, 
  setSettings, 
  updateSettings,
};

module.exports = { 
  getSettings, 
  setSettings, 
  updateSettings,
};
