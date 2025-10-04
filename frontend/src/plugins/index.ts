import type { Pinia } from 'pinia';

import { usePreviewManager } from '@/plugins/preview/manager';
import type { PreviewPlugin } from '@/plugins/preview/types';
import { imagePreviewPlugin } from '@/plugins/core/imagePreview';
import { videoPreviewPlugin } from '@/plugins/core/videoPreview';
import { markdownPreviewPlugin } from '@/plugins/markdown/markdownPreview';
import { pdfPreviewPlugin } from '@/plugins/pdf/pdfPreview';

type OptionalPlugin = PreviewPlugin | false | null | undefined;

export const installPreviewPlugins = (
  pinia: Pinia,
  additional: OptionalPlugin[] = [],
): void => {
  const manager = usePreviewManager(pinia);
  const plugins: PreviewPlugin[] = [
    imagePreviewPlugin(),
    videoPreviewPlugin(),
    pdfPreviewPlugin(),
    markdownPreviewPlugin(),
    ...additional.filter((plugin): plugin is PreviewPlugin => Boolean(plugin)),
  ];

  plugins.forEach((plugin) => manager.register(plugin));
};
