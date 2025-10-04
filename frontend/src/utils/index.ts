import dayjs from 'dayjs';

export function formatDate(unixTimestamp: number | string | Date): string {
  return dayjs(unixTimestamp).format('YYYY-MM-DD HH:mm:ss');
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

type StartViewTransition = (callback: () => void) => void;

export function withViewTransition<T extends (...args: any[]) => any>(func: T) {
  return (...args: Parameters<T>): ReturnType<T> | void => {
    const startTransition = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
    if (!startTransition) {
      return func(...args);
    }

    startTransition(() => {
      func(...args);
    });
    return undefined;
  };
}
