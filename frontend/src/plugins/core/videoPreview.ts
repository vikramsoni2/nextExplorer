import { isPreviewableVideo } from '@/config/media';
import type { PreviewPlugin } from '@/plugins/preview/types';

export const videoPreviewPlugin = (): PreviewPlugin => ({
  id: 'core-video-preview',
  label: 'Video Preview',
  priority: 10,
  match: (ctx) => isPreviewableVideo(ctx.extension),
  component: () => import('./VideoPreview.vue'),
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
