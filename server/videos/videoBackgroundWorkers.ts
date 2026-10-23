import { metadataFallbackAnalysis } from '../routes/videoCrawlerMetadataFallback.js';
import { compactVideoPipelineError } from '../routes/videoAnalysisRecovery.js';
import { classifyCrawlerFailure, crawlerRetryDelayMs, filterCrawlerOpsTasksForRecordIds } from '../routes/videoCrawlerOpsTaskState.js';
import { cookieBrowsers, cookieFiles, crawlerExecutionEnv, crawlerProxyPool, crawlerProxyUrl, redactProxy, selectCrawlerProxy } from '../routes/videoCrawlerRuntimeConfig.js';
import { AnalysisAlreadyRunningError } from '../lib/analysisLease.js';
import { store } from '../storage/index.js';
import type { VideoStatus } from '../types/index.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { currentDataAuthority, runWithDataAuthority } from '../storage/dataAuthority.js';
import { parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { hasDurableExactAnalysisOwner, isOwnerlessExactAnalysisStale } from '../lib/videoAnalysisProgress.js';
import { COL, EXACT_ANALYSIS_STALL_MS } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoBackgroundWorkers(deps: Pick<VideoApplicationPorts, 'loadCrawlerOpsTasks' | 'activeAnalysisRecords' | 'durableAnalysisRecords' | 'backfillMissingCrawledMedia' | 'executeQueuedLocalAnalysisRecord' | 'enqueueOpsTasksFromRecords' | 'crawlerOpsRecordIdsForTenant' | 'pendingCrawlerOpsTasks' | 'updateCrawlerOpsTask' | 'analyzeSourceVideoJob' | 'persistManualVideoFailure' | 'apifyVideoUsageToday' | 'apifyVideoDailyLimit' | 'apifyVideoTenantDailyLimit'>) {
  const loadCrawlerOpsTasks: VideoApplicationPorts['loadCrawlerOpsTasks'] = (...args) => deps.loadCrawlerOpsTasks(...args);
  const activeAnalysisRecords = deps.activeAnalysisRecords;
  const durableAnalysisRecords = deps.durableAnalysisRecords;
  const backfillMissingCrawledMedia: VideoApplicationPorts['backfillMissingCrawledMedia'] = (...args) => deps.backfillMissingCrawledMedia(...args);
  const executeQueuedLocalAnalysisRecord: VideoApplicationPorts['executeQueuedLocalAnalysisRecord'] = (...args) => deps.executeQueuedLocalAnalysisRecord(...args);
  const enqueueOpsTasksFromRecords: VideoApplicationPorts['enqueueOpsTasksFromRecords'] = (...args) => deps.enqueueOpsTasksFromRecords(...args);
  const crawlerOpsRecordIdsForTenant: VideoApplicationPorts['crawlerOpsRecordIdsForTenant'] = (...args) => deps.crawlerOpsRecordIdsForTenant(...args);
  const pendingCrawlerOpsTasks: VideoApplicationPorts['pendingCrawlerOpsTasks'] = (...args) => deps.pendingCrawlerOpsTasks(...args);
  const updateCrawlerOpsTask: VideoApplicationPorts['updateCrawlerOpsTask'] = (...args) => deps.updateCrawlerOpsTask(...args);
  const analyzeSourceVideoJob: VideoApplicationPorts['analyzeSourceVideoJob'] = (...args) => deps.analyzeSourceVideoJob(...args);
  const persistManualVideoFailure: VideoApplicationPorts['persistManualVideoFailure'] = (...args) => deps.persistManualVideoFailure(...args);
  const apifyVideoUsageToday: VideoApplicationPorts['apifyVideoUsageToday'] = (...args) => deps.apifyVideoUsageToday(...args);
  const apifyVideoDailyLimit: VideoApplicationPorts['apifyVideoDailyLimit'] = (...args) => deps.apifyVideoDailyLimit(...args);
  const apifyVideoTenantDailyLimit: VideoApplicationPorts['apifyVideoTenantDailyLimit'] = (...args) => deps.apifyVideoTenantDailyLimit(...args);

  let crawlerOpsWorkerTimer: NodeJS.Timeout | null = null;

  let crawlerOpsWorkerActive = false;

  let localAnalysisWorkerActive = false;

  let stalledExactSweepTimer: NodeJS.Timeout | null = null;

  let runtimeCrawlerProxy = '';

  const lastStallSweepAt = new Map<string, number>();

  async function releaseStalledExactAnalysis(forceInterrupted = false, tenantId?: string): Promise<number> {
    const now = Date.now();
    const sweepKey = `${currentDataAuthority() || 'default'}:${tenantId || '__global__'}`;
    const lastSweep = lastStallSweepAt.get(sweepKey) || 0;
    if (!forceInterrupted && now - lastSweep < Math.max(60_000, Math.floor(EXACT_ANALYSIS_STALL_MS / 6))) return 0;
    lastStallSweepAt.set(sweepKey, now);

    const candidates: Record<string, unknown>[] = [];
    let page = 1;
    for (;;) {
      const result = await store.list<Record<string, unknown>>(COL, { where: tenantId ? { tenantId } : undefined, page, perPage: 500 });
      for (const record of result.items) {
        if (parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {}).requestedAnalysisMode === 'exact') {
          candidates.push(record);
        }
      }
      if (page >= result.totalPages || page >= 20) break;
      page += 1;
    }
    if (!candidates.length) return 0;

    // 运维队列里还在排队/处理中的不抢，交给 worker 继续跑完。
    const inFlight = process.env.CRAWLER_OPS_WORKER_ENABLED === '0'
      ? new Set<string>()
      : new Set(loadCrawlerOpsTasks()
        .filter(task => !tenantId || task.tenantId === tenantId || candidates.some(record => String(record.id || '') === task.recordId))
        .filter(task => ['queued', 'pushed', 'processing'].includes(task.status))
        .map(task => task.recordId));

    let released = 0;
    for (const record of candidates) {
      const recordId = String(record.id || '');
      if (!recordId || inFlight.has(recordId) || activeAnalysisRecords.has(recordId) || durableAnalysisRecords.has(recordId)) continue;
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      // Local/material jobs are recoverable by the durable analysis Worker.
      // Legacy maintenance_exact markers never entered that queue. Keeping them
      // here produced a permanent false “分析中” state after the script exited.
      if (hasDurableExactAnalysisOwner(analysis)) continue;
      // Startup bypasses only the sweep throttle. It does not make a recent
      // maintenance script stale: without a queue lease we still require an old
      // heartbeat/activity timestamp before releasing the marker.
      if (!isOwnerlessExactAnalysisStale({
        analysis,
        recordUpdatedAt: record.maintenanceHeartbeatAt || record.updated || record.updatedAt,
        nowMs: now,
        stallMs: EXACT_ANALYSIS_STALL_MS,
      })) continue;
      const failedAt = new Date().toISOString();
      await store.update(COL, recordId, {
        status: (analysis.gemini ? 'analyzed' : 'failed') as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          requestedAnalysisMode: undefined,
          analysisQueueState: 'failed',
          analysisStage: 'failed',
          analysisStageUpdatedAt: failedAt,
          analysisFailedAt: failedAt,
          analysisRetryable: true,
          // 超时的升级不能冒充已完成的精确分析。
          analysisMode: analysis.analysisMode === 'exact' ? 'exact' : 'strategy',
          geminiStatus: 'analysis_retryable',
          videoLevelFailureStatus: analysis.videoLevelFailureStatus || '后台分析中断，可重试或恢复',
          analysisError: analysis.analysisError || 'exact_analysis_stalled',
        }),
      });
      released += 1;
      console.warn(`[videos] exact analysis ${forceInterrupted ? 'interrupted by restart' : 'stalled'}, released for retry: ${recordId}`);
    }
    return released;
  }

  async function releaseStalledExactAnalysisAcrossAuthorities(forceInterrupted = false): Promise<number> {
    let released = await releaseStalledExactAnalysis(forceInterrupted);
    // Local demo accounts and PocketBase accounts can coexist in development.
    // A process-level sweep has no request authority, so a healthy PocketBase
    // connection used to make local JSON records invisible to recovery and left
    // their UI permanently stuck on “分析中”. Sweep the explicitly enabled local
    // authority as a second, isolated data source.
    if (localFallbacksEnabled() && currentDataAuthority() !== 'local') {
      released += await runWithDataAuthority('local', () => releaseStalledExactAnalysis(forceInterrupted));
    }
    return released;
  }

  let pocketBaseBackfillTimer: NodeJS.Timeout | null = null;

  let pocketBaseBackfillRunning = false;

  function initPocketBaseVideoBackfill(): void {
    // Backfill is an operational migration, not a normal runtime responsibility.
    // It is opt-in so local/admin/tenant dashboards cannot accidentally start a
    // full-library media conversion merely by starting the API.
    if (pocketBaseBackfillTimer || process.env.PB_VIDEO_BACKFILL_ENABLED !== 'true') return;
    const run = async () => {
      if (pocketBaseBackfillRunning) return;
      pocketBaseBackfillRunning = true;
      try {
        const first = await store.list<Record<string, unknown>>(COL, { sort: '-crawledAt', page: 1, perPage: 100 });
        const records = [...first.items];
        for (let page = 2; page <= first.totalPages; page += 1) {
          const next = await store.list<Record<string, unknown>>(COL, { sort: '-crawledAt', page, perPage: 100 });
          records.push(...next.items);
        }
        await backfillMissingCrawledMedia(records);
      } catch (error) {
        console.warn('[videos] scheduled PocketBase backfill failed:', error instanceof Error ? error.message : error);
      } finally {
        pocketBaseBackfillRunning = false;
      }
    };
    void run();
    pocketBaseBackfillTimer = setInterval(() => void run(), Math.max(30_000, Number(process.env.PB_VIDEO_BACKFILL_INTERVAL_MS || 60_000)));
    pocketBaseBackfillTimer.unref();
  }

  function proxyUrl(): string {
    return crawlerProxyUrl(runtimeCrawlerProxy);
  }

  function crawlerExecEnv(): NodeJS.ProcessEnv {
    return crawlerExecutionEnv(runtimeCrawlerProxy);
  }

  async function runQueuedLocalAnalysisWorkerOnce(options: { recoverInterrupted?: boolean; tenantId?: string } = {}): Promise<{
    picked: number;
    completed: number;
    failed: number;
    skipped: number;
  }> {
    if (localAnalysisWorkerActive) return { picked: 0, completed: 0, failed: 0, skipped: 0 };
    localAnalysisWorkerActive = true;
    let picked = 0;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    try {
      const records: Record<string, unknown>[] = [];
      for (let page = 1; ; page += 1) {
        const result = await store.list<Record<string, unknown>>(COL, {
          where: options.tenantId ? { tenantId: options.tenantId } : undefined,
          sort: 'updated',
          page,
          perPage: 300,
        });
        records.push(...result.items);
        if (page >= result.totalPages || !result.items.length || page >= 20) break;
      }
      const now = Date.now();
      const staleMs = Math.max(5 * 60_000, Number(process.env.LOCAL_ANALYSIS_RECOVERY_MS || 15 * 60_000));
      const candidates = records.filter(record => {
        const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
        if (!analysis.requestedAnalysisMode) return false;
        const kind = String(analysis.analysisQueueKind || '');
        if (kind === 'source_url') return false;
        if (!['material', 'stored_video', 'classification_repair'].includes(kind) && !record.videoFileId && !analysis.materialId) return false;
        const state = String(analysis.analysisQueueState || 'queued');
        if (state === 'queued') return true;
        if (state !== 'running') return false;
        if (options.recoverInterrupted) return true;
        const startedAt = Date.parse(String(analysis.analysisWorkerStartedAt || record.updated || ''));
        return Number.isFinite(startedAt) && now - startedAt >= staleMs;
      }).slice(0, Math.max(1, Number(process.env.LOCAL_ANALYSIS_WORKER_BATCH || 2)));

      for (const record of candidates) {
        const recordId = String(record.id || '');
        if (!recordId || activeAnalysisRecords.has(recordId)
          || (!options.recoverInterrupted && durableAnalysisRecords.has(recordId))) {
          skipped += 1;
          continue;
        }
        picked += 1;
        try {
          if (await executeQueuedLocalAnalysisRecord(recordId)) completed += 1;
          else skipped += 1;
        } catch (error) {
          if (error instanceof AnalysisAlreadyRunningError) skipped += 1;
          else failed += 1;
        }
      }
    } finally {
      localAnalysisWorkerActive = false;
    }
    return { picked, completed, failed, skipped };
  }

  function initCrawlerOpsWorker(): void {
    const workerFlag = process.env.CRAWLER_OPS_WORKER_ENABLED;
    const intervalMs = Math.max(5_000, Number(process.env.CRAWLER_OPS_WORKER_INTERVAL_MS || 30_000));
    if (!stalledExactSweepTimer) {
      const sweep = () => void releaseStalledExactAnalysisAcrossAuthorities().catch(error => {
        console.warn('[videos] stalled exact-analysis sweep failed:', error instanceof Error ? error.message : error);
      });
      stalledExactSweepTimer = setInterval(sweep, intervalMs);
      // Every requested exact analysis belongs to the previous process at this
      // point. Clear those locks now; waiting for the age threshold creates a
      // false permanent queue after deployments or crashes.
      void releaseStalledExactAnalysisAcrossAuthorities(true).catch(error => {
        console.warn('[videos] interrupted exact-analysis recovery failed:', error instanceof Error ? error.message : error);
      });
      console.log(`[videos] stalled exact-analysis sweep enabled, interval=${intervalMs}ms`);
    }
    if (crawlerOpsWorkerTimer || workerFlag === '0') return;
    crawlerOpsWorkerTimer = setInterval(() => {
      void runCrawlerOpsWorkerOnce().then(logCrawlerOpsWorkerResult).catch((e) => {
        console.warn('[crawler-ops] worker tick failed:', e instanceof Error ? e.message : e);
      });
      void runQueuedLocalAnalysisWorkerOnce().then(result => {
        if (result.picked) console.log(`[video-analysis-worker] picked=${result.picked} completed=${result.completed} failed=${result.failed} skipped=${result.skipped}`);
      }).catch((e) => {
        console.warn('[video-analysis-worker] tick failed:', e instanceof Error ? e.message : e);
      });
    }, intervalMs);
    // No analysis job survives a process restart. Recover records persisted as
    // downloading/analyzing immediately on the first tick instead of waiting for
    // the normal active-job stall timeout.
    void runCrawlerOpsWorkerOnce({ recoverInterrupted: true }).then(logCrawlerOpsWorkerResult).catch((e) => {
      console.warn('[crawler-ops] initial tick failed:', e instanceof Error ? e.message : e);
    });
    void runQueuedLocalAnalysisWorkerOnce({ recoverInterrupted: true }).catch((e) => {
      console.warn('[video-analysis-worker] initial recovery failed:', e instanceof Error ? e.message : e);
    });
    console.log(`[crawler-ops] worker enabled, interval=${intervalMs}ms`);
  }

  function logCrawlerOpsWorkerResult(result: { picked: number; resolved: number; retried: number; failed: number; skipped: number }): void {
    if (result.picked === 0) return;
    console.log(`[crawler-ops] picked=${result.picked} resolved=${result.resolved} retried=${result.retried} failed=${result.failed} skipped=${result.skipped}`);
  }

  async function runCrawlerOpsWorkerOnce(options: { recoverInterrupted?: boolean; tenantId?: string } = {}): Promise<{
    ok: boolean;
    picked: number;
    resolved: number;
    retried: number;
    failed: number;
    skipped: number;
  }> {
    if (crawlerOpsWorkerActive) {
      return { ok: true, picked: 0, resolved: 0, retried: 0, failed: 0, skipped: 0 };
    }
    crawlerOpsWorkerActive = true;
    const previousProxy = runtimeCrawlerProxy;
    const maxBatch = Math.max(1, Number(process.env.CRAWLER_OPS_WORKER_BATCH || 2));
    const maxAttempts = Math.max(1, Number(process.env.CRAWLER_OPS_MAX_ATTEMPTS || 5));
    let picked = 0;
    let resolved = 0;
    let retried = 0;
    let failed = 0;
    let skipped = 0;
    try {
      const tenantId = options.tenantId?.trim() || undefined;
      await enqueueOpsTasksFromRecords(options.recoverInterrupted === true, tenantId, maxAttempts);
      // 回收卡死的精确分析请求。失败不应连累队列本身，单独兜住。
      await releaseStalledExactAnalysis(false, tenantId).catch(error => {
        console.warn('[videos] stalled exact-analysis sweep failed:', error instanceof Error ? error.message : error);
        return 0;
      });
      const visibleRecordIds = tenantId ? await crawlerOpsRecordIdsForTenant(tenantId) : undefined;
      const candidates = pendingCrawlerOpsTasks(maxAttempts, visibleRecordIds).slice(0, maxBatch);
      for (const task of candidates) {
        picked += 1;
        const record = await store.getById(COL, task.recordId);
        if (!record) {
          updateCrawlerOpsTask(task.id, { status: 'failed', lastError: 'record_not_found', reason: 'record_not_found' });
          failed += 1;
          continue;
        }
        if (tenantId && String(record.tenantId || '') !== tenantId) {
          // A tenant-scoped HTTP run must never mutate a task whose backing
          // record moved or was incorrectly associated with another tenant.
          skipped += 1;
          continue;
        }
        if (activeAnalysisRecords.has(task.recordId)
          || (!options.recoverInterrupted && durableAnalysisRecords.has(task.recordId))) { skipped += 1; continue; }
        const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
        if (!previous.requestedAnalysisMode && ['paused', 'cancelled'].includes(String(previous.analysisQueueState || previous.geminiStatus || ''))) {
          updateCrawlerOpsTask(task.id, { status: 'resolved', reason: String(previous.analysisQueueState || previous.geminiStatus) });
          skipped += 1;
          continue;
        }
        if (previous.analysisQuality === 'video' && previous.requestedAnalysisMode !== 'exact') {
          updateCrawlerOpsTask(task.id, { status: 'resolved', lastStrategy: 'already_video' });
          resolved += 1;
          continue;
        }

        const attemptNo = task.attempts + 1;
        runtimeCrawlerProxy = selectCrawlerProxy(attemptNo);
        const strategy = [
          runtimeCrawlerProxy ? `proxy:${redactProxy(runtimeCrawlerProxy)}` : 'proxy:direct',
          cookieFiles().length ? `cookieFiles:${cookieFiles().length}` : '',
          cookieBrowsers().length ? `browsers:${cookieBrowsers().join('|')}` : '',
        ].filter(Boolean).join(' ');
        updateCrawlerOpsTask(task.id, {
          status: 'processing',
          attempts: attemptNo,
          lastStrategy: strategy,
          updatedAt: new Date().toISOString(),
        });
        await store.update(COL, task.recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...previous,
            downloadStatus: 'downloading',
            videoFetchStatus: 'ops_processing',
            geminiStatus: 'waiting_for_video',
            crawlerOpsTaskId: task.id,
            crawlerOpsStatus: 'processing',
            crawlerOpsStrategy: strategy,
            crawlerOpsAttempt: attemptNo,
            crawlerOpsStartedAt: new Date().toISOString(),
          }),
        });

        try {
          await analyzeSourceVideoJob({
            record,
            sourceUrl: task.sourceUrl,
            title: task.title,
            platform: task.platform,
            opsTaskId: task.id,
            suppressOpsRequeue: true,
          });
          const completed = await store.getById(COL, task.recordId);
          const evidence = parseJsonRecord<Record<string, unknown>>(completed?.aiAnalysis, {});
          if (!['video', 'video_review_required'].includes(String(evidence.analysisQuality || '')) || !evidence.gemini) {
            throw new Error(String(evidence.analysisError || evidence.downloadError || 'video_analysis_missing: metadata is not video-level analysis'));
          }
          updateCrawlerOpsTask(task.id, {
            status: 'resolved',
            lastStrategy: evidence.analysisQuality === 'video_review_required' ? `${strategy}; quality_review_required` : strategy,
            updatedAt: new Date().toISOString(),
          });
          resolved += 1;
        } catch (e) {
          if (e instanceof AnalysisAlreadyRunningError) {
            updateCrawlerOpsTask(task.id, { status: 'queued', attempts: task.attempts, lastError: 'analysis_already_running' });
            skipped += 1;
            continue;
          }
          const errorMessage = e instanceof Error ? e.message : String(e);
          const compactError = compactVideoPipelineError(errorMessage);
          const compactReason = compactVideoPipelineError(classifyCrawlerFailure(errorMessage), 360);
          // Every platform fallback already ran under downloadVideoForAnalysis's
          // single deadline and ownership lock. Do not start a second independent
          // actor/download chain here after the attempt has exhausted its budget.
          const canRetry = attemptNo < maxAttempts;
          updateCrawlerOpsTask(task.id, {
            status: canRetry ? 'queued' : 'failed',
            reason: compactReason,
            lastError: compactError,
            lastStrategy: strategy,
            updatedAt: new Date().toISOString(),
          });
          if (!canRetry) {
            const fallback = metadataFallbackAnalysis({
              platform: task.platform,
              title: task.title,
              duration: Number(record.duration || 0),
              views: String(parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {}).views || task.platform),
              tags: parseJsonRecord<string[]>(record.tags, []),
            });
            await persistManualVideoFailure({
              record,
              sourceUrl: task.sourceUrl,
              title: task.title,
              platform: task.platform,
            }, compactError, compactReason, fallback);
            failed += 1;
            continue;
          }
          const latest = await store.getById(COL, task.recordId);
          const latestAnalysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? record.aiAnalysis, {});
          await store.update(COL, task.recordId, {
            status: 'analyzed' as VideoStatus,
            aiAnalysis: JSON.stringify({
              ...latestAnalysis,
              downloadStatus: 'ops_queued',
              videoFetchStatus: canRetry ? 'ops_queued' : 'ops_failed',
              geminiStatus: 'waiting_for_video',
              crawlerOpsStatus: canRetry ? 'queued' : 'failed',
              crawlerOpsReason: compactReason,
              crawlerOpsLastError: compactError,
              crawlerOpsNextRetryAt: canRetry ? new Date(Date.now() + crawlerRetryDelayMs(attemptNo)).toISOString() : undefined,
            }),
          });
          retried += 1;
        }
      }
    } finally {
      runtimeCrawlerProxy = previousProxy;
      crawlerOpsWorkerActive = false;
    }
    return { ok: true, picked, resolved, retried, failed, skipped };
  }

  function crawlerOpsStats(tenantId?: string, visibleRecordIds?: Set<string>): Record<string, unknown> {
    const tasks = filterCrawlerOpsTasksForRecordIds(loadCrawlerOpsTasks(), visibleRecordIds);
    const byStatus = tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});
    const byPlatform = tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.platform] = (acc[task.platform] || 0) + 1;
      return acc;
    }, {});
    const apifyUsage = apifyVideoUsageToday(tenantId);
    return {
      total: tasks.length,
      byStatus,
      byPlatform,
      workerEnabled: process.env.CRAWLER_OPS_WORKER_ENABLED !== '0',
      workerActive: crawlerOpsWorkerActive,
      maxAttempts: Math.max(1, Number(process.env.CRAWLER_OPS_MAX_ATTEMPTS || 5)),
      proxyPoolSize: crawlerProxyPool().length,
      cookieFileCount: cookieFiles().length,
      cookieBrowserCount: cookieBrowsers().length,
      apifyVideoFallback: {
        enabled: process.env.APIFY_TIKTOK_VIDEO_FALLBACK_ENABLED !== '0' || process.env.APIFY_INSTAGRAM_VIDEO_FALLBACK_ENABLED !== '0',
        tiktokEnabled: process.env.APIFY_TIKTOK_VIDEO_FALLBACK_ENABLED !== '0',
        instagramEnabled: process.env.APIFY_INSTAGRAM_VIDEO_FALLBACK_ENABLED !== '0',
        usedToday: tenantId ? apifyUsage.tenant : apifyUsage.total,
        dailyLimit: apifyVideoDailyLimit(),
        ...(tenantId ? {} : { globalUsedToday: apifyUsage.total }),
        globalDailyLimit: apifyVideoDailyLimit(),
        tenantUsedToday: apifyUsage.tenant,
        tenantDailyLimit: apifyVideoTenantDailyLimit(),
        afterAttempts: Math.max(1, Number(process.env.APIFY_TIKTOK_VIDEO_AFTER_ATTEMPTS || 2)),
      },
    };
  }

  return { initPocketBaseVideoBackfill, proxyUrl, crawlerExecEnv, runQueuedLocalAnalysisWorkerOnce, initCrawlerOpsWorker, runCrawlerOpsWorkerOnce, crawlerOpsStats };
}
