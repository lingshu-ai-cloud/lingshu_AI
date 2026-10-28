import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import type { SocialInsightJob, SocialInsightMerchantContext } from '../../shared/socialInsightReport.js';
import { socialInsightQueries } from '../../shared/socialInsightQueries.mjs';
import { buildApifyTikTokInput } from '../routes/apifyTikTokInput.js';
import { runPaidApifyTikTokDataset, type PaidApifyTikTokPermit } from '../routes/apifyPaidTikTokTransport.js';
import { analyzeSocialInsight } from './model.js';
import { dashscopeApiKey } from '../agents/qwenClient.js';
import { insightPeriod, snapshotReport } from './report.js';
import { classificationPrompt, applyClassification } from './classification.js';
import { emptyInsightMerchantContext } from './merchantContext.js';
import { apifyMonthlyLimitRefusal, apifySearchUncompleted, monthlyLimitError } from './providerFailure.js';
export const SOCIAL_INSIGHT_COLLECTION = 'social_insight_reports';
type Row = { id: string; tenant_id: string; request_id: string; keyword: string; job: SocialInsightJob;
  phase: 'reserved' | 'submitted_unknown' | 'submitted_known' | 'completed'; requestHash?: string;
  runId?: string; datasetId?: string; usageTotalUsd?: number; receipts?: unknown[] };
export interface InsightConfig { actorId: string; token: string; maxUsd: number; datasetReadMaxUsd: number; proxyCountry?: 'US'; omitSearchDateFilter?: boolean; confirmedKeyword?: string }
export interface InsightDependencies {
  store: DataStore; config?: () => InsightConfig | null;
  collect?: typeof runPaidApifyTikTokDataset;
  merchantContext?: (tenantId: string) => Promise<SocialInsightMerchantContext>;
  analyze?: (prompt: string) => Promise<string>;
  executeScope?: <T>(config: InsightConfig, fn: () => Promise<T>) => Promise<T>;
  schedule?: (fn: () => Promise<void>) => void; now?: () => Date;
}
export function insightConfig(env: NodeJS.ProcessEnv = process.env): InsightConfig | null {
  const maxUsd = Number(env.SOCIAL_INSIGHTS_APIFY_MAX_USD), datasetReadMaxUsd = Number(env.SOCIAL_INSIGHTS_APIFY_DATASET_MAX_USD);
  const actorId = env.SOCIAL_INSIGHTS_APIFY_ACTOR_ID || '';
  const token = env.APIFY_TOKEN || env.APIFY_API_TOKEN || '';
  const proxyCountry = env.SOCIAL_INSIGHTS_APIFY_PROXY_COUNTRY?.trim() || '';
  if (proxyCountry && proxyCountry !== 'US') return null;
  if (env.SOCIAL_INSIGHTS_ENABLED !== '1' || !token || actorId !== 'clockworks~tiktok-scraper'
    || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 0.5
    || !Number.isFinite(datasetReadMaxUsd) || datasetReadMaxUsd <= 0 || datasetReadMaxUsd > 0.05) return null;
  // Follow the existing provider's environment/file credential resolution.
  // Only availability is inspected here; the secret is never copied to job data.
  try { dashscopeApiKey(env); } catch { return null; }
  const dateFilter = env.SOCIAL_INSIGHTS_APIFY_SEARCH_DATE_FILTER?.trim() || '';
  if (dateFilter && dateFilter !== '0' && dateFilter !== '1') return null;
  return { actorId, token, maxUsd, datasetReadMaxUsd, ...(proxyCountry === 'US' ? {proxyCountry} : {}), omitSearchDateFilter: dateFilter !== '1' };
}
export class SocialInsightError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
const error = (code: string, message: string) => ({ code, message });
export function createSocialInsightService(deps: InsightDependencies) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  async function read(tenantId: string, id: string): Promise<Row | null> {
    const row = await deps.store.getById<Row>(SOCIAL_INSIGHT_COLLECTION, id);
    return row?.tenant_id === tenantId ? row : null;
  }
  async function save(row: Row): Promise<void> {
    row.job.updatedAt = now();
    if (!await deps.store.update(SOCIAL_INSIGHT_COLLECTION, row.id, row)) throw Error('social_insight_persistence_failed');
  }
  async function execute(row: Row, config: InsightConfig): Promise<void> {
    const permit: PaidApifyTikTokPermit = { operationId: row.id, actorId: config.actorId, maxTotalChargeUsd: config.maxUsd,
      inspect: async input => {
        if (input.actorId !== config.actorId || input.maxTotalChargeUsd !== config.maxUsd || row.requestHash && row.requestHash !== input.requestHash) throw Error('social_insight_request_changed');
        if (row.phase === 'submitted_known' || row.phase === 'completed') return {status: row.phase, runId: row.runId!, datasetId: row.datasetId!, usageTotalUsd: row.usageTotalUsd!};
        return { status: row.phase };
      },
      beforeSubmit: async input => { row.phase = 'submitted_unknown'; row.requestHash = input.requestHash; await save(row); },
      recordRun: async input => { row.runId = input.runId; row.datasetId = input.datasetId; row.phase = 'submitted_known'; await save(row); },
      recordTerminal: async input => { row.usageTotalUsd = input.usageTotalUsd; row.phase = 'completed'; await save(row); },
      beforeDatasetRead: async input => { if (input.runId !== row.runId || input.datasetId !== row.datasetId || input.maxItems > 30 || !config.datasetReadMaxUsd) throw Error('social_insight_dataset_read_not_authorized'); },
      persistRawReceipt: async receipt => { row.receipts = [...(row.receipts || []), receipt]; await save(row); return `${row.id}:${row.receipts.length}`; },
    };
    try {
      row.job.status = 'running'; row.job.stage = 'collecting'; await save(row);
      const period = insightPeriod(new Date(row.job.createdAt));
      const actorInput = buildApifyTikTokInput(row.keyword, 7, period.from, period.to);
      // This scene always means a keyword search, even for a single word or URL-shaped input.
      delete actorInput.hashtags; delete actorInput.profiles; delete actorInput.postURLs;
      actorInput.searchQueries = socialInsightQueries(row.keyword); actorInput.searchSection = '/video';
      if (config.proxyCountry) actorInput.proxyCountryCode = config.proxyCountry;
      if (config.omitSearchDateFilter !== false) delete actorInput.videoSearchDateFilter;
      const rows = await (deps.collect ?? runPaidApifyTikTokDataset)({ actorId: config.actorId, actorInput, permit, token: config.token, maxItems: 30, timeoutMs: 180000 });
      const report = snapshotReport(row.keyword, rows, new Date(row.job.createdAt));
      report.collectedAt = now(); row.job.report = report;
      if (!report.sampleCount) { row.job.status = 'empty'; row.job.stage = 'completed'; await save(row); return; }
      report.merchantContext = await (deps.merchantContext?.(row.tenant_id).catch(() => emptyInsightMerchantContext()) ?? Promise.resolve(emptyInsightMerchantContext()));
      row.job.stage = 'analyzing'; await save(row);
      try {
        const analysis = await (deps.analyze ?? analyzeSocialInsight)(classificationPrompt(report));
        applyClassification(report, analysis);
        row.job.status = 'succeeded';
      } catch {
        row.job.status = 'partial'; row.job.error = error('social_insight_analysis_failed', '公开样本与图表已保留，报告解读暂未完成。不会自动重复采集或调用模型。');
      }
      row.job.stage = 'completed'; await save(row);
    } catch (cause) {
      if (apifyMonthlyLimitRefusal(row.receipts, row.runId)) {
        row.job.status='blocked';row.job.stage='blocked';row.job.error=monthlyLimitError();await save(row);return;
      }
      // Any submitted operation without a verified result is deliberately not replayed.
      const code = cause instanceof Error && /^apify_paid_[a-z0-9_]+$/.test(cause.message) ? cause.message : 'social_insight_execution_failed';
      row.job.status = row.phase === 'submitted_unknown' || row.phase === 'submitted_known' ? 'unknown' : 'failed';
      row.job.stage = 'completed'; row.job.error = error(code, code === 'apify_paid_search_uncompleted'
        ? '社媒搜索请求未成功完成，尚未取得可用素材；已保留原任务回执。' : row.job.status === 'unknown'
        ? '采集请求结果尚未确认，已保留任务回执，请勿重复提交。' : '本次采集未完成，不会自动重试付费请求。');
      await save(row);
    }
  }
  return {
    async create(tenantId: string, keyword: string, requestId: string): Promise<SocialInsightJob> {
      keyword = keyword.trim();
      try { socialInsightQueries(keyword); } catch { throw new SocialInsightError('social_insight_keyword_invalid'); }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new SocialInsightError('social_insight_request_id_invalid');
      const id = createHash('sha256').update(`${tenantId}\0${requestId}`).digest('hex').slice(0, 15);
      const existing = await read(tenantId, id);
      if (existing) { if (existing.keyword !== keyword) throw new SocialInsightError('social_insight_request_conflict', 409); return existing.job; }
      const config = (deps.config ?? insightConfig)();
      const job: SocialInsightJob = { id, keyword, status: config ? 'queued' : 'blocked', stage: config ? 'queued' : 'blocked', createdAt: now(), updatedAt: now(),
        ...(!config ? {error: error('social_insight_not_configured', '社媒采集尚未启用：需要服务端配置 Apify 凭据、采集与数据读取预算，以及千问模型。')} : {}) };
      const row: Row = { id, tenant_id: tenantId, request_id: requestId, keyword, job, phase: 'reserved' };
      const created = await deps.store.create<Row>(SOCIAL_INSIGHT_COLLECTION, row);
      if (!created) { const raced = await read(tenantId, id); if (raced && raced.keyword === keyword) return raced.job; throw new SocialInsightError('social_insight_storage_unavailable', 503); }
      if (config) (deps.schedule ?? (fn => { void fn().catch(() => console.error('[social-insights] persistent task failed')); }))(
        async () => {
          try {
            if (deps.executeScope) await deps.executeScope({...config, confirmedKeyword: row.keyword}, () => execute(row, config));
            else await execute(row, config);
          } catch {
            // Scope admission happens before execute(). A rejected capability is
            // an explicit block, not a queued task or a claimed supplier failure.
            const submitted = row.phase !== 'reserved';
            row.job.status = submitted ? 'unknown' : 'blocked';
            row.job.stage = submitted ? 'completed' : 'blocked';
            row.job.error = submitted
              ? error('social_insight_scope_interrupted', '执行作用域已中断，供应商请求结果需核验。已保留任务回执，不会重复提交。')
              : error('social_insight_scope_rejected', '当前执行环境未允许本次社媒采集，尚未向供应商提交请求。');
            await save(row);
          }
        });
      return job;
    },
    async get(tenantId: string, id: string): Promise<SocialInsightJob | null> {
      const row = await read(tenantId, id);
      if (!row) return null;
      if (row.job.status === 'empty' && apifySearchUncompleted(row.receipts, row.runId)) {
        row.job.status = 'failed'; row.job.error = error('apify_paid_search_uncompleted', '社媒搜索请求未成功完成，尚未取得可用素材；已保留原任务回执。'); await save(row);
      }
      if (apifyMonthlyLimitRefusal(row.receipts, row.runId) && row.job.error?.code !== 'social_insight_apify_monthly_limit') {
        row.job.status='blocked';row.job.stage='blocked';row.job.error=monthlyLimitError();await save(row);
      }
      if (['queued', 'running'].includes(row.job.status) && Date.now() - Date.parse(row.job.updatedAt) > 300000) {
        row.job.status = 'unknown'; row.job.stage = 'completed'; row.job.error = error('social_insight_interrupted', '任务处理已中断或超时，已保留原始回执，不会重新启动付费采集。'); await save(row);
      }
      return row.job;
    },
  };
}
