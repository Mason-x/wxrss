import toastFactory from '~/composables/toast';
import { listUncachedArticleUrls } from '~/store/v2/html';
import { Downloader } from '~/utils/download/Downloader';
import type { DownloaderStatus } from '~/utils/download/types';

function uniqueArticleLinks(urls: Array<string | undefined | null>): string[] {
  return Array.from(new Set(urls.map(url => String(url || '').trim()).filter(Boolean)));
}

export default function useSyncArticleScraper(options: { isCanceled?: () => boolean } = {}) {
  const toast = toastFactory();
  const scraping = ref(false);
  const completedCount = ref(0);
  const totalCount = ref(0);
  let activeDownloader: Downloader | null = null;

  function stop() {
    if (activeDownloader) {
      activeDownloader.stop();
    }
  }

  async function scrapeArticleHtml(
    urls: Array<string | undefined | null>,
    contextLabel = '',
    scrapeOptions: { silent?: boolean } = {}
  ): Promise<{ completed: number; failed: number; deleted: number; skipped: boolean }> {
    const pending = uniqueArticleLinks(urls);
    if (pending.length === 0 || options.isCanceled?.()) {
      return { completed: 0, failed: 0, deleted: 0, skipped: true };
    }

    scraping.value = true;
    completedCount.value = 0;
    totalCount.value = pending.length;
    const prefix = contextLabel ? `${contextLabel}：` : '';

    try {
      const downloader = new Downloader(pending);
      activeDownloader = downloader;
      downloader.on('download:progress', (_url: string, _success: boolean, status: DownloaderStatus) => {
        completedCount.value = status.completed.length + status.failed.length + status.deleted.length;
      });
      downloader.on('download:begin', () => {
        completedCount.value = 0;
        totalCount.value = pending.length;
      });

      const cancelTimer = window.setInterval(() => {
        if (options.isCanceled?.()) {
          downloader.stop();
        }
      }, 300);

      try {
        await downloader.startDownload('html');
      } finally {
        window.clearInterval(cancelTimer);
        downloader.removeAllListeners();
        if (activeDownloader === downloader) {
          activeDownloader = null;
        }
      }

      const status = downloader.getStatus();
      const completed = status.completed.length;
      const failed = status.failed.length;
      const deleted = status.deleted.length;
      if (options.isCanceled?.()) {
        if (!scrapeOptions.silent) {
          toast.warning('正文抓取已取消', `${prefix}已停止后续正文下载`);
        }
        return { completed, failed, deleted, skipped: false };
      }
      if (!scrapeOptions.silent) {
        if (failed > 0 || deleted > 0) {
          toast.warning(
            '正文抓取完成（部分失败）',
            `${prefix}成功 ${completed} 篇，失败 ${failed} 篇，已删除 ${deleted} 篇`
          );
        } else if (completed > 0) {
          toast.success('正文抓取完成', `${prefix}已抓取 ${completed} 篇文章内容`);
        }
      }
      return { completed, failed, deleted, skipped: false };
    } catch (error: any) {
      const message = String(error?.message || '正文抓取失败');
      if (!scrapeOptions.silent) {
        toast.warning('列表已同步，正文未抓取', message);
      }
      return { completed: 0, failed: pending.length, deleted: 0, skipped: true };
    } finally {
      scraping.value = false;
    }
  }

  async function scrapeUncachedAccountHtml(
    fakeid: string,
    contextLabel = '',
    scrapeOptions: { silent?: boolean } = {}
  ): Promise<{ completed: number; failed: number; deleted: number; skipped: boolean }> {
    const normalizedFakeid = String(fakeid || '').trim();
    if (!normalizedFakeid || options.isCanceled?.()) {
      return { completed: 0, failed: 0, deleted: 0, skipped: true };
    }

    try {
      const urls = await listUncachedArticleUrls(normalizedFakeid);
      return await scrapeArticleHtml(urls, contextLabel, scrapeOptions);
    } catch (error: any) {
      if (!scrapeOptions.silent) {
        toast.warning('列表已同步，正文未抓取', String(error?.message || '无法读取待抓取文章'));
      }
      return { completed: 0, failed: 0, deleted: 0, skipped: true };
    }
  }

  return {
    scraping,
    completedCount,
    totalCount,
    scrapeArticleHtml,
    scrapeUncachedAccountHtml,
    stop,
  };
}
