import type { PreviewPlugin } from '@/plugins/preview/types';

const EXTENSIONS = new Set(['md', 'markdown']);

export const markdownPreviewPlugin = (): PreviewPlugin => ({
  id: 'markdown-preview',
  label: 'Markdown Preview',
  priority: 30,
  match: (ctx) => EXTENSIONS.has(ctx.extension),
  component: () => import('./MarkdownPreview.vue'),
  actions: (ctx) => {
    const path = ctx.filePath;
    return [
      {
        id: 'edit',
        label: 'Open in Editor',
        variant: 'primary',
        run: () => {
          if (path) {
            ctx.api.openEditor(path);
          }
        },
      },
      {
        id: 'download',
        label: 'Download',
        run: () => {
          if (path) {
            ctx.api.download(path);
          }
        },
      },
    ];
  },
});
