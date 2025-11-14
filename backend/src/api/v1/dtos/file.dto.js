/**
 * File DTOs
 * Data transfer objects for file-related responses
 */

class FileDto {
  /**
   * Convert file stats to DTO
   */
  static toPublic(file) {
    if (!file) return null;

    return {
      name: file.name,
      path: file.path,
      kind: file.kind || file.extension || this.getKind(file.name),
      size: file.size,
      dateModified: file.dateModified || file.mtime || file.modifiedAt,
      ...(file.thumbnail && { thumbnail: file.thumbnail }),
      ...(file.isDirectory !== undefined && { isDirectory: file.isDirectory })
    };
  }

  /**
   * Convert multiple files to DTOs
   */
  static toList(files) {
    if (!Array.isArray(files)) return [];
    return files.map(file => FileDto.toPublic(file));
  }

  /**
   * File metadata response
   */
  static toMetadata(file, metadata = {}) {
    return {
      ...FileDto.toPublic(file),
      metadata: {
        ...metadata,
        ...(metadata.exif && { exif: metadata.exif }),
        ...(metadata.duration && { duration: metadata.duration }),
        ...(metadata.hash && { hash: metadata.hash })
      }
    };
  }

  /**
   * Get file kind from name
   */
  static getKind(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext || 'file';
  }
}

module.exports = FileDto;
