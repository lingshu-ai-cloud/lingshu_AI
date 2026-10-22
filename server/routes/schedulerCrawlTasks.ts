import { readSavedDiscoveryScope } from "../lib/socialDiscoveryScope.js";
import { discoveryKeywords } from "../../shared/socialDiscoveryKeywords.js";
import { hasLegacyProductTitleQueries } from "../../shared/productDiscovery.js";
import { randomUUID } from "node:crypto";
import { readTenantEnterpriseProfile } from "./enterprise.js";
import { store } from "../storage/index.js";
import { crawlImagePostsForTenant, crawlVideosForTenant } from "./videos.js";
import { createCrawlWorkerJob } from "./crawlWorker.js";
import type { Platform } from "../types/index.js";
import { resolveCrawlKeywords, resolveCrawlStrategy } from "../lib/crawlKeywords.js";
import { normalizeKeywordInput, type KeywordPlatform } from "../../src/lib/keywordInput.js";
import { loadScheduledTasks as load, saveScheduledTasks as save, type ScheduledTask } from "./schedulerTaskStore.js";

async function resolveSchedulerTenantId(task: ScheduledTask): Promise<string> {
  const configured = task.config.tenantId || process.env.SCHEDULED_VIDEO_TENANT_ID || process.env.DEFAULT_TENANT_ID || '';
  if (configured.trim()) return configured.trim();
  const latestVideo = await store.list<Record<string, unknown>>('trend_videos', { page: 1, perPage: 1, sort: '-crawledAt' });
  const videoTenantId = String(latestVideo.items[0]?.tenantId || '').trim();
  if (videoTenantId) return videoTenantId;
  const tenants = await store.list<Record<string, unknown>>('tenants', { page: 1, perPage: 1 });
  const tenantId = String(tenants.items[0]?.id || '').trim();
  if (!tenantId) throw new Error('未找到可执行视频采集的租户，请在任务 config.tenantId 或 SCHEDULED_VIDEO_TENANT_ID 中配置');
  return tenantId;
}

function beijingDateRange(daysRaw: string | undefined): { dateFrom: string; dateTo: string } {
  const days = Math.max(1, Math.min(30, Number(daysRaw || 7) || 7));
  const dayMs = 24 * 60 * 60 * 1000;
  const bjNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const end = bjNow.toISOString().slice(0, 10);
  const start = new Date(bjNow.getTime() - (days - 1) * dayMs).toISOString().slice(0, 10);
  return { dateFrom: start, dateTo: end };
}

function splitConfigList(value: string | undefined, fallback: string[]): string[] {
  const items = String(value || '')
    .split(/[\n,，;；、]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function normalizeCrawlerLimit(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '5';
  return String(Math.max(1, Math.min(50, Math.round(numeric))));
}

export function resolveCrawlerPlatform(raw: unknown, fallback = 'youtube'): string {
  const value = String(raw || fallback).toLowerCase();
  for (const p of ['tiktok', 'facebook', 'instagram'] as const) {
    if (value.includes(p)) return p;
  }
  return 'youtube';
}

export function normalizeCrawlerConfig(config: Record<string, string>, fallbackPlatform = 'youtube'): Record<string, string> {
  const platform = resolveCrawlerPlatform(config.platforms, fallbackPlatform);
  const rawKeywords = String(config.keywords || config.keyword || '').trim();
  const normalized = normalizeKeywordInput(rawKeywords, platform as KeywordPlatform);
  return {
    ...config,
    platforms: platform,
    keywords: normalized.serialized,
    keywordSource: config.keywordSource || 'business_profile',
    limit: normalizeCrawlerLimit(config.limit),
  };
}

function normalizedKeywordList(value: string | undefined, platform: Platform, fallback: string[] = []): string[] {
  const normalized = normalizeKeywordInput(String(value || ''), platform as KeywordPlatform);
  return normalized.items.length > 0 ? normalized.items : fallback;
}

export async function executeVideoKeywordCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const requestedKeywords = task.config.keywordSource ? (task.config.keywordInput || '') : (task.config.keywords || task.config.keyword || '');
  const scopeLinked = task.config.keywordSource === 'discovery_scope' || task.config.managedBy === 'digital_employee' || task.id.startsWith('task_de_');
  const savedScope = scopeLinked ? await readSavedDiscoveryScope(tenantId) : null;
  if (savedScope && !savedScope.keywordRecommendation && hasLegacyProductTitleQueries(savedScope.keywordSet.graph.discoverySeeds)) {
    throw new Error('已保存范围仍是旧版商品全名关键词，请在灵感大屏重新生成通用品类词');
  }
  const enterpriseProfile = savedScope ? {} : await readTenantEnterpriseProfile(tenantId);
  const selection = savedScope ? { keywords: discoveryKeywords(savedScope), source: 'discovery_scope', evidence: [savedScope.keywordSet.name] } : resolveCrawlKeywords(requestedKeywords, enterpriseProfile);
  const resolvedKeywords = selection.keywords.join(', ');
  if (!selection.keywords.length) throw new Error('发现范围没有启用的关键词，请在灵感中心调整。');
  const platforms = splitConfigList(task.config.platforms, ['youtube'])
    .filter((platform): platform is Platform => ['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform));
  const crawlStrategy = savedScope ?? resolveCrawlStrategy({
    explicit: requestedKeywords,
    profile: enterpriseProfile,
    platforms,
    businessGoal: task.config.businessGoal || task.config.goal,
  });
  if (selection.source !== 'explicit' || task.config.crawlStrategyVersion !== crawlStrategy.version) {
    const tasks = load();
    const saved = tasks.find(item => item.id === task.id && item.tenantId === tenantId);
    if (saved) {
      saved.config = {
        ...saved.config,
        keywords: resolvedKeywords,
        keywordInput: requestedKeywords,
        keywordSource: selection.source,
        keywordEvidence: selection.evidence.join('、'),
        crawlStrategyId: crawlStrategy.crawlStrategyId,
        crawlStrategyVersion: crawlStrategy.version,
        crawlStrategy: JSON.stringify(crawlStrategy),
        keywordSetId: crawlStrategy.keywordSet.keywordSetId,
        keywordSetVersion: String(crawlStrategy.keywordSet.version),
        discoveryBriefId: crawlStrategy.discoveryBrief.discoveryBriefId,
        enabledSceneIds: crawlStrategy.discoveryBrief.trackedSceneIds.join(','),
        discoveryModes: crawlStrategy.discoveryBrief.discoveryModes.join(','),
        lookbackDays: String(crawlStrategy.discoveryBrief.lookbackDays),
        resultLimit: String(crawlStrategy.discoveryBrief.resultLimit),
        maxRunCost: crawlStrategy.discoveryBrief.budgetLimitCny === null ? '' : String(crawlStrategy.discoveryBrief.budgetLimitCny),
      };
      save(tasks);
    }
  }
  const displayedKeywords = new Set<string>();
  const limit = Math.max(1, Math.min(50, Number(task.config.limit || 5) || 5));
  const { dateFrom, dateTo } = beijingDateRange(task.config.dateWindowDays);
  const lines: string[] = [];
  let imported = 0;
  let returned = 0;
  let existing = 0;
  let succeeded = 0;
  let failed = 0;
  let queued = 0;
  const workerBatch = `scheduler:${task.id}:run:${randomUUID()}`;

  for (const platform of platforms) {
    const keywords = normalizedKeywordList(resolvedKeywords, platform, []);
    for (const keyword of keywords) {
      displayedKeywords.add(keyword);
      try {
        if (platform === 'youtube' && task.config.localWorker !== '0') {
          const job = await createCrawlWorkerJob({
            tenantId,
            requestedBy: workerBatch,
            platform,
            mode: 'keyword',
            keyword,
            limit,
            dateFrom,
            dateTo,
          });
          if (!job) throw new Error('Mac 本地采集任务创建失败');
          queued += 1;
          lines.push(`${platform} / ${keyword}: 已提交 Mac 登录态采集队列（1 个任务）`);
          continue;
        }
        const result = await crawlVideosForTenant({
          tenantId,
          platform,
          keyword,
          limit,
          dateFrom,
          dateTo,
          disableBackfill: task.config.smokeTest === '1',
        });
        await createCrawlWorkerJob({ tenantId, requestedBy: workerBatch, platform, mode: 'keyword', keyword, limit,
          completed: { result: { ...result, items: undefined } } });
        imported += result.imported;
        returned += result.items.length;
        existing += result.returnedExisting;
        succeeded += 1;
        lines.push(`${platform} / ${keyword}: 当前可见 ${result.items.length} 条，新增候选 ${result.imported} 条，库内已有 ${result.returnedExisting} 条`);
      } catch (e) {
        failed += 1;
        await createCrawlWorkerJob({ tenantId, requestedBy: workerBatch, platform, mode: 'keyword', keyword, limit,
          completed: { error: e instanceof Error ? e.message : String(e) } });
        lines.push(`${platform} / ${keyword}: 执行失败 - ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return [
    `【视频关键词自动采集】${dateFrom} 至 ${dateTo}`,
    `执行状态：${queued > 0 ? `已排队（${queued} 组等待 Worker）` : succeeded > 0 ? '执行成功' : '执行失败'}${failed > 0 ? `（另有 ${failed} 组提交失败）` : ''}`,
    `本次结论：${queued > 0 ? '采集请求已进入队列，Worker 领取后将显示处理中，完成后自动回写最终结果' : succeeded === 0 ? '采集请求均未完成，请根据分组错误处理后重试' : returned + imported + existing > 0 ? '已完成检索并取得可入库或待处理内容' : '已完成检索，本次时间窗口内暂无符合条件的新内容'}`,
    `平台：${platforms.join(', ')}；关键词：${[...displayedKeywords].join('、')}；每组数量：${limit}`,
    `汇总：当前可见 ${returned} 条，新增候选 ${imported} 条，库内已有 ${existing} 条`,
    ...lines,
    `队列批次：${workerBatch}`,
  ].join('\n');
}
export async function executeImagePostCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platform = resolveCrawlerPlatform(task.config.platforms, 'instagram') as Platform;
  const keywords = normalizedKeywordList(task.config.keywords || task.config.keyword, platform);
  const limit = Math.max(1, Math.min(10, Number(task.config.limit || 5) || 5));
  const lines: string[] = [];
  let imported = 0;
  let succeeded = 0;
  let failed = 0;
  for (const keyword of keywords) {
    try {
      const result = await crawlImagePostsForTenant({ tenantId, platform, keyword, limit });
      if (result.items.length === 0 && result.imported === 0 && /未找到|无可用|失败|blocked|degraded/i.test(result.message)) {
        throw new Error(result.message);
      }
      imported += result.imported;
      succeeded += 1;
      lines.push(`${platform} / ${keyword}: ${result.message}`);
    } catch (e) {
      failed += 1;
      lines.push(`${platform} / ${keyword}: 执行失败 - ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return [
    `【图文自动采集】平台：${platform}；每组数量：${limit}`,
    `执行状态：${succeeded > 0 ? '执行成功' : '执行失败'}${failed > 0 ? `（成功 ${succeeded} 组，失败 ${failed} 组）` : ''}`,
    `本次结论：${succeeded === 0 ? '采集请求均未完成，请根据分组错误处理后重试' : imported > 0 ? `已新增 ${imported} 条图文内容` : '已完成检索，本次暂无符合条件的新图文'}`,
    `汇总：新增 ${imported} 条`, ...lines,
  ].join('\n');
}

export async function executeCompetitorAccountCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platform = resolveCrawlerPlatform(task.config.platforms) as Platform;
  const limit = Math.max(1, Math.min(30, Number(task.config.limit || 10) || 10));
  const { dateFrom, dateTo } = beijingDateRange(task.config.dateWindowDays);
  const accounts = await store.list<Record<string, unknown>>('competitor_accounts', {
    where: { tenantId, platform }, page: 1, perPage: 200, sort: '-createdAt',
  });
  if (!accounts.items.length) return `【${platform} 对标账号自动采集】\n执行状态：等待账号配置\n本次结论：该平台尚未保存对标账号，添加账号主页后即可执行采集。`;
  const lines: string[] = [];
  let imported = 0;
  let succeeded = 0;
  let failed = 0;
  let queued = 0;
  const workerBatch = `scheduler:${task.id}:run:${randomUUID()}`;
  for (const account of accounts.items) {
    const accountUrl = String(account.accountUrl || '');
    const accountName = String(account.accountName || account.handle || accountUrl);
    let accountImported = 0;
    let completedFormats = 0;
    let videoQueued = false;
    const accountLines: string[] = [];
    try {
      if (platform === 'youtube' && task.config.localWorker !== '0') {
        const job = await createCrawlWorkerJob({
          tenantId,
          requestedBy: workerBatch,
          platform,
          mode: 'account',
          accountUrl,
          accountName,
          limit,
          dateFrom,
          dateTo,
        });
        if (!job) throw new Error('Mac 本地采集任务创建失败');
        queued += 1;
        videoQueued = true;
        accountLines.push('视频已提交 Mac 登录态采集队列');
      } else {
        const result = await crawlVideosForTenant({
          tenantId,
          platform,
          mode: 'account',
          accountUrl,
          accountName,
          limit,
          dateFrom,
          dateTo,
          cloudFallback: true,
          disableBackfill: task.config.smokeTest === '1',
        });
        await createCrawlWorkerJob({ tenantId, requestedBy: workerBatch, platform, mode: 'account', accountUrl, accountName, limit, dateFrom, dateTo,
          completed: { result: { ...result, items: undefined } } });
        accountImported += result.imported;
        completedFormats += 1;
        accountLines.push(`视频返回 ${result.items.length} 条，新增 ${result.imported} 条`);
      }
    } catch (e) {
      await createCrawlWorkerJob({ tenantId, requestedBy: workerBatch, platform, mode: 'account', accountUrl, accountName, limit, dateFrom, dateTo,
        completed: { error: e instanceof Error ? e.message : String(e) } });
      accountLines.push(`视频失败：${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const imageResult = await crawlImagePostsForTenant({
        tenantId,
        platform,
        mode: 'account',
        accountUrl,
        accountName,
        limit,
        dateFrom,
        dateTo,
        deferImageAnalysis: true,
      });
      if (imageResult.items.length === 0 && imageResult.imported === 0 && /未找到|无可用|失败|blocked|degraded/i.test(imageResult.message)) {
        throw new Error(imageResult.message);
      }
      await createCrawlWorkerJob({
        tenantId,
        requestedBy: workerBatch,
        platform,
        mode: 'account',
        accountUrl,
        accountName: `${accountName} · 图文`,
        limit,
        dateFrom,
        dateTo,
        completed: { result: { ...imageResult, items: undefined } },
      });
      accountImported += imageResult.imported;
      completedFormats += 1;
      accountLines.push(`图文返回 ${imageResult.items.length} 条，新增 ${imageResult.imported} 条（含原帖配文）`);
    } catch (e) {
      accountLines.push(`图文失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (completedFormats > 0 || videoQueued) {
      imported += accountImported;
      succeeded += 1;
      await store.update('competitor_accounts', String(account.id), {
        lastCrawledAt: new Date().toISOString(),
        lastCrawlCount: accountImported,
        lastCrawlMode: 'mixed',
        crawlError: '',
      });
    } else {
      failed += 1;
      await store.update('competitor_accounts', String(account.id), {
        lastCrawledAt: new Date().toISOString(),
        lastCrawlMode: 'mixed',
        crawlStatus: 'failed',
        crawlError: accountLines.join('；'),
      });
    }
    lines.push(`${accountName}: ${accountLines.join('；')}`);
  }
  return [
    `【${platform} 对标账号爆款自动采集】账号 ${accounts.items.length} 个；视频和图文每类最多 ${limit} 条`,
    `执行状态：${queued > 0 ? `已排队（${queued} 个账号等待 Worker）` : succeeded > 0 ? '执行成功' : '执行失败'}${failed > 0 ? `（另有 ${failed} 个账号提交失败）` : ''}`,
    `本次结论：${queued > 0 ? '视频请求已进入队列，图文已同步采集；Worker 完成后自动回写最终结果' : succeeded === 0 ? '账号采集请求均未完成，请根据账号错误处理后重试' : imported > 0 ? `已新增 ${imported} 条对标视频或图文` : '已完成账号检索，本次暂无新增内容'}`,
    `汇总：新增 ${imported} 条`, ...lines, `队列批次：${workerBatch}`,
  ].join('\n');
}
