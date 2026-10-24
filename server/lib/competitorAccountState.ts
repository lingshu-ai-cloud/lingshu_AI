export type CompetitorCrawlState = {
  crawlStatus?: 'running' | 'completed' | 'failed'; crawlError?: string; crawlStartedAt?: string;
  crawlCompletedAt?: string; lastCrawledAt?: string; lastCrawlCount?: number;
};
export type CompetitorCrawlJob = {
  id: string; tenantId: string; status: string; createdAt: string; finishedAt?: string;
  error?: string; resultJson?: string;
};
/** Worker status is authoritative for an account's persisted job receipt. */
export function competitorAccountCrawlState(record: CompetitorCrawlState, job?: CompetitorCrawlJob, now = Date.now()): CompetitorCrawlState {
  if (job) {
    if (job.status === 'queued' || job.status === 'running') return { crawlStatus: 'running', crawlError: '', crawlStartedAt: job.createdAt };
    if (job.status === 'failed') return { crawlStatus: 'failed', crawlError: job.error || '采集任务失败，请重试' };
    if (job.status === 'done') {
      let result: { imported?: number } = {};
      try {
        const parsed = JSON.parse(job.resultJson || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed;
      } catch { /* Preserve recorded count if no receipt. */ }
      return { crawlStatus: 'completed', crawlError: '', lastCrawledAt: job.finishedAt || record.lastCrawledAt,
        lastCrawlCount: Number.isFinite(result.imported) ? result.imported : record.lastCrawlCount };
    }
  }
  if (record.crawlStatus === 'running' && record.crawlStartedAt && now - Date.parse(record.crawlStartedAt) > 30 * 60_000) {
    return { crawlStatus: 'failed', crawlError: '采集长时间未完成，请重试或检查采集服务' };
  }
  return { crawlStatus: record.crawlStatus, crawlError: record.crawlError || '' };
}

export async function readAllCompetitorAccountPages<T>(read: (page: number) => Promise<{ items: T[]; totalPages: number }>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await read(page);
    items.push(...result.items);
    if (page >= result.totalPages) return items;
    if (!result.items.length) throw new Error('对标账号分页不完整，请重试');
  }
}
