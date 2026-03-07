import { request } from '#shared/utils/request';
import { upsertArticlesFromRemote } from './article';
import { type Asset, updateAssetCache } from './assets';
import { type CommentReplyAsset, updateCommentReplyCache } from './comment_reply';
import { db } from './db';
import { type DebugAsset, updateDebugCache } from './debug';
import { importMpAccounts, type MpAccount } from './info';

const ARTICLE_CHUNK_SIZE = 80;
const LARGE_CACHE_CHUNK_SIZE = 30;

type MigrationReason = 'migrated' | 'server-not-empty' | 'no-local-data';
type LargeCacheMigrationReason = 'migrated' | 'no-local-data';

interface AccountListResponse {
  list: MpAccount[];
  total: number;
}

export interface LegacyDataMigrationResult {
  migrated: boolean;
  accountCount: number;
  articleCount: number;
  reason: MigrationReason;
  markDone: boolean;
}

export interface LegacyLargeCacheMigrationResult {
  migrated: boolean;
  assetCount: number;
  commentReplyCount: number;
  debugCount: number;
  reason: LargeCacheMigrationReason;
  markDone: boolean;
}

async function clearLegacyAccountAndArticleTables() {
  await db.transaction('rw', db.info, db.article, async () => {
    await db.info.clear();
    await db.article.clear();
  });
}

async function hasServerAccounts(): Promise<boolean> {
  const resp = await request<AccountListResponse>('/api/web/reader/accounts', {
    query: {
      offset: 0,
      limit: 1,
    },
  });
  return Number(resp.total) > 0 || (Array.isArray(resp.list) && resp.list.length > 0);
}

export async function migrateLegacyIndexedDbToServer(): Promise<LegacyDataMigrationResult> {
  const localAccounts = (await db.info.toArray()) as MpAccount[];
  if (localAccounts.length === 0) {
    return {
      migrated: false,
      accountCount: 0,
      articleCount: 0,
      reason: 'no-local-data',
      markDone: true,
    };
  }

  const serverHasAccounts = await hasServerAccounts();
  if (serverHasAccounts) {
    // Server-side reader cache already exists. Skip legacy replay to avoid repeated startup migrations.
    return {
      migrated: false,
      accountCount: 0,
      articleCount: 0,
      reason: 'server-not-empty',
      markDone: true,
    };
  }
  await importMpAccounts(localAccounts);

  let totalMigratedArticles = 0;
  for (const account of localAccounts) {
    let offset = 0;
    for (;;) {
      const chunk = await db.article
        .where('fakeid')
        .equals(account.fakeid)
        .offset(offset)
        .limit(ARTICLE_CHUNK_SIZE)
        .toArray();
      if (chunk.length === 0) {
        break;
      }
      await upsertArticlesFromRemote(account, chunk, Number(account.total_count) || chunk.length);
      totalMigratedArticles += chunk.length;
      offset += chunk.length;
    }
  }

  await clearLegacyAccountAndArticleTables();

  return {
    migrated: true,
    accountCount: localAccounts.length,
    articleCount: totalMigratedArticles,
    reason: 'migrated',
    markDone: true,
  };
}

async function migrateAssetCacheTable(): Promise<number> {
  let migrated = 0;
  for (;;) {
    const chunk = (await db.asset.limit(LARGE_CACHE_CHUNK_SIZE).toArray()) as Asset[];
    if (chunk.length === 0) {
      break;
    }
    for (const item of chunk) {
      await updateAssetCache(item);
      migrated += 1;
    }
    await db.asset.bulkDelete(chunk.map(item => item.url));
  }
  return migrated;
}

async function migrateCommentReplyCacheTable(): Promise<number> {
  let migrated = 0;
  for (;;) {
    const chunk = (await db.comment_reply.limit(LARGE_CACHE_CHUNK_SIZE).toArray()) as CommentReplyAsset[];
    if (chunk.length === 0) {
      break;
    }
    for (const item of chunk) {
      await updateCommentReplyCache(item);
      migrated += 1;
    }
    await db.comment_reply.bulkDelete(chunk.map(item => `${item.url}:${item.contentID}`));
  }
  return migrated;
}

async function migrateDebugCacheTable(): Promise<number> {
  let migrated = 0;
  for (;;) {
    const chunk = (await db.debug.limit(LARGE_CACHE_CHUNK_SIZE).toArray()) as DebugAsset[];
    if (chunk.length === 0) {
      break;
    }
    for (const item of chunk) {
      await updateDebugCache(item);
      migrated += 1;
    }
    await db.debug.bulkDelete(chunk.map(item => item.url));
  }
  return migrated;
}

export async function migrateLegacyLargeCacheToServer(): Promise<LegacyLargeCacheMigrationResult> {
  const [assetTotal, commentReplyTotal, debugTotal] = await Promise.all([
    db.asset.count(),
    db.comment_reply.count(),
    db.debug.count(),
  ]);

  if (assetTotal + commentReplyTotal + debugTotal === 0) {
    return {
      migrated: false,
      assetCount: 0,
      commentReplyCount: 0,
      debugCount: 0,
      reason: 'no-local-data',
      markDone: true,
    };
  }

  const assetCount = await migrateAssetCacheTable();
  const commentReplyCount = await migrateCommentReplyCacheTable();
  const debugCount = await migrateDebugCacheTable();

  return {
    migrated: true,
    assetCount,
    commentReplyCount,
    debugCount,
    reason: 'migrated',
    markDone: true,
  };
}
