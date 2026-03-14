import { getSqliteDb } from '~/server/db/sqlite';

export interface CachedNewrankRecommendationRecord<T = any> {
  categoryId: string;
  month: string;
  monthLabel: string;
  items: T[];
  updatedAt: number;
}

interface NewrankRecommendationCacheRow {
  category_id: string;
  month: string;
  month_label: string;
  items_json: string;
  updated_at: number;
}

function parseItemsJson<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function getCachedNewrankRecommendations<T = any>(
  categoryId: string
): Promise<CachedNewrankRecommendationRecord<T> | null> {
  const db = await getSqliteDb();
  const row = await db.get<NewrankRecommendationCacheRow>(
    `
    SELECT category_id, month, month_label, items_json, updated_at
    FROM newrank_recommendation_cache
    WHERE category_id = ?
    `,
    categoryId
  );

  if (!row) {
    return null;
  }

  return {
    categoryId: row.category_id,
    month: String(row.month || ''),
    monthLabel: String(row.month_label || ''),
    items: parseItemsJson<T>(row.items_json),
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function upsertCachedNewrankRecommendations<T = any>(input: {
  categoryId: string;
  month: string;
  monthLabel: string;
  items: T[];
}): Promise<void> {
  const db = await getSqliteDb();
  await db.run(
    `
    INSERT INTO newrank_recommendation_cache(category_id, month, month_label, items_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category_id) DO UPDATE SET
      month = excluded.month,
      month_label = excluded.month_label,
      items_json = excluded.items_json,
      updated_at = excluded.updated_at
    `,
    input.categoryId,
    String(input.month || ''),
    String(input.monthLabel || ''),
    JSON.stringify(Array.isArray(input.items) ? input.items : []),
    Date.now()
  );
}
