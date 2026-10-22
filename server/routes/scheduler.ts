import { readSavedDiscoveryScope } from '../lib/socialDiscoveryScope.js';
import { hasLegacyProductTitleQueries } from '../../shared/productDiscovery.js';
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { callLLMChatStream } from '../agents/llm.js';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from './enterprise.js';
import { businessDynamicsReport, getBusinessDynamicsSnapshot } from './schedulerBusinessDynamics.js';
import { executeCompetitorAccountCrawl, executeImagePostCrawl, executeVideoKeywordCrawl, normalizeCrawlerConfig, resolveCrawlerPlatform } from './schedulerCrawlTasks.js';
import { formatTaskTime, renderTaskReportPdf, splitTextList, taskReportActions, weeklyVideoReport } from './schedulerTaskReport.js';
export { beijingWeekWindow } from './schedulerTaskReport.js';
import { store } from '../storage/index.js';
import { getVideoPipelineStats } from './videos.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { normalizeKeywordInput, type KeywordPlatform } from '../../src/lib/keywordInput.js';
import { buildConfirmedWeeklyDiscoveryScopeWithKeywords, WEEKLY_DISCOVERY_PRODUCT_BINDING_VERSION, type ConfirmedWeeklyDiscoveryBoundary } from '../digitalEmployees/weeklyDiscoveryScope.js';
import { normalizeModePolicies } from '../socialDiscovery/domain.js';
import { formatScheduledDiscoveryResult } from '../socialDiscovery/scheduledResult.js';
import { discoveryTriggerForScheduler, type SchedulerExecutionTrigger } from '../socialDiscovery/scheduledTrigger.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { runWithDataAuthority } from '../storage/dataAuthority.js';
import { schedulerBootstrapAuthority } from './schedulerBootstrapAuthority.js';
import { reconcileWeeklyDiscoveryScopeMigrations } from '../socialPrograms/weeklyDiscoveryScopeMigration.js';
import { discoveryScopeUpgradeRequest } from './schedulerDiscoveryScopeUpgrade.js';
import { latestMissedRun } from './schedulerMissedRun.js';

import { hydrateScheduledTasks as hydrateTasksFromPocketBase, loadScheduledTasks as load, saveScheduledTasks as save, scheduledExecutionState, type ScheduledExecutionState, type ScheduledRunOutcome, type ScheduledTask } from './schedulerTaskStore.js';
export type { ScheduledExecutionState, ScheduledRunOutcome, ScheduledTask } from './schedulerTaskStore.js';
export { scheduledExecutionState } from './schedulerTaskStore.js';

interface HolidayInfo {
  date: string;
  name: string;
  note: string;
}

interface MarketHolidayPlan {
  name: string;
  holidays: HolidayInfo[];
}

function tenantTasks(tenantId: string): ScheduledTask[] {
  return load().filter(task => task.tenantId === tenantId);
}

function findTenantTask(id: string, tenantId: string): ScheduledTask | undefined {
  return load().find(task => task.id === id && task.tenantId === tenantId);
}

async function tenantEnterpriseProfile(task: ScheduledTask): Promise<Awaited<ReturnType<typeof readTenantEnterpriseProfile>> | null> {
  if (!task.tenantId) return null;
  try { return await readTenantEnterpriseProfile(task.tenantId); }
  catch { return null; }
}

async function getEnterpriseCtx(task: ScheduledTask): Promise<string> {
  try {
    const profile = await tenantEnterpriseProfile(task);
    return profile ? buildEnterpriseContext(profile) : '';
  }
  catch { return ''; }
}

// Active cron jobs registry
const activeJobs = new Map<string, CronJob>();
const runningTaskIds = new Set<string>();

function taskWithExecutionState(task: ScheduledTask): ScheduledTask & { executionState: ScheduledExecutionState } {
  return {
    ...task,
    executionState: scheduledExecutionState(task.lastResult, { running: runningTaskIds.has(task.id) }),
  };
}

async function executeTrendReport(task: ScheduledTask): Promise<string> {
  const enterpriseCtx = await getEnterpriseCtx(task);
  const messages = [{ role: 'user' as const, content: '生成今日TikTok跨境电商爆款趋势简报，包括：热门品类、热门话题标签、建议借势策略，控制在300字以内' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商趋势分析师。${enterpriseCtx ? '\n\n企业信息：' + enterpriseCtx : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

async function executeWeeklyReview(task: ScheduledTask): Promise<string> {
  const enterpriseCtx = await getEnterpriseCtx(task);
  const messages = [{ role: 'user' as const, content: '生成本周跨境电商经营复盘报告：流量表现、询盘转化、老客复购情况，并给出下周行动建议，控制在500字' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商经营顾问。${enterpriseCtx ? '\n\n企业信息：' + enterpriseCtx : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

async function executeExchangeRate(task: ScheduledTask): Promise<string> {
  if (!task.tenantId) return '执行失败：任务缺少租户信息';
  const snapshot = await getBusinessDynamicsSnapshot(task.tenantId);
  return businessDynamicsReport(snapshot, '汇率与报价日报');
}

async function executeMarketIntelligence(task: ScheduledTask): Promise<string> {
  if (!task.tenantId) return '执行失败：任务缺少租户信息';
  const snapshot = await getBusinessDynamicsSnapshot(task.tenantId, true);
  return businessDynamicsReport(snapshot, '主要市场行业周报');
}

function daysUntil(date: string, from = new Date()): number {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(`${date}T00:00:00+08:00`).getTime() - start.getTime()) / 86400000);
}

function marketKey(market: string): string {
  const value = market.toLowerCase();
  if (/美国|usa|u\.s\.|united states/.test(value)) return 'us';
  if (/沙特|saudi|ksa/.test(value)) return 'saudi';
  if (/阿联酋|uae|emirates|dubai/.test(value)) return 'uae';
  if (/德国|germany|deutschland/.test(value)) return 'germany';
  if (/印尼|印度尼西亚|indonesia/.test(value)) return 'indonesia';
  return value;
}

function marketLanguage(key: string, enterprise: Record<string, any>): string {
  const preferred = splitTextList(enterprise.company?.primaryLanguages || enterprise.brand?.preferredLanguages);
  const map: Record<string, string> = {
    us: '英语',
    saudi: preferred.includes('阿拉伯语') ? '阿拉伯语 / 英语' : '阿拉伯语',
    uae: preferred.includes('阿拉伯语') ? '阿拉伯语 / 英语' : '阿拉伯语 / 英语',
    germany: '德语 / 英语',
    indonesia: '印尼语 / 英语',
  };
  return map[key] || preferred.join(' / ') || '英语';
}

function pickProducts(key: string, enterprise: Record<string, any>): string {
  const focus = splitTextList(enterprise.strategy?.focusProducts);
  const categories = splitTextList(enterprise.products?.categories);
  const products = focus.length ? focus : categories;
  const has = (keyword: string) => products.find(item => item.includes(keyword));
  const lip = has('唇') || '唇釉套装';
  const travel = has('旅行') || '旅行装护肤套装';
  const serum = has('精华') || has('维 C') || '维 C 亮肤精华';
  const cream = has('面霜') || '烟酰胺面霜';

  if (key === 'us') return [travel, serum, '低 MOQ 私标套装'].join('、');
  if (key === 'saudi' || key === 'uae') return [lip, travel, '英文/阿语标签版本'].join('、');
  if (key === 'germany') return [serum, cream, '纯素/无动物测试卖点组合'].join('、');
  if (key === 'indonesia') return [lip, travel, 'TikTok Shop 小批量试单组合'].join('、');
  return products.slice(0, 3).join('、') || '重点 SKU';
}

function holidayCatalog(): Record<string, MarketHolidayPlan> {
  return {
    us: {
      name: '美国',
      holidays: [
        { date: '2026-07-03', name: 'Independence Day 观察假期', note: '7/4 独立日落在周六，联邦观察假期为 7/3' },
        { date: '2026-07-04', name: 'Independence Day 独立日', note: '美国建国 250 周年，适合做纪念装、旅行装和派对妆容内容' },
        { date: '2026-09-07', name: 'Labor Day 劳动节', note: '夏末促销节点，适合清爽护肤、旅行补货和开学季前内容' },
        { date: '2026-10-12', name: 'Columbus Day / Indigenous Peoples Day', note: '部分地区放假，适合做秋季护肤切换' },
      ],
    },
    saudi: {
      name: '沙特',
      holidays: [
        { date: '2026-08-25', name: 'Prophet Muhammad’s Birthday 先知诞辰', note: '宗教节日，内容表达需稳重，避免夸张促销语' },
        { date: '2026-09-23', name: 'Saudi National Day 沙特国庆日', note: '适合绿色视觉、礼赠套装、阿语标签和批发备货提醒' },
      ],
    },
    uae: {
      name: '阿联酋',
      holidays: [
        { date: '2026-08-25', name: 'Prophet Muhammad’s Birthday 先知诞辰', note: '适合温和护肤、礼赠套装，文案保持尊重克制' },
        { date: '2026-11-30', name: 'Commemoration Day 纪念日', note: '偏纪念属性，不建议强促销，可做品牌关怀内容' },
        { date: '2026-12-02', name: 'UAE National Day 阿联酋国庆日', note: '适合礼盒、套装和阿语/英语双语上新预热' },
      ],
    },
    germany: {
      name: '德国',
      holidays: [
        { date: '2026-08-15', name: 'Assumption Day 圣母升天节（部分州）', note: '巴伐利亚、萨尔等区域假期，可做区域定向内容' },
        { date: '2026-10-03', name: 'German Unity Day 德国统一日', note: '全国假日，适合秋季护肤、成分安全和合规资料内容' },
        { date: '2026-10-31', name: 'Reformation Day 宗教改革日（部分州）', note: '区域假期，适合轻量品牌露出' },
      ],
    },
    indonesia: {
      name: '印尼',
      holidays: [
        { date: '2026-08-17', name: 'Independence Day 印尼独立日', note: '红白视觉、直播促销和 TikTok Shop 套装备货节点' },
        { date: '2026-08-25', name: 'Mawlid / Maulid Nabi 先知诞辰', note: '宗教节日，适合礼赠和温和表达，避免激进促销' },
        { date: '2026-12-25', name: 'Christmas Day 圣诞节', note: '礼盒和年末大促节点，需提前 6-8 周准备素材' },
      ],
    },
  };
}

async function executeHolidayPush(task: ScheduledTask): Promise<string> {
  const enterprise: Record<string, any> = await tenantEnterpriseProfile(task) || {};
  const rawMarkets = splitTextList(enterprise.company?.mainMarkets || enterprise.strategy?.focusMarkets);
  const keys = Array.from(new Set(rawMarkets.map(marketKey))).filter(Boolean);
  const catalog = holidayCatalog();
  const selectedKeys = keys.filter(key => key in catalog);
  const markets = selectedKeys.length ? selectedKeys : ['us', 'saudi', 'uae', 'germany', 'indonesia'];
  const now = new Date();
  const horizonDays = 120;
  const sourceText = rawMarkets.length ? rawMarkets.join('、') : '美国、沙特、阿联酋、德国、印尼';

  const lines = [
    `【节日推品提醒】基于企业中心主要市场：${sourceText}`,
    `时间窗口：未来 ${horizonDays} 天；生成日期：${now.toLocaleDateString('zh-CN')}`,
    '',
  ];

  for (const key of markets) {
    const market = catalog[key];
    const upcoming = market.holidays
      .map(holiday => ({ ...holiday, diff: daysUntil(holiday.date, now) }))
      .filter(holiday => holiday.diff >= 0 && holiday.diff <= horizonDays);
    const holidays = upcoming.length ? upcoming : market.holidays
      .map(holiday => ({ ...holiday, diff: daysUntil(holiday.date, now) }))
      .filter(holiday => holiday.diff >= 0)
      .slice(0, 1);

    lines.push(`【${market.name}】`);
    for (const holiday of holidays) {
      lines.push(`- ${holiday.date}（${holiday.diff} 天后）${holiday.name}：${holiday.note}`);
    }
    lines.push(`  推品建议：${pickProducts(key, enterprise)}`);
    lines.push(`  文案语言：${marketLanguage(key, enterprise)}；动作：提前准备 2 条社媒预热内容、1 版询盘跟进话术、1 版老客唤醒消息。`);
    lines.push('');
  }

  lines.push('优先级建议：7 天内节日先处理库存和老客触达；30-60 天节日准备短视频素材和达人 brief；60 天以上节日先沉淀选品清单和多语言标签需求。');
  return lines.join('\n').trim();
}

async function executeCrmWakeup(task: ScheduledTask): Promise<string> {
  const enterpriseCtx = await getEnterpriseCtx(task);
  const messages = [{ role: 'user' as const, content: '请生成一段针对60天未复购老客的唤醒消息，要有温度感，适合通过WhatsApp发送，不超过100字' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商CRM专员。${enterpriseCtx ? '\n\n企业信息：' + enterpriseCtx : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

/** Worker 状态变化后，将同一调度批次的真实执行结果回写到任务面板。 */
export async function reconcileScheduledCrawlBatch(requestedBy: string): Promise<void> {
  const match = /^scheduler:(.+):run:[^:]+$/.exec(requestedBy);
  if (!match) return;
  const taskId = match[1];
  const jobs = await store.list<Record<string, any>>('crawl_jobs', {
    where: { requestedBy }, sort: 'createdAt', page: 1, perPage: 200,
  });
  if (!jobs.items.length) return;
  const resultText = scheduledCrawlBatchResult(jobs.items, requestedBy);
  const tasks = load();
  const idx = tasks.findIndex(task => task.id === taskId && task.lastResult?.includes(`队列批次：${requestedBy}`));
  if (idx === -1) return; // A newer run already owns the visible result.
  tasks[idx].lastResult = resultText;
  save(tasks);
}

export function scheduledCrawlBatchResult(jobs: Record<string, any>[], requestedBy: string): string {
  const counts = { queued: 0, running: 0, done: 0, failed: 0, no_data: 0 };
  let imported = 0;
  let analysisPending = false;
  const details: string[] = [];
  for (const job of jobs) {
    let status = String(job.status || 'queued') as keyof typeof counts;
    let result: Record<string, any> = {};
    try { result = job.resultJson ? JSON.parse(String(job.resultJson)) : {}; } catch { /* keep empty */ }
    if (status === 'done' && result.outcome === 'no_data') status = 'no_data';
    if (status === 'done' && /公开采集未找到可入库的真实视频：[\s\S]*(?:search failed|SSL|HTTP [45]\d\d|ECONN|timed out)/i.test(String(result.message || ''))) status = 'failed';
    if (status in counts) counts[status] += 1;
    analysisPending ||= status === 'done' && result.analysisPending === true;
    imported += Number(result.imported || 0);
    const label = String(job.keyword || job.accountName || job.accountUrl || job.platform || '采集任务');
    if (status === 'done') details.push(`${label}: 已完成，新增 ${Number(result.imported || 0)} 条${result.message ? `（${result.message}）` : ''}`);
    else if (status === 'no_data') details.push(`${label}: 暂无符合条件的结果（${result.message || '请调整关键词或日期范围'}）`);
    else if (status === 'failed') details.push(`${label}: 执行失败 - ${String(job.error || result.message || 'worker_failed')}`);
  }
  const pending = counts.queued + counts.running;
  const state = pending > 0
    ? `处理中（排队 ${counts.queued}，执行中 ${counts.running}，已完成 ${counts.done}，失败 ${counts.failed}）`
    : counts.done > 0 && counts.failed === 0 ? (analysisPending ? '已采集，待分析' : '执行成功')
      : counts.done > 0 ? `部分成功（成功 ${counts.done}，失败 ${counts.failed}）` : counts.failed > 0 ? '执行失败' : '暂无结果';
  return [
    '【本地 Worker 采集结果】', `执行状态：${state}`,
    `本次结论：${pending > 0 ? 'Worker 正在处理，完成后会继续自动更新' : counts.done > 0 ? `采集已结束，共新增 ${imported} 条` : counts.failed > 0 ? '本批次未取得可用结果，请查看各平台失败原因及检索结果' : '检索已完成，暂无符合条件的内容，请调整关键词或日期范围'}`,
    `汇总：新增 ${imported} 条；总任务 ${jobs.length} 个`, ...details,
    `队列批次：${requestedBy}`,
  ].join('\n');
}

async function executeTask(task: ScheduledTask, trigger: SchedulerExecutionTrigger): Promise<string> {
  if (task.taskType === 'video_keyword_crawl' &&
    (task.config.managedBy === 'digital_employee' || task.id.startsWith('task_de_'))) {
    return '编导旧采集任务已停用，请使用已批准的连续发现采集计划。';
  }
  if (task.taskType === 'social_discovery_collection') {
    const { executeApprovedDiscoveryRun } = await import('../socialDiscovery/service.js');
    const result = await executeApprovedDiscoveryRun({
      tenantId: String(task.tenantId || task.config.tenantId || ''),
      triggerType: discoveryTriggerForScheduler(trigger),
      expectedScopeId: task.config.discoveryScopeId,
      expectedScopeVersion: Number(task.config.discoveryScopeVersion || 0) || undefined,
    });
    return formatScheduledDiscoveryResult(result);
  }
  if (task.taskType === 'video_keyword_crawl') return executeVideoKeywordCrawl(task);
  if (task.taskType === 'image_post_crawl') return executeImagePostCrawl(task);
  if (task.taskType === 'competitor_account_crawl') return executeCompetitorAccountCrawl(task);
  if (task.taskType === 'holiday_push') return executeHolidayPush(task);
  switch (task.taskType) {
    case 'trend_report':  return executeTrendReport(task);
    case 'weekly_review': return executeWeeklyReview(task);
    case 'exchange_rate': return executeExchangeRate(task);
    case 'market_intelligence': return executeMarketIntelligence(task);
    case 'crm_wakeup':   return executeCrmWakeup(task);
    default:              return '任务执行完成';
  }
}

/** One scheduler per tenant. It only stores an approved scope reference; execution resolves the immutable scope snapshot. */
export function ensureSocialDiscoveryCollectionTask(input: {
  tenantId: string;
  discoveryScopeId: string;
  discoveryScopeVersion: number;
}): { task: ScheduledTask; created: boolean; updated: boolean } {
  const tasks = load();
  const existing = tasks.find(task => task.tenantId === input.tenantId && task.taskType === 'social_discovery_collection');
  const config: Record<string, string> = {
    ...(existing?.config || {}),
    tenantId: input.tenantId,
    discoveryScopeId: input.discoveryScopeId,
    discoveryScopeVersion: String(input.discoveryScopeVersion),
    managedBy: 'social_discovery_scope',
  };
  const task: ScheduledTask = existing ? {
    ...existing,
    name: '连续发现采集',
    cronExpr: '*/15 * * * *',
    cronLabel: '每15分钟检查到期供给',
    enabled: existing.enabled,
    config,
  } : {
    id: `task_social_discovery_${randomUUID()}`,
    tenantId: input.tenantId,
    name: '连续发现采集',
    category: 'automation',
    taskType: 'social_discovery_collection',
    cronExpr: '*/15 * * * *',
    cronLabel: '每15分钟检查到期供给',
    enabled: true,
    config,
    createdAt: new Date().toISOString(),
  };
  if (existing && JSON.stringify(task) === JSON.stringify(existing)) {
    return { task: existing, created: false, updated: false };
  }
  if (existing) tasks[tasks.indexOf(existing)] = task;
  else tasks.push(task);
  save(tasks);
  scheduleTask(task);
  return { task, created: !existing, updated: Boolean(existing) };
}

/** Backfill managed schedules for approved scopes created before scheduler wiring existed. */
export async function reconcileSocialDiscoveryCollectionTasks(): Promise<number> {
  const legacyTasks = load();
  let retiredLegacy = false;
  for (const task of legacyTasks) {
    if (task.taskType !== 'video_keyword_crawl' ||
      !(task.config.managedBy === 'digital_employee' || task.id.startsWith('task_de_')) || !task.enabled) continue;
    task.enabled = false;
    activeJobs.get(task.id)?.stop();
    activeJobs.delete(task.id);
    retiredLegacy = true;
  }
  if (retiredLegacy) save(legacyTasks);
  let page = 1;
  let reconciled = 0;
  while (page <= 50) {
    const result = await store.list<Record<string, any>>('social_discovery_scopes', {
      where: { status: 'active' }, sort: 'created_at', page, perPage: 100,
    });
    for (const scope of result.items) {
      const tenantId = String(scope.tenant_id || '').trim();
      const version = Number(scope.version || 0);
      const payload = scope.payload && typeof scope.payload === 'object' ? scope.payload as Record<string, any> : {};
      const approval = payload.approval && typeof payload.approval === 'object' ? payload.approval as Record<string, any> : {};
      if (!tenantId || !scope.id || !version || approval.status !== 'approved' || Number(approval.scopeVersion || 0) !== version) continue;
      const upgrade = discoveryScopeUpgradeRequest(scope, tenantId);
      if (upgrade) {
        try {
          await ensureDigitalEmployeeSocialCollectionTask(upgrade);
          reconciled += 1;
          continue;
        } catch (error) {
          console.warn('[scheduler] product-bound discovery scope migration deferred:', error instanceof Error ? error.message : error);
        }
      }
      ensureSocialDiscoveryCollectionTask({ tenantId, discoveryScopeId: String(scope.id), discoveryScopeVersion: version });
      reconciled += 1;
    }
    if (page >= result.totalPages || result.items.length < 100) break;
    page += 1;
  }
  // An approved scope replacement cannot mutate immutable preproduction jobs.
  // Reconcile opted-in weekly packages through their existing revision path.
  await reconcileWeeklyDiscoveryScopeMigrations(store);
  return reconciled;
}

async function executeAndPersistTask(task: ScheduledTask, trigger: SchedulerExecutionTrigger): Promise<string> {
  if (runningTaskIds.has(task.id)) return '任务正在执行，请稍后查看结果。';
  runningTaskIds.add(task.id);
  try {
    const result = await executeTask(task, trigger).catch(e => `执行失败: ${e instanceof Error ? e.message : String(e)}`);
    const tasks = load();
    const idx = tasks.findIndex(item => item.id === task.id && item.tenantId === task.tenantId);
    if (idx !== -1) {
      tasks[idx].lastRun = new Date().toISOString();
      tasks[idx].lastResult = result;
      save(tasks);
      const workerBatch = /队列批次：(scheduler:.+:run:[^:\s]+)/.exec(result)?.[1];
      if (workerBatch) await reconcileScheduledCrawlBatch(workerBatch);
    }
    console.log(`[scheduler] ${trigger} task "${task.name}" done:`, result.slice(0, 100));
    return result;
  } finally {
    runningTaskIds.delete(task.id);
  }
}

/**
 * Public in-process entry point for an approved weekly plan to launch its first
 * scheduled action immediately. Tenant ownership is checked before execution.
 */
export async function runScheduledTaskNow(input: {
  tenantId: string;
  taskId: string;
}): Promise<ScheduledRunOutcome> {
  const task = findTenantTask(input.taskId, input.tenantId);
  if (!task) throw new Error('scheduled_task_not_found');
  const result = await executeAndPersistTask(task, 'manual');
  const refreshed = findTenantTask(input.taskId, input.tenantId);
  return {
    taskId: input.taskId,
    state: scheduledExecutionState(refreshed?.lastResult || result),
    result: refreshed?.lastResult || result,
    lastRun: refreshed?.lastRun,
  };
}

export function scheduleTask(task: ScheduledTask) {
  if (activeJobs.has(task.id)) { activeJobs.get(task.id)!.stop(); activeJobs.delete(task.id); }
  // The global opt-out applies to tasks created by authenticated routes too,
  // not only to the bootstrap restore in initScheduler(). The task record may
  // still be saved for a later, explicitly enabled scheduler process.
  if (process.env.SCHEDULER_ENABLED === 'false') return;
  if (!task.enabled) return;
  if (!cron.validate(task.cronExpr)) return;

  const job = cron.schedule(task.cronExpr, async () => {
    await executeAndPersistTask(task, 'cron');
  }, { timezone: 'Asia/Shanghai' });
  activeJobs.set(task.id, job);
}

export function isSchedulerTaskRegistered(taskId: string): boolean {
  return activeJobs.has(taskId);
}

/** Bind the director workflow to the one approved discovery collector. Never create a second keyword crawl. */
export async function ensureDigitalEmployeeSocialCollectionTask(input: {
  tenantId: string;
  workflowRunId: string;
  workflowTaskId: string;
  keywords: string;
  cronExpr?: string;
  cronLabel?: string;
  platforms?: string[];
  limit?: number;
  dateWindowDays?: number;
  dedupeWindowDays?: number;
  confirmedWeeklyBoundary?: ConfirmedWeeklyDiscoveryBoundary;
}): Promise<{ task: ScheduledTask; created: boolean; updated: boolean; pendingReason?: string } | null> {
  const tasks = load();
  let retiredLegacy = false;
  for (const legacy of tasks) {
    if (legacy.tenantId !== input.tenantId || legacy.taskType !== 'video_keyword_crawl' ||
      !(legacy.config.managedBy === 'digital_employee' || legacy.id.startsWith('task_de_')) || !legacy.enabled) continue;
    legacy.enabled = false;
    activeJobs.get(legacy.id)?.stop();
    activeJobs.delete(legacy.id);
    retiredLegacy = true;
  }
  if (retiredLegacy) save(tasks); // Keep the record and last-run history for audit.
  const result = await store.list<Record<string, any>>('social_discovery_scopes', {
    where: { tenant_id: input.tenantId, status: 'active' }, sort: '-updated_at', page: 1, perPage: 20,
  });
  let scope = result.items.find(item => {
    const approval = item.payload?.approval;
    return approval?.status === 'approved' && Number(approval.scopeVersion || 0) === Number(item.version || 0);
  });
  const scopeNeedsDirectorKeywords = Boolean(scope?.id && input.confirmedWeeklyBoundary && (
    !scope.payload?.keywordRecommendation ||
    scope.payload?.productFactBinding?.version !== WEEKLY_DISCOVERY_PRODUCT_BINDING_VERSION ||
    hasLegacyProductTitleQueries(scope.payload?.keywordSet?.graph?.discoverySeeds || [])
  ));
  if ((!scope?.id || scopeNeedsDirectorKeywords) && input.confirmedWeeklyBoundary) {
    const latest = await store.list<Record<string, any>>('social_discovery_scopes', {
      where: { tenant_id: input.tenantId }, sort: '-version', page: 1, perPage: 1,
    });
    const version = Math.max(1, Number(latest.items[0]?.version || 0) + 1);
    const profile = await readTenantEnterpriseProfile(input.tenantId);
    const strategy = await buildConfirmedWeeklyDiscoveryScopeWithKeywords(input.confirmedWeeklyBoundary, version, {
      companyType: profile.company.companyType,
      enabledRoutes: profile.socialStrategy?.enabledRoutes,
      products: profile.products.items || [],
    });
    if (strategy) {
      const now = new Date().toISOString();
      for (const active of result.items) {
        await store.update('social_discovery_scopes', active.id, { status: 'retired', updated_at: now });
      }
      scope = (await store.create<Record<string, any>>('social_discovery_scopes', {
        tenant_id: input.tenantId,
        keyword_set_id: strategy.keywordSet.keywordSetId,
        version,
        status: 'active',
        payload: strategy,
        created_by: input.confirmedWeeklyBoundary.approvedBy,
        created_at: now,
        updated_at: now,
      })) || undefined;
    }
  }
  if (!scope?.id) return null;
  let brief = scope.payload?.discoveryBrief || {};
  if (!brief.modePolicies && input.confirmedWeeklyBoundary) {
    brief = {
      ...brief,
      modePolicies: normalizeModePolicies(undefined, brief.discoveryModes || ['momentum', 'account', 'innovation'], Number(brief.resultLimit || input.limit || 20), brief.platforms || input.platforms || []),
    };
    scope.payload = { ...scope.payload, discoveryBrief: brief };
    await store.update('social_discovery_scopes', scope.id, { payload: scope.payload, updated_at: new Date().toISOString() });
  }
  const differences: string[] = [];
  const requestedPlatforms = [...new Set((input.platforms || []).map(value => String(value).toLowerCase()))].sort();
  const approvedPlatforms = [...new Set((brief.platforms || []).map((value: unknown) => String(value).toLowerCase()))].sort();
  if (requestedPlatforms.length && approvedPlatforms.length && requestedPlatforms.join(',') !== approvedPlatforms.join(',')) differences.push('采集平台');
  if (input.dateWindowDays && Number(brief.lookbackDays || 7) !== input.dateWindowDays) differences.push('视频发布时间范围');
  // The operating agent's per-run request limit and the director's rolling seven-day
  // qualified-content target have different units. Preserve both for review.
  const pendingReason = differences.length ? `经营建议与编导已批准范围的${differences.join('、')}不一致，待编导确认` : undefined;
  const ensured = ensureSocialDiscoveryCollectionTask({
    tenantId: input.tenantId, discoveryScopeId: String(scope.id), discoveryScopeVersion: Number(scope.version),
  });
  const latest = load();
  const canonical = latest.find(task => task.id === ensured.task.id && task.tenantId === input.tenantId)!;
  const refs: Array<{ workflowRunId: string; workflowTaskId: string }> = (() => {
    try { const parsed = JSON.parse(canonical.config.workflowRefs || '[]'); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  })();
  if (!refs.some(ref => ref.workflowTaskId === input.workflowTaskId)) {
    refs.push({ workflowRunId: input.workflowRunId, workflowTaskId: input.workflowTaskId });
    canonical.config = { ...canonical.config, workflowRefs: JSON.stringify(refs.slice(-100)) };
    save(latest);
  }
  const restConfig = { ...canonical.config };
  delete restConfig.directorReviewRequired;
  canonical.config = { ...restConfig, operatingRequest: JSON.stringify({ platforms: input.platforms, dateWindowDays: input.dateWindowDays, perRunLimit: input.limit, cronExpr: input.cronExpr, keywords: input.keywords }), ...(pendingReason ? { directorReviewRequired: pendingReason } : {}) };
  save(latest);
  return { task: canonical, created: ensured.created, updated: ensured.updated, pendingReason };
}

// Boot: restore active tasks
export async function initScheduler() {
  if (process.env.SCHEDULER_ENABLED === 'false') {
    console.log('[scheduler] disabled by SCHEDULER_ENABLED=false');
    return;
  }
  const authority = schedulerBootstrapAuthority(process.env, localFallbacksEnabled());
  await runWithDataAuthority(authority, async () => {
    await hydrateTasksFromPocketBase();
    try { await reconcileSocialDiscoveryCollectionTasks(); }
    catch (error) { console.warn('[scheduler] discovery schedule reconciliation skipped:', error instanceof Error ? error.message : error); }
    const tasks = load().filter(t => t.enabled && t.tenantId);
    tasks.forEach(scheduleTask);
    for (const task of tasks) {
      const missedAt = latestMissedRun(task);
      if (!missedAt) continue;
      console.log(`[scheduler] catching up "${task.name}" missed at ${missedAt.toISOString()}`);
      void executeAndPersistTask(task, 'catch-up');
    }
    console.log('[scheduler] initialized with', tasks.length, 'active tasks');
  });
}

export const schedulerRouter = Router();
schedulerRouter.use(requireAuth);

schedulerRouter.get('/', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(tenantTasks(tenantId).map(taskWithExecutionState));
});

schedulerRouter.get('/video-stats', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = tenantTasks(tenantId).filter(task => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType));
  let stats: Record<string, unknown>;
  try {
    stats = await getVideoPipelineStats(tenantId);
  } catch (e) {
    console.warn('[scheduler] video stats unavailable:', e instanceof Error ? e.message : e);
    stats = { total: 0, byPlatform: {}, byStatus: {}, ops: { workerEnabled: false } };
  }
  res.json({
    tasks: tasks.map(taskWithExecutionState),
    stats,
  });
});

schedulerRouter.get('/business-dynamics', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const forceRefresh = req.query.refresh === '1';
    const snapshot = await getBusinessDynamicsSnapshot(tenantId, forceRefresh);
    res.json(snapshot);
  } catch (error) {
    console.error('[scheduler] business dynamics unavailable:', error);
    res.status(503).json({
      error: 'business_dynamics_unavailable',
      message: '经营动态暂时无法生成，请稍后重试',
    });
  }
});

schedulerRouter.get('/:id/export-pdf', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const task = findTenantTask(req.params.id, tenantId);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  if (!task.lastRun || !task.lastResult) { res.status(409).json({ error: 'task_has_no_result' }); return; }
  try {
    const isVideoReport = ['video_keyword_crawl', 'competitor_account_crawl'].includes(task.taskType);
    const weekly = isVideoReport ? await weeklyVideoReport(task, tenantId) : null;
    const resultText = weekly
      ? `【本周新增视频】\n统计范围：${weekly.rangeLabel}\n新增视频：${weekly.newVideos} 条\n【分析情况】\n已完成策略分析：${weekly.completed} 条（其中全片精确分析 ${weekly.exactCompleted} 条）\n分析中：${weekly.analyzing} 条；排队中：${weekly.queued} 条\n仅基础分析：${weekly.basicOnly} 条；分析失败：${weekly.failed} 条`
      : task.lastResult;
    const pdf = await renderTaskReportPdf({
      title: `${task.name}报告`,
      taskName: task.name,
      cronLabel: task.cronLabel,
      lastRunLabel: formatTaskTime(task.lastRun),
      weekRangeLabel: weekly?.rangeLabel,
      weeklyStats: weekly,
      resultText,
      actions: taskReportActions(task.taskType),
    });
    const filename = encodeURIComponent(`${task.name}-任务报告.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(pdf);
  } catch (e) {
    console.error('[scheduler] export pdf failed:', e);
    res.status(500).json({ error: 'pdf_render_unavailable' });
  }
});

schedulerRouter.post('/', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  if (req.body.taskType === 'social_discovery_collection') {
    res.status(403).json({ error: 'discovery_schedule_managed_by_scope' });
    return;
  }
  const tasks = load();
  const isCrawler = ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(req.body.taskType);
  const requestedCronExpr = String(req.body.cronExpr ?? (isCrawler ? '0 1 * * *' : '0 8 * * *'));
  if (!cron.validate(requestedCronExpr)) { res.status(400).json({ error: '无效的任务启动时间' }); return; }
  const crawlerPlatform = resolveCrawlerPlatform(req.body.config?.platforms);
  if (['video_keyword_crawl', 'image_post_crawl'].includes(req.body.taskType) && !(req.body.taskType === 'video_keyword_crawl' && await readSavedDiscoveryScope(tenantId))) {
    const keywordReview = normalizeKeywordInput(String(req.body.config?.keywords || req.body.config?.keyword || ''), crawlerPlatform as KeywordPlatform);
    if (!keywordReview.items.length) {
      res.status(400).json({ error: 'invalid_keywords', message: '没有识别到当前平台可用的关键词', rejected: keywordReview.rejected });
      return;
    }
  }
  const crawlerConfig = normalizeCrawlerConfig({ ...(req.body.config ?? {}), tenantId }, crawlerPlatform);
  const task: ScheduledTask = {
    id: `task_${Date.now()}`,
    name: req.body.name,
    category: req.body.category ?? 'daily',
    taskType: req.body.taskType ?? 'custom',
    cronExpr: requestedCronExpr,
    cronLabel: req.body.cronLabel ?? (isCrawler ? '每天 01:00（北京时间）' : '每天 08:00'),
    enabled: req.body.enabled ?? true,
    channelId: req.body.channelId,
    config: isCrawler ? crawlerConfig : (req.body.config ?? {}),
    tenantId,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  save(tasks);
  scheduleTask(task);
  res.json(task);
});

schedulerRouter.put('/:id', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id && t.tenantId === tenantId);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  const current = tasks[idx];
  const nextTaskType = req.body.taskType ?? current.taskType;
  if (current.taskType === 'social_discovery_collection' || nextTaskType === 'social_discovery_collection') {
    res.status(403).json({ error: 'discovery_schedule_managed_by_scope' });
    return;
  }
  const requestedCronExpr = String(req.body.cronExpr ?? current.cronExpr);
  if (!cron.validate(requestedCronExpr)) { res.status(400).json({ error: '无效的任务启动时间' }); return; }
  const nextIsCrawler = ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(nextTaskType);
  const mergedConfig = { ...current.config, ...(req.body.config ?? {}) };
  if (['video_keyword_crawl', 'image_post_crawl'].includes(nextTaskType) && !(nextTaskType === 'video_keyword_crawl' && await readSavedDiscoveryScope(tenantId))) {
    const platform = resolveCrawlerPlatform(mergedConfig.platforms, current.config.platforms || 'youtube');
    const keywordReview = normalizeKeywordInput(String(mergedConfig.keywords || mergedConfig.keyword || ''), platform as KeywordPlatform);
    if (!keywordReview.items.length) {
      res.status(400).json({ error: 'invalid_keywords', message: '没有识别到当前平台可用的关键词', rejected: keywordReview.rejected });
      return;
    }
  }
  const nextConfig = nextIsCrawler
    ? normalizeCrawlerConfig(mergedConfig, current.config.platforms || 'youtube')
    : (req.body.config ?? current.config);
  tasks[idx] = {
    ...current,
    ...req.body,
    tenantId,
    cronExpr: requestedCronExpr,
    cronLabel: req.body.cronLabel ?? current.cronLabel,
    config: nextIsCrawler ? { ...nextConfig, tenantId } : nextConfig,
  };
  save(tasks);
  scheduleTask(tasks[idx]);
  res.json(tasks[idx]);
});

schedulerRouter.delete('/:id', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const task = findTenantTask(req.params.id, tenantId);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  if (task.taskType === 'social_discovery_collection') { res.status(403).json({ error: 'discovery_schedule_managed_by_scope' }); return; }
  activeJobs.get(req.params.id)?.stop();
  activeJobs.delete(req.params.id);
  save(load().filter(t => !(t.id === req.params.id && t.tenantId === tenantId)));
  res.json({ ok: true });
});

// Run immediately
schedulerRouter.post('/:id/run', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const outcome = await runScheduledTaskNow({ tenantId, taskId: req.params.id });
    res.json({ ok: true, ...outcome });
  } catch (error) {
    if (error instanceof Error && error.message === 'scheduled_task_not_found') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    console.error('[scheduler] immediate task run failed:', error);
    res.status(500).json({ error: 'task_run_failed', message: '任务启动失败，请稍后重试。' });
  }
});

// Toggle enabled
schedulerRouter.post('/:id/toggle', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id && t.tenantId === tenantId);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  tasks[idx].enabled = !tasks[idx].enabled;
  save(tasks);
  scheduleTask(tasks[idx]);
  res.json(tasks[idx]);
});
