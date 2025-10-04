import type { PreviewPlugin } from '@/plugins/preview/types';

const PDF_EXTENSIONS = new Set(['pdf']);

export const pdfPreviewPlugin = (): PreviewPlugin => ({
  id: 'pdf-preview',
  label: 'PDF Preview',
  priority: 25,
  match: (ctx) => PDF_EXTENSIONS.has(ctx.extension),
  component: () => import('./PdfPreview.vue'),
  actions: (ctx) => {
    const path = ctx.filePath;
    if (!path) return [];
    return [
      {
        id: 'download',
        label: 'Download',
        run: () => ctx.api.download(path),
      },
    ];
  },
});
