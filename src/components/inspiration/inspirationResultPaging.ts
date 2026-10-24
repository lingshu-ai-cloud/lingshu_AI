import type { TrendVideo } from '../../lib/inspirationTypes';
import type { CrawlTimeRange } from './inspirationDashboardContracts';

// Both existing APIs paginate before the page's cross-source filters (format,
// favorites). Read every source page before applying those filters and paging.
export async function readAllInspirationPages<T>(
  read: (page: number) => Promise<{ items: T[]; totalItems: number }>,
  key: (item: T) => string,
  active: () => boolean = () => true,
): Promise<T[]> {
  const items = new Map<string, T>();
  let received = 0;
  let expected: number | undefined;
  for (let page = 1; ; page += 1) {
    const result = await read(page);
    if (!active()) throw new Error('灵感筛选已更新');
    if (!Number.isSafeInteger(result.totalItems) || result.totalItems < 0
      || (expected !== undefined && expected !== result.totalItems)) throw new Error('灵感库存已变化，请刷新重试');
    expected = result.totalItems;
    received += result.items.length;
    for (const item of result.items) items.set(key(item), item);
    if (received >= expected) return [...items.values()];
    if (!result.items.length) throw new Error('灵感分页读取不完整，请重试');
  }
}

export function matchesInspirationCrawlRange(video: TrendVideo, range: CrawlTimeRange, now = Date.now()): boolean {
  if (range === 'all') return true;
  const timestamp = Date.parse(video.crawledAt || '');
  if (!Number.isFinite(timestamp)) return false;
  if (range === 'today') {
    const beijing = new Date(now + 8 * 60 * 60 * 1000);
    return timestamp >= Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate()) - 8 * 60 * 60 * 1000;
  }
  return timestamp >= now - (range === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
}

export function pageInspirationResults<T>(items: readonly T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, totalPages, totalItems: items.length };
}

export async function readInspirationInventory<T>(
  readPage: (format: 'video' | 'image', page: number) => Promise<{ items: T[]; totalItems: number; page?: number; totalPages?: number }>,
  format: 'all' | 'video' | 'image', page: number, complete: boolean,
  key: (item: T) => string, active: () => boolean,
) {
  const formats: Array<'video' | 'image'> = format === 'all' ? ['video', 'image'] : [format];
  const results = await Promise.all(formats.map(async kind => {
    if (!complete && format !== 'all') return readPage(kind, page);
    let totalItems = 0;
    const items = await readAllInspirationPages(async current => {
      const result = await readPage(kind, current);
      totalItems = result.totalItems;
      return result;
    }, key, active);
    return { items, totalItems, page: 1, totalPages: 1 };
  }));
  return { items: results.flatMap(result => result.items),
    totalItems: results.reduce((total, result) => total + result.totalItems, 0),
    page: results[0]?.page || 1, totalPages: results[0]?.totalPages || 1 };
}
