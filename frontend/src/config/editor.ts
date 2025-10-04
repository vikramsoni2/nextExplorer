const DEFAULT_EDITOR_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'json5',
  'yml',
  'yaml',
  'xml',
  'log',
  'ini',
  'cfg',
  'conf',
  'env',
  'properties',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'php',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'swift',
  'kt',
  'scala',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'vue',
  'svelte',
  'astro',
  'html',
  'css',
  'scss',
  'sass',
  'less',
];

const envExtensions = (import.meta.env.VITE_EDITOR_EXTENSIONS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value): value is string => Boolean(value));

const editableExtensionsSet = new Set([
  ...DEFAULT_EDITOR_EXTENSIONS,
  ...envExtensions,
]);

const getEditableExtensions = (): string[] => Array.from(editableExtensionsSet.values());

const isEditableExtension = (extension = ''): boolean => {
  if (!extension) return false;
  return editableExtensionsSet.has(extension.toLowerCase());
};

export {
  getEditableExtensions,
  isEditableExtension,
};
