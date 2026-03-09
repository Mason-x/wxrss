import { request } from '#shared/utils/request';

const LEGACY_FOCUS_CATEGORY = '重点关注';

export type AccountSourceType = 'mp' | 'rss';

export interface MpAccount {
  fakeid: string;
  completed: boolean;
  count: number;
  articles: number;
  source_type?: AccountSourceType;
  source_url?: string;
  site_url?: string;
  description?: string;
  category?: string;
  focused?: boolean;
  nickname?: string;
  round_head_img?: string;
  total_count: number;
  create_time?: number;
  update_time?: number;
  last_update_time?: number;
}

interface AccountListResponse {
  list: MpAccount[];
  total: number;
  offset: number;
  limit: number;
}

export function normalizeAccountSourceType(value?: string): AccountSourceType {
  return value === 'rss' ? 'rss' : 'mp';
}

export function isRssAccount(account?: Partial<Pick<MpAccount, 'fakeid' | 'source_type'>> | null): boolean {
  return normalizeAccountSourceType(account?.source_type) === 'rss' || String(account?.fakeid || '').startsWith('rss:');
}

function normalizeMpAccount(account: MpAccount): MpAccount {
  return {
    ...account,
    source_type: normalizeAccountSourceType(account?.source_type),
    source_url: String(account?.source_url || ''),
    site_url: String(account?.site_url || ''),
    description: String(account?.description || ''),
    category: String(account?.category || ''),
    focused: Boolean(account?.focused),
    nickname: String(account?.nickname || ''),
    round_head_img: String(account?.round_head_img || ''),
  };
}

async function requestAccounts(query: Record<string, string | number>) {
  try {
    return await request<AccountListResponse>('/api/web/reader/accounts', {
      query,
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);
    if (statusCode === 401) {
      return {
        list: [],
        total: 0,
        offset: Number(query.offset) || 0,
        limit: Number(query.limit) || 0,
      };
    }
    throw error;
  }
}

export async function updateInfoCache(mpAccount: MpAccount): Promise<boolean> {
  await request('/api/web/reader/account-upsert', {
    method: 'POST',
    body: {
      account: normalizeMpAccount(mpAccount),
    },
  });
  return true;
}

export async function updateLastUpdateTime(fakeid: string): Promise<boolean> {
  await request('/api/web/reader/account-update', {
    method: 'POST',
    body: {
      fakeid,
      touchLastUpdate: true,
    },
  });
  return true;
}

export async function updateAccountCategory(fakeid: string, category: string): Promise<boolean> {
  await request('/api/web/reader/account-update', {
    method: 'POST',
    body: {
      fakeid,
      category,
    },
  });
  return true;
}

export async function updateAccountFocused(fakeid: string, focused: boolean): Promise<boolean> {
  await request('/api/web/reader/account-update', {
    method: 'POST',
    body: {
      fakeid,
      focused,
    },
  });
  return true;
}

export async function getInfoCache(fakeid: string): Promise<MpAccount | undefined> {
  const resp = await requestAccounts({
    fakeid,
    offset: 0,
    limit: 1,
  });
  const account = resp.list[0];
  if (!account) {
    return undefined;
  }

  const normalized = normalizeMpAccount(account);
  if ((normalized.category || '').trim() === LEGACY_FOCUS_CATEGORY && !normalized.focused) {
    normalized.focused = true;
    normalized.category = '';
    await updateAccountFocused(normalized.fakeid, true);
    await updateAccountCategory(normalized.fakeid, '');
  }

  return normalized;
}

export async function getAllInfo(): Promise<MpAccount[]> {
  const pageSize = 200;
  let offset = 0;
  let total = Infinity;
  const list: MpAccount[] = [];

  while (offset < total) {
    const resp = await requestAccounts({
      offset,
      limit: pageSize,
    });
    const rows = Array.isArray(resp.list) ? resp.list.map(normalizeMpAccount) : [];
    total = Number(resp.total) || 0;
    list.push(...rows);
    offset += rows.length;

    if (rows.length === 0) {
      break;
    }
  }

  const legacy = list.filter(account => (account.category || '').trim() === LEGACY_FOCUS_CATEGORY && !account.focused);
  if (legacy.length > 0) {
    await Promise.all(
      legacy.map(async account => {
        account.focused = true;
        account.category = '';
        await updateAccountFocused(account.fakeid, true);
        await updateAccountCategory(account.fakeid, '');
      })
    );
  }

  return list;
}

export async function getAccountNameByFakeid(fakeid: string): Promise<string | null> {
  const account = await getInfoCache(fakeid);
  if (!account) {
    return null;
  }

  return account.nickname || null;
}

export async function importMpAccounts(mpAccounts: MpAccount[]): Promise<void> {
  const normalized = mpAccounts.map(mpAccount => ({
    ...normalizeMpAccount(mpAccount),
    completed: false,
    count: 0,
    articles: 0,
    total_count: 0,
    create_time: undefined,
    update_time: undefined,
    last_update_time: undefined,
    focused: Boolean(mpAccount.focused),
  }));

  await request('/api/web/reader/account-import', {
    method: 'POST',
    body: {
      accounts: normalized,
    },
  });
}
