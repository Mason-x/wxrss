import { getSqliteDb } from '~/server/db/sqlite';
import { resolveAccountOwnerScope } from '~/server/repositories/account-owner';

export interface StorageUsageSummary {
  totalBytes: number;
  articleBytes: number;
  cacheBytes: number;
  articleCount: number;
  htmlCount: number;
  resourceCount: number;
  assetCount: number;
  commentCount: number;
  commentReplyCount: number;
  metadataCount: number;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function getStorageUsageSummary(authKey: string): Promise<StorageUsageSummary> {
  const owner = await resolveAccountOwnerScope(authKey);
  const db = await getSqliteDb();
  const row = await db.get<Record<string, number>>(
    `
    SELECT
      COALESCE((SELECT COUNT(1) FROM reader_articles WHERE owner_key = ?), 0) AS articleCount,
      COALESCE((SELECT COUNT(1) FROM cache_html WHERE owner_key = ?), 0) AS htmlCount,
      COALESCE((SELECT COUNT(1) FROM cache_resource WHERE owner_key = ?), 0) AS resourceCount,
      COALESCE((SELECT COUNT(1) FROM cache_asset WHERE owner_key = ?), 0) AS assetCount,
      COALESCE((SELECT COUNT(1) FROM cache_comment WHERE owner_key = ?), 0) AS commentCount,
      COALESCE((SELECT COUNT(1) FROM cache_comment_reply WHERE owner_key = ?), 0) AS commentReplyCount,
      COALESCE((SELECT COUNT(1) FROM cache_metadata WHERE owner_key = ?), 0) AS metadataCount,
      COALESCE((
        SELECT SUM(
          length(article_key) + length(link) + length(aid) + length(title) + length(digest) +
          length(author_name) + length(status) + length(data_json) + length(ai_summary) + length(ai_tags_json)
        )
        FROM reader_articles
        WHERE owner_key = ?
      ), 0) AS articleBytes,
      COALESCE((SELECT SUM(length(content_blob) + length(url) + length(title)) FROM cache_html WHERE owner_key = ?), 0) AS htmlBytes,
      COALESCE((SELECT SUM(length(content_blob) + length(url)) FROM cache_resource WHERE owner_key = ?), 0) AS resourceBytes,
      COALESCE((SELECT SUM(length(content_blob) + length(url)) FROM cache_asset WHERE owner_key = ?), 0) AS assetBytes,
      COALESCE((SELECT SUM(length(data_json) + length(url) + length(title)) FROM cache_comment WHERE owner_key = ?), 0) AS commentBytes,
      COALESCE((SELECT SUM(length(data_json) + length(url) + length(title) + length(content_id)) FROM cache_comment_reply WHERE owner_key = ?), 0) AS commentReplyBytes,
      COALESCE((SELECT SUM(length(data_json) + length(url) + length(title)) FROM cache_metadata WHERE owner_key = ?), 0) AS metadataBytes,
      COALESCE((SELECT SUM(length(resources_json) + length(url)) FROM cache_resource_map WHERE owner_key = ?), 0) AS resourceMapBytes
    `,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey,
    owner.ownerKey
  );

  const articleBytes = toNumber(row?.articleBytes);
  const cacheBytes =
    toNumber(row?.htmlBytes) +
    toNumber(row?.resourceBytes) +
    toNumber(row?.assetBytes) +
    toNumber(row?.commentBytes) +
    toNumber(row?.commentReplyBytes) +
    toNumber(row?.metadataBytes) +
    toNumber(row?.resourceMapBytes);

  return {
    totalBytes: articleBytes + cacheBytes,
    articleBytes,
    cacheBytes,
    articleCount: toNumber(row?.articleCount),
    htmlCount: toNumber(row?.htmlCount),
    resourceCount: toNumber(row?.resourceCount),
    assetCount: toNumber(row?.assetCount),
    commentCount: toNumber(row?.commentCount),
    commentReplyCount: toNumber(row?.commentReplyCount),
    metadataCount: toNumber(row?.metadataCount),
  };
}
