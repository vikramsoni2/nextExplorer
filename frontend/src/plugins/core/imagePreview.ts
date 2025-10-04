import { isPreviewableImage } from '@/config/media';
import type { PreviewPlugin } from '@/plugins/preview/types';

export const imagePreviewPlugin = (): PreviewPlugin => ({
  id: 'core-image-preview',
  label: 'Image Preview',
  priority: 20,
  standalone: true,
  match: (ctx) => isPreviewableImage(ctx.extension),
  component: () => import('./ImagePreview.vue'),
});
