/**
 * Shared JSDoc typedefs used across the NextExplorer frontend.
 * These are consumed through `import('@/types').TypeName` where needed.
 */

/**
 * Represents a file system entry returned by the backend.
 * @typedef {Object} FileItem
 * @property {string} name - Display name of the file or folder.
 * @property {string} path - Normalized parent path for the entry.
 * @property {'file' | 'directory' | 'volume' | string} kind - Item type identifier.
 * @property {number} [size] - Size in bytes for files; undefined for directories.
 * @property {string} [modified] - ISO timestamp string of the last modification.
 * @property {string} [mimeType] - MIME type hint provided by the backend.
 * @property {string} [extension] - File extension derived by the backend.
 * @property {boolean} [hasThumbnail] - Flag indicating if a thumbnail is available.
 * @property {string} [thumbnail] - Base64 or URL for an item thumbnail when cached.
 */

/**
 * State tracked while a rename interaction is in progress.
 * @typedef {Object} RenameState
 * @property {string} key - Composite key for the item being renamed.
 * @property {string} path - Normalized path to the parent directory.
 * @property {string} originalName - The original filename before editing.
 * @property {string} [draft] - Current text entered by the user.
 * @property {string} kind - Kind of item (file or directory).
 * @property {boolean} isNew - True when the rename comes from a freshly created entry.
 */

/**
 * Options that control the native file picker dialog.
 * @typedef {Object} UploaderDialogOptions
 * @property {boolean} [multiple=true] - Whether multiple file selection is allowed.
 * @property {string | string[]} [accept='*'] - Accepted file types in input `accept` format.
 * @property {boolean} [directory=false] - When true, allows selecting directories (where supported).
 */

/**
 * Representation passed to Uppy when adding files programmatically.
 * @typedef {Object} UploadFileInput
 * @property {string} name - File name used by Uppy.
 * @property {string} type - File MIME type.
 * @property {File} data - Raw file Blob reference.
 * @property {{ relativePath: string }} meta - Metadata forwarded to the backend.
 */

/**
 * Minimal surface of the Uppy instance consumed in the app.
 * @typedef {Object} UppyInstance
 * @property {(pluginId: string) => { setOptions(options: Record<string, any>): void } | undefined} getPlugin
 * @property {(fileId: string, meta: Record<string, any>) => void} setFileMeta
 * @property {(input: UploadFileInput) => void} addFile
 * @property {(event: string, handler: (...args: any[]) => void) => void} on
 * @property {(plugin: any, opts?: any) => UppyInstance} use
 * @property {() => void} close
 */

/**
 * Result produced by the generic file dialog composable.
 * @typedef {File[] | Record<string, File[]>} FileDialogResult
 */

/**
 * Persisted favorite entry linking to directories or files.
 * @typedef {Object} FavoriteEntry
 * @property {string} path - Normalized target path.
 * @property {string} icon - Icon identifier used for display.
 */

/**
 * @typedef {Object} ThumbnailSettings
 * @property {boolean} enabled
 * @property {number} size
 * @property {number} quality
 */

/**
 * @typedef {Object} SecuritySettings
 * @property {boolean} authEnabled
 */

/**
 * @typedef {Object} AccessSettings
 * @property {Array<Record<string, any>>} rules
 */

/**
 * Shape of the configurable application settings.
 * @typedef {Object} AppSettingsState
 * @property {ThumbnailSettings} thumbnails
 * @property {SecuritySettings} security
 * @property {AccessSettings} access
 */

/**
 * Sorting configuration used for directory listings.
 * @typedef {Object} SortOption
 * @property {number} key
 * @property {string} name
 * @property {string} by
 * @property {'asc' | 'desc'} order
 */

export {};
