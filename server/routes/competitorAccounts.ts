import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform } from '../types/index.js';
import {
  crawlImagePostsForTenant,
  crawlVideosForTenant,
  type CrawlVideosResult,
  looksLikeAccountUrl,
  accountLabelFromUrl,
  inferPlatformFromUrl,
} from './videos.js';
import { createCrawlWorkerJob } from './crawlWorker.js';

export const competitorAccountsRouter = Router();
competitorAccountsRouter.use(requireAuth);

const COL = 'competitor_accounts';
const SUPPORTED: Platform[] = ['linkedin', 'facebook', 'youtube', 'tiktok', 'instagram'];

interface AccountRecord {
  id: string;
  tenantId: string;
  platform: Platform;
  accountUrl: string;
  accountName: string;
  handle: string;
  avatarUrl?: string;
  note?: string;
  lastCrawledAt?: string;
  lastCrawlCount?: number;
  lastCrawlMode?: CompetitorCrawlMode;
  createdAt?: string;
}

export type CompetitorCrawlMode = 'video' | 'image' | 'mixed';

export function normalizeCompetitorCrawlMode(value: unknown): CompetitorCrawlMode {
  return value === 'image' || value === 'mixed' ? value : 'video';
}

export function combineCompetitorCrawlResults(
  mode: CompetitorCrawlMode,
  platform: Platform,
  results: Array<{ format: 'video' | 'image'; result: CrawlVideosResult }>,
) {
  const seen = new Set<string>();
  const items = results.flatMap(entry => entry.result.items).filter(raw => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const key = String(item.sourceUrl || item.id || JSON.stringify(item));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sum = (field: keyof CrawlVideosResult) => results.reduce((total, entry) => total + Number(entry.result[field] || 0), 0);
  const byFormat = Object.fromEntries(results.map(entry => [entry.format, {
    imported: entry.result.imported,
    existing: entry.result.returnedExisting,
    skippedExisting: entry.result.skippedExisting,
    total: entry.result.total,
  }]));
  const imported = sum('imported');
  const existing = sum('returnedExisting');
  return {
    mode,
    platform,
    imported,
    refreshed: sum('refreshed'),
    skipped: sum('skipped'),
    skippedExisting: sum('skippedExisting'),
    returnedExisting: existing,
    requested: sum('requested'),
    total: sum('total'),
    source: results.map(entry => entry.result.source).join('+'),
    message: `主页${mode === 'mixed' ? '混合作品' : mode === 'image' ? '图文' : '视频'}采集完成：新增 ${imported} 条，命中已有 ${existing} 条；已按原帖地址去重。`,
    byFormat,
    items,
  };
}

function toClient(record: AccountRecord) {
  return {
    id: record.id,
    platform: record.platform,
    accountUrl: record.accountUrl,
    accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
    handle: record.handle || '',
    avatarUrl: record.avatarUrl || '',
    note: record.note || '',
    lastCrawledAt: record.lastCrawledAt || '',
    lastCrawlCount: Number(record.lastCrawlCount || 0),
    lastCrawlMode: normalizeCompetitorCrawlMode(record.lastCrawlMode),
    createdAt: record.createdAt || '',
  };
}

// ─── GET /competitor-accounts ────────────────────────────────────────────────
competitorAccountsRouter.get('/', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<AccountRecord>(COL, {
    where: { tenantId },
    sort: '-createdAt',
    page: 1,
    perPage: 200,
  });
  res.json({ items: result.items.map(toClient) });
});

// ─── POST /competitor-accounts ───────────────────────────────────────────────
// Body: { url: string, platform?: 'linkedin' | 'facebook' | 'youtube' | 'tiktok' | 'instagram', accountName?: string, note?: string }
competitorAccountsRouter.post('/', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { url = '', accountName = '', note = '' } = req.body as {
    url?: string; platform?: Platform; accountName?: string; note?: string;
  };
  const trimmed = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    res.status(400).json({ error: '请填写以 http(s):// 开头的账号主页链接' });
    return;
  }

  const bodyPlatform = (req.body as { platform?: string })?.platform;
  const platform: Platform = bodyPlatform && SUPPORTED.includes(bodyPlatform as Platform)
    ? (bodyPlatform as Platform)
    : inferPlatformFromUrl(trimmed);
  if (!SUPPORTED.includes(platform)) {
    res.status(400).json({ error: '当前支持 LinkedIn、Facebook、YouTube、TikTok、Instagram 对标账号主页' });
    return;
  }
  if (!looksLikeAccountUrl(trimmed, platform)) {
    res.status(400).json({ error: '这看起来不是账号主页链接（例如 LinkedIn Company、Facebook Page、YouTube @handle、TikTok @user 或 Instagram username）' });
    return;
  }

  // 同租户按 URL 去重
  const existing = await store.list<AccountRecord>(COL, {
    where: { tenantId, accountUrl: trimmed },
    page: 1,
    perPage: 1,
  });
  if (existing.items[0]) {
    res.json({ item: toClient(existing.items[0]), duplicated: true });
    return;
  }

  const label = String(accountName || '').trim() || accountLabelFromUrl(trimmed);
  const record = await store.create<AccountRecord>(COL, {
    tenantId,
    platform,
    accountUrl: trimmed,
    accountName: label,
    handle: accountLabelFromUrl(trimmed),
    note: String(note || '').trim(),
    lastCrawledAt: '',
    lastCrawlCount: 0,
    createdAt: new Date().toISOString(),
  });
  if (!record) {
    res.status(500).json({ error: '保存对标账号失败' });
    return;
  }
  res.json({ item: toClient(record) });
});

// ─── DELETE /competitor-accounts/:id ─────────────────────────────────────────
competitorAccountsRouter.delete('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById<AccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

// ─── POST /competitor-accounts/:id/crawl ─────────────────────────────────────
// Body: { limit?: number; contentMode?: 'video' | 'image' | 'mixed' }
// 采集该账号主页作品，按媒体类型复用现有视频或图文分析管线。
competitorAccountsRouter.post('/:id/crawl', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await store.getById<AccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const limit = Math.min(30, Math.max(1, Number((req.body as { limit?: number })?.limit) || 3));
  const contentMode = normalizeCompetitorCrawlMode((req.body as { contentMode?: unknown })?.contentMode);
  const lookbackDays = Math.min(30, Math.max(1, Number((req.body as { lookbackDays?: number })?.lookbackDays) || 7));
  const dateTo = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);

  if (contentMode === 'image') {
    await store.update(COL, record.id, {
      lastCrawlMode: contentMode,
      crawlStatus: 'running',
      crawlStartedAt: new Date().toISOString(),
      crawlError: '',
    });
    res.status(202).json({
      queued: true,
      platform: record.platform,
      requested: limit,
      imported: 0,
      mode: contentMode,
      message: '图文采集已提交，主页作品将在后台入库并去重。',
      items: [],
    });
    void crawlImagePostsForTenant({
      tenantId,
      platform: record.platform,
      mode: 'account',
      accountUrl: record.accountUrl,
      accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
      limit,
      dateFrom,
      dateTo,
      deferImageAnalysis: true,
    }).then(async result => {
      await store.update(COL, record.id, {
        lastCrawledAt: new Date().toISOString(),
        lastCrawlCount: result.imported,
        lastCrawlMode: contentMode,
        crawlStatus: 'completed',
        crawlCompletedAt: new Date().toISOString(),
        crawlError: '',
      });
    }).catch(async error => {
      console.error('[competitor-accounts] background image crawl failed:', error);
      await store.update(COL, record.id, {
        crawlStatus: 'failed',
        crawlCompletedAt: new Date().toISOString(),
        crawlError: error instanceof Error ? error.message : '对标账号图文采集失败',
      }).catch(updateError => console.error('[competitor-accounts] failed to persist crawl failure:', updateError));
    });
    return;
  }

  try {
    if (contentMode === 'video' && (record.platform === 'youtube' || record.platform === 'tiktok')) {
      const job = await createCrawlWorkerJob({
        tenantId,
        requestedBy: userId,
        platform: record.platform,
        mode: 'account',
        accountUrl: record.accountUrl,
        accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
        limit,
        dateFrom,
        dateTo,
      });
      if (!job) {
        res.status(500).json({ error: '本地采集任务创建失败' });
        return;
      }
      res.status(202).json({
        queued: true,
        jobId: job.id,
        platform: record.platform,
        requested: limit,
        imported: 0,
        refreshed: 0,
        skipped: 0,
        skippedExisting: 0,
        returnedExisting: 0,
        total: 0,
        source: 'mac-local-worker',
        message: '已提交到 Mac 本地采集队列，worker 会用我们的采集账号执行，不使用客户账号。',
        mode: contentMode,
        items: [],
      });
      return;
    }

    const common = {
      tenantId,
      platform: record.platform,
      mode: 'account' as const,
      accountUrl: record.accountUrl,
      accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
      limit,
      dateFrom,
      dateTo,
    };
    // Run mixed formats sequentially. Both pipelines deduplicate against the
    // same tenant/sourceUrl inventory, so the second pass observes records
    // written by the first instead of racing it into a duplicate insert.
    const requests = contentMode === 'video'
      ? [{ format: 'video' as const, run: () => crawlVideosForTenant(common) }]
      : [
          { format: 'video' as const, run: () => crawlVideosForTenant(common) },
          { format: 'image' as const, run: () => crawlImagePostsForTenant({ ...common, deferImageAnalysis: true }) },
        ];
    const completed: Array<{ format: 'video' | 'image'; result: CrawlVideosResult }> = [];
    const partialFailures: string[] = [];
    for (const request of requests) {
      try {
        completed.push({ format: request.format, result: await request.run() });
      } catch (error) {
        partialFailures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (!completed.length) {
      throw new Error(partialFailures.join('；') || '对标账号采集失败');
    }
    const result = combineCompetitorCrawlResults(contentMode, record.platform, completed);
    if (partialFailures.length) result.message += ` 部分类型失败：${partialFailures.join('；')}`;
    await store.update(COL, record.id, {
      lastCrawledAt: new Date().toISOString(),
      lastCrawlCount: result.imported,
      lastCrawlMode: contentMode,
    });
    res.json(result);
  } catch (e) {
    console.error('[competitor-accounts] crawl failed:', e);
    res.status(502).json({ error: e instanceof Error ? e.message : '对标账号采集失败' });
  }
});
