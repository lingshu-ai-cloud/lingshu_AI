import { projectVideoPipelineStats } from '../routes/videoPipelineStatsProjection.js';
import { metadataFallbackAnalysis } from '../routes/videoCrawlerMetadataFallback.js';
import { isPublicTestTenantVideo, isVisibleVideoPipelineRecord } from '../routes/videoRecordVisibility.js';
import { videoLevelSuccessPatch } from '../routes/videoAnalysisSuccessPatch.js';
import { classifyCrawlerFailure, recoverInterruptedCrawlerOpsTask, resetCrawlerOpsTaskForExplicitRetryState, selectPendingCrawlerOpsTasks, terminalizeExhaustedCrawlerOpsTask, type CrawlerOpsTask } from '../routes/videoCrawlerOpsTaskState.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { inferPlatformFromUrl, parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { COL, ANALYSIS_DIR, CRAWLER_OPS_FILE } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createCrawlerOpsApplication(deps: Pick<VideoApplicationPorts, 'activeAnalysisRecords' | 'durableAnalysisRecords' | 'isTestTenantId' | 'crawlerOpsStats' | 'isGeminiConfigured' | 'isQwenConfigured' | 'analyzeDownloadedVideoWithFallback' | 'persistExactShotEvidence' | 'cleanupTempVideo' | 'exactSourceClockDuration' | 'persistManualVideoFailure'>) {
  const activeAnalysisRecords = deps.activeAnalysisRecords;
  const durableAnalysisRecords = deps.durableAnalysisRecords;
  const isTestTenantId: VideoApplicationPorts['isTestTenantId'] = (...args) => deps.isTestTenantId(...args);
  const crawlerOpsStats: VideoApplicationPorts['crawlerOpsStats'] = (...args) => deps.crawlerOpsStats(...args);
  const isGeminiConfigured: VideoApplicationPorts['isGeminiConfigured'] = (...args) => deps.isGeminiConfigured(...args);
  const isQwenConfigured: VideoApplicationPorts['isQwenConfigured'] = (...args) => deps.isQwenConfigured(...args);
  const analyzeDownloadedVideoWithFallback: VideoApplicationPorts['analyzeDownloadedVideoWithFallback'] = (...args) => deps.analyzeDownloadedVideoWithFallback(...args);
  const persistExactShotEvidence: VideoApplicationPorts['persistExactShotEvidence'] = (...args) => deps.persistExactShotEvidence(...args);
  const cleanupTempVideo: VideoApplicationPorts['cleanupTempVideo'] = (...args) => deps.cleanupTempVideo(...args);
  const exactSourceClockDuration: VideoApplicationPorts['exactSourceClockDuration'] = (...args) => deps.exactSourceClockDuration(...args);
  const persistManualVideoFailure: VideoApplicationPorts['persistManualVideoFailure'] = (...args) => deps.persistManualVideoFailure(...args);

  function loadCrawlerOpsTasks(): CrawlerOpsTask[] {
    try {
      return JSON.parse(fs.readFileSync(CRAWLER_OPS_FILE, 'utf8')) as CrawlerOpsTask[];
    } catch {
      return [];
    }
  }

  async function crawlerOpsRecordIdsForTenant(tenantId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    let page = 1;
    for (;;) {
      const records = await store.list<Record<string, unknown>>(COL, {
        where: { tenantId },
        page,
        perPage: 500,
      });
      for (const record of records.items) {
        const id = String(record.id || '').trim();
        if (id) ids.add(id);
      }
      if (page >= records.totalPages || records.items.length < 500 || page >= 20) break;
      page += 1;
    }
    return ids;
  }

  function persistCrawlerOpsTasks(tasks: CrawlerOpsTask[]): void {
    fs.mkdirSync(path.dirname(CRAWLER_OPS_FILE), { recursive: true });
    fs.writeFileSync(CRAWLER_OPS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  }

  function updateCrawlerOpsTask(taskId: string, patch: Partial<CrawlerOpsTask>): CrawlerOpsTask | null {
    if (!taskId) return null;
    const tasks = loadCrawlerOpsTasks();
    let updated: CrawlerOpsTask | null = null;
    persistCrawlerOpsTasks(tasks.map(task => {
      if (task.id !== taskId) return task;
      updated = { ...task, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
      return updated;
    }));
    return updated;
  }

  function resetCrawlerOpsTaskForExplicitRetry(input: {
    recordId: string;
    tenantId: string;
    userId: string;
    usesSourceQueue: boolean;
    now?: string;
  }): CrawlerOpsTask | null {
    const tasks = loadCrawlerOpsTasks();
    let updated: CrawlerOpsTask | null = null;
    persistCrawlerOpsTasks(tasks.map(task => {
      if (task.recordId !== input.recordId) return task;
      if (task.tenantId && task.tenantId !== input.tenantId) return task;
      updated = resetCrawlerOpsTaskForExplicitRetryState(task, input);
      return updated;
    }));
    return updated;
  }

  function resolveCrawlerOpsTasksForRecord(recordId: string, reason: string): void {
    const now = new Date().toISOString();
    const tasks = loadCrawlerOpsTasks();
    let changed = false;
    const next = tasks.map(task => {
      if (task.recordId !== recordId || task.status === 'resolved') return task;
      changed = true;
      return { ...task, status: 'resolved' as const, reason, updatedAt: now };
    });
    if (changed) persistCrawlerOpsTasks(next);
  }

  function enqueueCrawlerOpsTask(input: {
    recordId: string;
    tenantId?: string;
    platform: Platform;
    sourceUrl: string;
    title: string;
    reason: string;
    forceQueue?: boolean;
  }): CrawlerOpsTask {
    const now = new Date().toISOString();
    const tasks = loadCrawlerOpsTasks();
    const existing = tasks.find(task =>
      task.recordId === input.recordId &&
      (!input.tenantId || !task.tenantId || task.tenantId === input.tenantId) &&
      task.sourceUrl === input.sourceUrl &&
      task.status !== 'resolved'
    );
    if (existing) {
      // A periodic recovery scan may see the same persisted record many times.
      // Merely rediscovering it is not another download attempt; attempts are
      // incremented only when the worker actually picks the task.
      const updated = {
        ...existing,
        tenantId: existing.tenantId || input.tenantId,
        ...(input.forceQueue ? { status: 'queued' as const } : {}),
        reason: input.reason,
        updatedAt: now,
      };
      persistCrawlerOpsTasks(tasks.map(task => task.id === existing.id ? updated : task));
      return updated;
    }
    const task: CrawlerOpsTask = {
      id: randomUUID(),
      recordId: input.recordId,
      tenantId: input.tenantId,
      platform: input.platform,
      sourceUrl: input.sourceUrl,
      title: input.title,
      status: 'queued',
      reason: input.reason,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    persistCrawlerOpsTasks([task, ...tasks].slice(0, 1000));
    return task;
  }

  function pendingCrawlerOpsTasks(maxAttempts: number, visibleRecordIds?: Set<string>): CrawlerOpsTask[] {
    return selectPendingCrawlerOpsTasks(loadCrawlerOpsTasks(), maxAttempts, visibleRecordIds);
  }

  async function enqueueOpsTasksFromRecords(recoverInterrupted = false, tenantId?: string, maxAttempts = Math.max(1, Number(process.env.CRAWLER_OPS_MAX_ATTEMPTS || 5))): Promise<void> {
    const maxScan = Math.max(50, Number(process.env.CRAWLER_OPS_SCAN_LIMIT || 300));
    const records: Record<string, unknown>[] = [];
    for (let page = 1; ; page += 1) {
      const result = await store.list<Record<string, unknown>>(COL, { where: tenantId ? { tenantId } : undefined, sort: '-crawledAt', page, perPage: maxScan });
      records.push(...result.items);
      if (page >= result.totalPages || !result.items.length) break;
    }
    const now = Date.now();
    for (const record of records) {
      if (activeAnalysisRecords.has(String(record.id || ''))
        || (!recoverInterrupted && durableAnalysisRecords.has(String(record.id || '')))) continue;
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      if (analysis.analysisQuality === 'video' && analysis.requestedAnalysisMode !== 'exact') continue;
      const downloadStatus = String(analysis.downloadStatus || '');
      const videoFetchStatus = String(analysis.videoFetchStatus || '');
      const shouldEnqueue = downloadStatus === 'ops_queued' || videoFetchStatus === 'ops_queued';
      const latestProgressAt = Math.max(
        Date.parse(String(analysis.geminiStartedAt || '')) || 0,
        Date.parse(String(analysis.downloadStartedAt || '')) || 0,
        Date.parse(String(analysis.analysisQueuedAt || '')) || 0,
        Date.parse(String(record.updated || '')) || 0,
      );
      // Queued work previously lived only in process memory. After a restart it
      // could remain waiting forever. Recover never-started jobs quickly, while
      // giving active downloads/Gemini calls a generous window to finish.
      const staleQueued = downloadStatus === 'queued'
        && latestProgressAt > 0
        && now - latestProgressAt >= Math.max(60_000, Number(process.env.CRAWLER_QUEUED_RECOVERY_MS || 2 * 60_000));
      const interruptedActive = recoverInterrupted && ['downloading', 'analyzing'].includes(downloadStatus);
      const staleActive = ['downloading', 'analyzing'].includes(downloadStatus)
        && latestProgressAt > 0
        && now - latestProgressAt >= Math.max(5 * 60_000, Number(process.env.CRAWLER_ACTIVE_RECOVERY_MS || 30 * 60_000));
      if (!shouldEnqueue && !staleQueued && !staleActive && !interruptedActive) continue;
      const recordId = String(record.id || '');
      const sourceUrl = String(record.sourceUrl || '').trim();
      if (!recordId || !/^https?:\/\//i.test(sourceUrl)) continue;
      const task = enqueueCrawlerOpsTask({
        recordId,
        tenantId: String(record.tenantId || '').trim() || tenantId,
        platform: (record.platform || inferPlatformFromUrl(sourceUrl)) as Platform,
        sourceUrl,
        title: String(record.title || 'social-video'),
        reason: String(analysis.downloadError || analysis.crawlerOpsReason || (interruptedActive ? 'recovered_after_restart' : staleQueued ? 'recovered_stale_queue' : staleActive ? 'recovered_stalled_analysis' : 'ops_queued')),
      });
      const legacyRecoveredZombie = interruptedActive
        && task.status === 'queued'
        && task.reason === 'recovered_after_restart'
        && !task.recoveredAt;
      if ((interruptedActive || staleActive) && (task.status === 'processing' || legacyRecoveredZombie)) {
        const recoveredAt = new Date().toISOString();
        const recovered = recoverInterruptedCrawlerOpsTask(task, recoveredAt);
        updateCrawlerOpsTask(task.id, recovered);
        await store.update(COL, recordId, {
          status: 'analyzed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            downloadStatus: 'ops_queued',
            videoFetchStatus: 'ops_queued',
            geminiStatus: 'waiting_for_video',
            crawlerOpsTaskId: task.id,
            crawlerOpsStatus: 'queued',
            crawlerOpsReason: interruptedActive ? 'recovered_after_restart' : 'recovered_stalled_attempt',
            crawlerOpsAttempt: recovered.attempts,
            crawlerOpsRecoveredAt: recoveredAt,
            crawlerOpsNextRetryAt: recoveredAt,
          }),
        });
        continue;
      }
      if (task.attempts >= maxAttempts && task.status !== 'resolved') {
        const exhaustedAt = new Date().toISOString();
        const exhausted = terminalizeExhaustedCrawlerOpsTask(task, maxAttempts, exhaustedAt);
        updateCrawlerOpsTask(task.id, exhausted);
        await store.update(COL, recordId, {
          status: 'analyzed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            requestedAnalysisMode: undefined,
            downloadStatus: 'manual_required',
            videoFetchStatus: 'ops_failed',
            geminiStatus: 'video_failed',
            crawlerOpsTaskId: task.id,
            crawlerOpsStatus: 'failed',
            crawlerOpsReason: 'max_attempts_exhausted',
            crawlerOpsLastError: exhausted.lastError,
            crawlerOpsNextRetryAt: undefined,
            analysisRetryable: true,
            videoLevelFailureStatus: '视频获取重试已达上限，可点击重新分析重置重试次数',
            analysisError: exhausted.lastError || 'crawler_ops_max_attempts_exhausted',
          }),
        });
      }
    }
  }

  async function getVideoPipelineStats(tenantId?: string): Promise<Record<string, unknown>> {
    const records: Record<string, unknown>[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 50) {
      const result = await store.list<Record<string, unknown>>(COL, {
        where: tenantId ? { tenantId } : undefined,
        page,
        perPage: 100,
        sort: '-crawledAt',
      });
      records.push(...result.items);
      totalPages = result.items.length >= 100 ? Math.max(result.totalPages || 0, page + 1) : page;
      if (result.items.length === 0) break;
      page += 1;
    }

    const visibleRecords = tenantId && await isTestTenantId(tenantId)
      ? records.filter(record => isPublicTestTenantVideo(record) || isVisibleVideoPipelineRecord(record))
      : records;
    const analysisQueueRecords = tenantId && await isTestTenantId(tenantId)
      ? records.filter(record => {
        if (isPublicTestTenantVideo(record) || isVisibleVideoPipelineRecord(record)) return true;
        const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
        return Boolean(analysis.requestedAnalysisMode || analysis.analysisPausedAt)
          || ['queued', 'analyzing', 'paused', 'waiting_for_video'].includes(String(analysis.geminiStatus || ''));
      })
      : records;
    return projectVideoPipelineStats({
      visibleRecords,
      analysisQueueRecords,
      opsStats: crawlerOpsStats(tenantId, new Set(visibleRecords.map(record => String(record.id || '')).filter(Boolean))),
      geminiConfigured: isGeminiConfigured(),
      qwenConfigured: isQwenConfigured(),
    });
  }

  async function pushCrawlerOpsTask(task: CrawlerOpsTask): Promise<void> {
    const endpoint = process.env.CRAWLER_CONTROL_URL?.trim();
    if (!endpoint) return;
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CRAWLER_CONTROL_TOKEN ? { Authorization: `Bearer ${process.env.CRAWLER_CONTROL_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        ...task,
        callback: `/api/overseas/videos/ops/${task.id}/resolve`,
        requestedCapability: 'browser-like public video fetch',
      }),
    });
    if (!r.ok) throw new Error(`Crawler control HTTP ${r.status}`);
    persistCrawlerOpsTasks(loadCrawlerOpsTasks().map(item =>
      item.id === task.id ? { ...item, status: 'pushed', updatedAt: new Date().toISOString() } : item
    ));
  }

  async function analyzeOpsVideo(task: CrawlerOpsTask, videoBase64: string, mimeType: string): Promise<void> {
    if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const tempExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('quicktime') ? 'mov' : 'mp4';
    let tempPath = path.join(ANALYSIS_DIR, `ops-${task.id}-${Date.now()}.${tempExt}`);
    try {
      fs.writeFileSync(tempPath, Buffer.from(videoBase64.replace(/^data:[^,]+,/, ''), 'base64'));
      const record = await store.getById(COL, task.recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(record?.aiAnalysis, {});
      const analysisMode = previous.requestedAnalysisMode === 'strategy' ? 'strategy' : 'exact';
      const videoAnalysis = await analyzeDownloadedVideoWithFallback({
        filePath: tempPath,
        mimeType,
        title: task.title,
        platform: task.platform,
        duration: Number(record?.duration || 0),
        sourceLabel: 'crawler-ops-video',
        videoId: task.recordId,
        tenantId: String(record?.tenantId || ''),
        analysisMode,
        analysisRunId: String(previous.analysisRunId || ''),
        videoObjectKey: String(previous.videoObjectKey || record?.videoFileId || ''),
      });
      if (analysisMode === 'exact') {
        videoAnalysis.analysis = await persistExactShotEvidence(task.recordId, tempPath, videoAnalysis.analysis);
      }
      cleanupTempVideo(tempPath);
      tempPath = '';
      const measuredDuration = exactSourceClockDuration(videoAnalysis.analysis, String(previous.analysisRunId || ''));
      await store.update(COL, task.recordId, {
        status: 'analyzed' as VideoStatus,
        ...(measuredDuration ? { duration: measuredDuration } : {}),
        aiAnalysis: JSON.stringify({
          ...previous,
          ...videoLevelSuccessPatch({
            analysis: videoAnalysis.analysis,
            source: videoAnalysis.source,
            videoFetchStatus: 'fetched',
            extra: {
              crawlerOpsTaskId: task.id,
              crawlerOpsStatus: 'resolved',
              analysisMode,
              requestedAnalysisMode: undefined,
            },
          }),
        }),
      });
    } catch (e) {
      if (tempPath) cleanupTempVideo(tempPath);
      const record = await store.getById(COL, task.recordId);
      const fallback = metadataFallbackAnalysis({
        platform: task.platform,
        title: task.title,
        duration: Number(record?.duration || 0),
        views: String(parseJsonRecord<Record<string, unknown>>(record?.aiAnalysis, {}).views || task.platform),
        tags: parseJsonRecord<string[]>(record?.tags, []),
      });
      if (record) {
        await persistManualVideoFailure({
          record,
          sourceUrl: task.sourceUrl,
          title: task.title,
          platform: task.platform,
        }, e instanceof Error ? e.message : 'Crawler ops video analysis failed', classifyCrawlerFailure(e instanceof Error ? e.message : String(e)), fallback);
      }
      throw e;
    }
  }

  return { loadCrawlerOpsTasks, crawlerOpsRecordIdsForTenant, persistCrawlerOpsTasks, updateCrawlerOpsTask, resetCrawlerOpsTaskForExplicitRetry, resolveCrawlerOpsTasksForRecord, enqueueCrawlerOpsTask, pendingCrawlerOpsTasks, enqueueOpsTasksFromRecords, getVideoPipelineStats, pushCrawlerOpsTask, analyzeOpsVideo };
}
