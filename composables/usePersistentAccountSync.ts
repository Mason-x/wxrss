import {
  formatRunningSyncText,
  getEffectiveAccountSyncTimestamp,
  getKnownSyncPercent,
  shouldStopAfterAccountSyncPage,
  shouldUseHistoryBackfill,
} from '#shared/utils/account-profile';
import { pickRandomSyncDelayMs } from '#shared/utils/sync-delay';
import { getArticleList, refreshMissingAccountProfile, syncRssFeed } from '~/apis';
import {
  getPersistentSyncLoopToken,
  nextPersistentSyncLoopToken,
  type PersistentSyncJob,
  type PersistentSyncRuntimeState,
  registerPersistentSyncScrapeStopper,
  usePersistentAccountSyncState,
} from '~/composables/usePersistentAccountSyncState';
import { ARTICLE_LIST_PAGE_SIZE } from '~/config';
import { getArticleCacheSummary } from '~/store/v2/article';
import { getInfoCache, isRssAccount, type MpAccount } from '~/store/v2/info';
import type { Preferences } from '~/types/preferences';

export default function usePersistentAccountSync() {
  const state = usePersistentAccountSyncState();
  const {
    job,
    runtimeStates,
    banner,
    isSyncing,
    syncingRowId,
    setRuntime,
    setRunning,
    setError,
    clearRuntime,
    setBanner,
    dismissBanner,
    cancelSync,
  } = state;
  const preferences = usePreferences();
  const { getSyncTimestamp } = useSyncDeadline();
  const { scrapeUncachedAccountHtml, stop: stopArticleScrape } = useSyncArticleScraper({
    isCanceled: () => job.value.canceled,
  });
  registerPersistentSyncScrapeStopper(stopArticleScrape);

  function publishRunningBanner(
    account: MpAccount,
    runtime: PersistentSyncRuntimeState,
    extras: Partial<PersistentSyncJob> = {}
  ) {
    const percent = getKnownSyncPercent({
      syncedMessages: runtime.syncedMessages,
      totalMessages: runtime.totalMessages,
    });
    const currentIndex = extras.currentIndex ?? job.value.currentIndex;
    const totalAccounts = extras.totalAccounts ?? job.value.totalAccounts;
    const modeLabel = extras.modeLabel ?? job.value.modeLabel;
    setBanner({
      tone: 'blue',
      title: totalAccounts > 1 ? `正在同步 ${currentIndex}/${totalAccounts}` : '正在同步',
      detail: formatRunningSyncText(runtime),
      progressPercent: percent,
      currentAccountName: account.nickname || account.fakeid,
      failedCount: extras.failedCount ?? job.value.failedCount,
      updatedAt: Date.now(),
      currentIndex,
      totalAccounts,
      modeLabel,
    });
  }

  async function loadOneAccountPage(
    account: MpAccount,
    begin: number,
    loadMore: boolean,
    token: number,
    options: { initialPageSize?: number; allowHistoryBackfill?: boolean; stopWhenNoNewOnThisPage?: boolean }
  ): Promise<void> {
    if (job.value.canceled || token !== getPersistentSyncLoopToken()) {
      throw new Error('已取消同步');
    }

    const initialPageSize = Number(options.initialPageSize) || 0;
    const allowHistoryBackfill = Boolean(options.allowHistoryBackfill);
    const stopWhenNoNewOnThisPage = options.stopWhenNoNewOnThisPage !== false;
    const effectiveSyncTimestamp = getEffectiveAccountSyncTimestamp(
      getSyncTimestamp(),
      Number(account.last_update_time) || 0,
      allowHistoryBackfill
    );

    setRunning(account);
    job.value = {
      ...job.value,
      running: true,
      currentFakeid: account.fakeid,
      currentNickname: account.nickname || account.fakeid,
    };

    const [articles, completed, totalCount, pageMessageCount, inserted] = await getArticleList(
      account,
      begin,
      '',
      begin === 0
        ? allowHistoryBackfill
          ? { pageSize: ARTICLE_LIST_PAGE_SIZE }
          : initialPageSize > 0
            ? { initialPageSize }
            : {}
        : {}
    );

    if (job.value.canceled || token !== getPersistentSyncLoopToken()) {
      throw new Error('已取消同步');
    }

    const latest = (await getInfoCache(account.fakeid)) || account;
    const scannedMessages = begin + (Number(pageMessageCount) || 0);
    const runtime: PersistentSyncRuntimeState = {
      status: 'running',
      syncedMessages: Number(latest.count) || 0,
      scannedMessages,
      totalMessages: completed ? Number(totalCount) || scannedMessages : 0,
      syncedArticles: Number(latest.articles) || 0,
      errorMessage: '',
      updatedAt: Date.now(),
      source: 'local',
    };
    setRuntime(account.fakeid, runtime);
    publishRunningBanner(latest, runtime);

    const requestedSize =
      begin === 0
        ? allowHistoryBackfill
          ? ARTICLE_LIST_PAGE_SIZE
          : initialPageSize > 0
            ? Math.min(ARTICLE_LIST_PAGE_SIZE, initialPageSize)
            : 1
        : ARTICLE_LIST_PAGE_SIZE;
    if (
      shouldStopAfterAccountSyncPage({
        completed,
        pageMessageCount: Number(pageMessageCount) || 0,
        inserted: Number(inserted) || 0,
        stopWhenNoNewOnThisPage,
        requestedSize,
      })
    ) {
      return;
    }

    const countByItemidx = articles.filter(article => Number(article.itemidx) === 1).length;
    const countByAppmsg = new Set(
      articles.map(article => Number(article.appmsgid)).filter(appmsgid => Number.isFinite(appmsgid) && appmsgid > 0)
    ).size;
    const count = Number(pageMessageCount) > 0 ? Number(pageMessageCount) : countByItemidx || countByAppmsg || 1;
    begin += count;

    let cacheBoundaryCreateTime = 0;
    const lastArticle = articles.at(-1);
    if (lastArticle && lastArticle.create_time < (account.last_update_time || 0)) {
      const summary = await getArticleCacheSummary(account.fakeid, lastArticle.create_time);
      if (summary.cachedRows > 0) {
        begin += summary.cachedMessageCount;
        cacheBoundaryCreateTime = summary.oldestCreateTime;
      }
    }

    const tailCreateTime =
      cacheBoundaryCreateTime > 0 ? cacheBoundaryCreateTime : Number(articles.at(-1)?.create_time) || 0;
    if (tailCreateTime > 0 && tailCreateTime < effectiveSyncTimestamp) {
      loadMore = false;
    }

    if (!loadMore) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      window.setTimeout(
        () => {
          if (job.value.canceled || token !== getPersistentSyncLoopToken()) {
            reject(new Error('已取消同步'));
            return;
          }
          resolve();
        },
        pickRandomSyncDelayMs(preferences.value as unknown as Preferences)
      );
    });

    await loadOneAccountPage(latest, begin, true, token, {
      allowHistoryBackfill,
      stopWhenNoNewOnThisPage,
    });
  }

  async function syncOneAccount(
    account: MpAccount,
    token: number,
    options: { loadMore?: boolean; initialPageSize?: number } = {}
  ) {
    const loadMore = options.loadMore !== false;
    const initialPageSize = Number(options.initialPageSize) || 0;

    if (isRssAccount(account)) {
      setRunning(account);
      try {
        const result = await syncRssFeed({ fakeid: account.fakeid });
        clearRuntime(account.fakeid);
        return result.account;
      } catch (error) {
        setError(account.fakeid, String((error as Error)?.message || 'RSS 同步失败'));
        throw error;
      }
    }

    const allowHistoryBackfill = shouldUseHistoryBackfill(account, loadMore);
    await loadOneAccountPage(account, 0, loadMore, token, {
      initialPageSize,
      allowHistoryBackfill,
      stopWhenNoNewOnThisPage: !allowHistoryBackfill,
    });

    if (!job.value.canceled && token === getPersistentSyncLoopToken()) {
      await scrapeUncachedAccountHtml(account.fakeid, account.nickname || account.fakeid, { silent: true });
      await refreshMissingAccountProfile(account);
    }
    clearRuntime(account.fakeid);
    return (await getInfoCache(account.fakeid)) || account;
  }

  async function startSync(
    accounts: MpAccount[],
    options: { loadMore?: boolean; initialPageSize?: number } = {}
  ): Promise<{ successCount: number; failedCount: number; canceled: boolean }> {
    const targets = accounts.filter(account => Boolean(account?.fakeid));
    if (targets.length === 0) {
      return { successCount: 0, failedCount: 0, canceled: false };
    }
    if (job.value.running) {
      cancelSync();
    }

    const token = nextPersistentSyncLoopToken();
    const loadMore = options.loadMore !== false;
    const modeLabel = loadMore ? (shouldUseHistoryBackfill(targets[0], true) ? '回补历史' : '增量更新') : '首次同步';
    job.value = {
      running: true,
      canceled: false,
      currentFakeid: targets[0].fakeid,
      currentNickname: targets[0].nickname || targets[0].fakeid,
      currentIndex: 1,
      totalAccounts: targets.length,
      successCount: 0,
      failedCount: 0,
      modeLabel,
    };
    setBanner({
      tone: 'blue',
      title: targets.length > 1 ? `正在同步 1/${targets.length}` : '正在同步',
      detail: '正在准备拉取文章列表',
      progressPercent: 0,
      currentAccountName: targets[0].nickname || targets[0].fakeid,
      failedCount: 0,
      updatedAt: Date.now(),
      currentIndex: 1,
      totalAccounts: targets.length,
      modeLabel,
    });

    let successCount = 0;
    let failedCount = 0;
    let canceled = false;

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (job.value.canceled || token !== getPersistentSyncLoopToken()) {
          canceled = true;
          break;
        }
        const account = targets[index];
        job.value = {
          ...job.value,
          currentFakeid: account.fakeid,
          currentNickname: account.nickname || account.fakeid,
          currentIndex: index + 1,
          modeLabel: loadMore ? (shouldUseHistoryBackfill(account, true) ? '回补历史' : '增量更新') : '首次同步',
        };
        try {
          await syncOneAccount(account, token, options);
          successCount += 1;
          job.value = { ...job.value, successCount };
        } catch (error) {
          const message = String((error as Error)?.message || '同步失败');
          if (message === '已取消同步') {
            canceled = true;
            break;
          }
          failedCount += 1;
          job.value = { ...job.value, failedCount };
          if (message === 'session expired') {
            setBanner({
              tone: 'rose',
              title: '同步失败',
              detail: '登录状态已失效，请重新登录后重试',
              progressPercent: 0,
              currentAccountName: account.nickname || account.fakeid,
              failedCount,
              updatedAt: Date.now(),
              currentIndex: index + 1,
              totalAccounts: targets.length,
            });
            throw error;
          }
        }
      }

      if (canceled) {
        setBanner({
          tone: 'amber',
          title: '同步已取消',
          detail: `已完成 ${successCount} 个账号，剩余任务未继续执行`,
          progressPercent: 0,
          currentAccountName: '',
          failedCount,
          updatedAt: Date.now(),
          currentIndex: job.value.currentIndex,
          totalAccounts: targets.length,
        });
      } else if (failedCount === 0) {
        setBanner({
          tone: 'green',
          title: '同步完成',
          detail:
            targets.length > 1
              ? `本轮共完成 ${successCount} 个账号`
              : `账号【${targets[0].nickname || targets[0].fakeid}】已同步完成`,
          progressPercent: 100,
          currentAccountName: targets.length === 1 ? targets[0].nickname || targets[0].fakeid : '',
          failedCount: 0,
          updatedAt: Date.now(),
          currentIndex: targets.length,
          totalAccounts: targets.length,
        });
      } else {
        setBanner({
          tone: successCount > 0 ? 'amber' : 'rose',
          title: successCount > 0 ? '部分同步失败' : '同步失败',
          detail: `成功 ${successCount} 个，失败 ${failedCount} 个`,
          progressPercent: 0,
          currentAccountName: '',
          failedCount,
          updatedAt: Date.now(),
          currentIndex: targets.length,
          totalAccounts: targets.length,
        });
      }

      return { successCount, failedCount, canceled };
    } finally {
      if (token === getPersistentSyncLoopToken()) {
        job.value = {
          ...job.value,
          running: false,
          currentFakeid: '',
        };
      }
    }
  }

  return {
    job,
    runtimeStates,
    banner,
    isSyncing,
    syncingRowId,
    setRunning,
    setError,
    clearRuntime,
    setBanner,
    startSync,
    cancelSync,
    dismissBanner,
  };
}
