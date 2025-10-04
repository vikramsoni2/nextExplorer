export interface PreviewItem {
  name: string;
  path?: string;
  kind?: string;
  size?: number;
  dateModified?: string | number | Date;
  thumbnail?: string;
}

export interface PreviewApi {
  getPreviewUrl: (path: string) => string | null;
  fetchFileContent: (path: string) => Promise<{ content: string }>;
  openEditor: (path: string) => void;
  closePreview: () => void;
  download: (path: string) => void;
}

export interface PreviewContext {
  item: PreviewItem | null;
  extension: string;
  previewUrl: string | null;
  filePath: string | null;
  manager: PreviewManager;
  api: PreviewApi;
  plugin: PreviewPlugin;
}

export interface PreviewAction {
  id: string;
  label: string;
  run: (ctx: PreviewContext) => void | Promise<void>;
  variant?: 'primary' | 'default';
}

export interface PreviewPlugin {
  id: string;
  label: string;
  priority?: number;
  standalone?: boolean;
  match: (ctx: PreviewContext) => boolean;
  component: () => Promise<unknown> | unknown;
  actions?: (ctx: PreviewContext) => PreviewAction[] | void;
  onOpen?: (ctx: PreviewContext) => void;
  onClose?: (ctx: PreviewContext) => void;
}

export interface PreviewManager {
  register: (plugin: PreviewPlugin) => void;
  unregister: (pluginId: string) => void;
  findPlugin: (item: PreviewItem | null | undefined) => {
    plugin: PreviewPlugin;
    context: PreviewContext;
  } | null;
  open: (item: PreviewItem | null | undefined) => boolean;
  close: () => void;
  getCurrent: () => PreviewContext | null;
  getPlugins: () => PreviewPlugin[];
}
