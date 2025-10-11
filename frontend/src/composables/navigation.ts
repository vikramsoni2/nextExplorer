import { useRoute, useRouter } from 'vue-router';

import { isEditableExtension } from '@/config/editor';
import { usePreviewManager } from '@/plugins/preview/manager';
import type { ExplorerItem } from '@/stores/fileStore';
import type { VolumeEntry } from '@/api';
import { withViewTransition } from '@/utils';

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  const previewManager = usePreviewManager();

  type NavigableItem = ExplorerItem | VolumeEntry | null;

  const openItem = withViewTransition((item: NavigableItem) => {
    if (!item) return;

    const extensionFromKind = typeof item.kind === 'string' ? item.kind.toLowerCase() : '';
    const extensionFromName = typeof item.name === 'string' && item.name.includes('.')
      ? (item.name.split('.').pop() ?? '').toLowerCase()
      : '';

    if (item.kind === 'volume') {
      router.push({ path: `/browse/${item.name}` });
      return;
    }
    if (item.kind === 'directory') {
      const currentPathParam = typeof route.params.path === 'string' ? route.params.path : Array.isArray(route.params.path) ? route.params.path.join('/') : '';
      const newPath = currentPathParam ? `${currentPathParam}/${item.name}` : item.name;
      router.push({ path: `/browse/${newPath}` });
      return;
    }
    if (previewManager.open(item)) {
      return;
    }

    if (isEditableExtension(extensionFromKind) || isEditableExtension(extensionFromName)) {
      const basePath = item.path ? `${item.path}/${item.name}` : item.name;
      const fileToEdit = basePath.replace(/^\/+/, '');
      router.push({ path: `/editor/${fileToEdit}` });
      return;
    }
  });
  

  const openBreadcrumb = withViewTransition((path: string) => {
    router.push({ path: `/browse/${path}` });
  });

  const goNext = withViewTransition(() => router.go(1));

  const goPrev = withViewTransition(() => router.go(-1));

  const goUp = withViewTransition(() => {
    const path = decodeURIComponent(router.currentRoute.value.path);
    const segments = path.split('/').slice(2);
    if (segments.length > 0) {
      segments.pop();
      router.push({ path: `/browse/${segments.join('/')}` });
    }
  });


  return {
    openItem,
    openBreadcrumb,
    goNext,
    goPrev,
    goUp,
  };
}




// const goForward = ()=>{
  //   router.go(1);
  // }

  // const goBackward = ()=>{
  //   router.go(-1);
  // }

  // const goUpward = ()=>{
  //   const path = route.params.path.split('/');
  //   path.pop();
  //   const new_path = path.join('/');
  //   router.push({ name: 'browse', params: {path: new_path} });
  // }

  // const canGoForward = ()=>{

  //   //check in router object if the route can go forward.
  //   return router.currentRoute.value.meta.canGoForward;
    

  // }
