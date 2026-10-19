import assert from 'node:assert/strict';
import {
  activeAnalysisRequest,
  buildYtDlpArgs,
  canRepairStoredExactClassification,
  describeVideoAnalysisRecovery,
  exactAnalysisChunkRanges,
  exactAnalysisDuration,
  exactSourceClockDuration,
  filterCrawlerOpsTasksForRecordIds,
  platformReferer,
  recoverInterruptedCrawlerOpsTask,
  resetCrawlerOpsTaskForExplicitRetryState,
  selectPendingCrawlerOpsTasks,
  shouldResumeReferenceAnalysis,
  terminalizeExhaustedCrawlerOpsTask,
  queuedMaterialFailureRequiresSourceFallback,
  videoAnalysisRetryQueuePatch,
} from './videos.js';
import { analysisTimelineQualityError } from '../lib/videoAnalysisCodec.js';

const chineseSearch = 'ytsearch5:工业视觉 爆款';
assert.equal(platformReferer(chineseSearch), 'https://www.youtube.com/');
const args = buildYtDlpArgs(['--dump-json', '--flat-playlist'], chineseSearch, false);
const refererIndex = args.indexOf('--referer');
assert.ok(refererIndex >= 0);
assert.equal(args[refererIndex + 1], 'https://www.youtube.com/');
assert.equal(args.at(-1), chineseSearch, 'ytsearch 伪 URL 只能作为最后的输入参数');
assert.doesNotMatch(args[refererIndex + 1] || '', /[\u4e00-\u9fff]/, '中文检索词不能进入 --referer');
assert.ok(args.includes('--js-runtimes'), 'YouTube ytsearch 必须保留 EJS 运行时参数');
assert.equal(platformReferer('not a url'), '', '非 URL 不应伪造 referer');

const geminiMissing = describeVideoAnalysisRecovery({
  analysisSource: 'gemini-video',
  analysisError: 'GEMINI_API_KEY is not set',
  userVisible: false,
});
assert.equal(geminiMissing.code, 'gemini_missing');
assert.equal(geminiMissing.provider, 'Gemini');
assert.match(geminiMissing.recoveryAction, /GEMINI_API_KEY/);

const downloaderMissing = describeVideoAnalysisRecovery({
  analysisError: 'python3: No module named yt_dlp', userVisible: false,
});
assert.equal(downloaderMissing.code, 'downloader_missing');
assert.match(downloaderMissing.reason, /重复点击不会完成/);

const qwenTimeout = describeVideoAnalysisRecovery({
  analysisSource: 'qwen-frame-video',
  analysisError: 'video_analysis_hard_timeout',
  userVisible: false,
});
assert.equal(qwenTimeout.code, 'qwen_timeout');
assert.match(qwenTimeout.reason, /Qwen.*超时/);
assert.match(qwenTimeout.recoveryAction, /重新分析/);

const hidden = describeVideoAnalysisRecovery({ userVisible: false, geminiStatus: 'waiting_for_video' });
assert.equal(hidden.code, 'candidate_hidden');
assert.equal(hidden.hidden, true);
assert.match(hidden.reason, /暂未展示/);

assert.equal(activeAnalysisRequest({
  requestedAnalysisMode: 'exact', analysisQueueState: 'queued', geminiStatus: 'queued', analysisRunId: 'run-1',
}, 'exact'), true, 'a repeated exact-analysis click must reuse the durable queued run');
assert.equal(activeAnalysisRequest({
  requestedAnalysisMode: undefined, analysisQueueState: 'paused', geminiStatus: 'paused',
}), false, 'a paused analysis must be resumable instead of being deduplicated as active');

const cleanRetry = videoAnalysisRetryQueuePatch({
  geminiStatus: 'analysis_retryable', analysisQueueState: 'failed', analysisError: 'old failure',
  videoLevelFailureStatus: '后台分析中断，可重试或恢复', manualRequiredReason: 'old blocker',
  crawlerOpsAttempt: 5, crawlerOpsStatus: 'failed', analysisFailedAt: '2026-10-09T00:00:00.000Z',
}, {
  analysisMode: 'exact', analysisRunId: 'run-new', queueKind: 'source_url',
  queuedAt: '2026-10-14T01:00:00.000Z', userId: 'owner',
});
assert.equal(cleanRetry.analysisQueueState, 'queued');
assert.equal(cleanRetry.geminiStatus, 'waiting_for_video');
assert.equal(cleanRetry.videoLevelFailureStatus, undefined, 'a new run must not inherit terminal failure projection');
assert.equal(cleanRetry.manualRequiredReason, undefined);
assert.equal(cleanRetry.analysisError, undefined);
assert.equal(cleanRetry.crawlerOpsAttempt, 0, 'explicit retry restores the bounded source retry budget');
assert.equal(queuedMaterialFailureRequiresSourceFallback({ analysisError: 'queued_material_not_found' }), true);
assert.equal(queuedMaterialFailureRequiresSourceFallback({ analysisError: 'provider timeout' }), false);

const opsTasks = [
  { id: 'ops-a', recordId: 'video-a', tenantId: 'tenant-a', platform: 'youtube' as const, sourceUrl: 'https://youtube.com/watch?v=a', title: 'A', status: 'queued' as const, reason: 'retry', attempts: 1, createdAt: '', updatedAt: '' },
  { id: 'ops-b', recordId: 'video-b', tenantId: 'tenant-b', platform: 'tiktok' as const, sourceUrl: 'https://tiktok.com/@b/video/1', title: 'B', status: 'queued' as const, reason: 'retry', attempts: 1, createdAt: '', updatedAt: '' },
];
assert.deepEqual(
  filterCrawlerOpsTasksForRecordIds(opsTasks, new Set(['video-a'])).map(task => task.id),
  ['ops-a'],
  'a tenant-scoped ops queue must not expose another tenant task',
);
assert.deepEqual(
  filterCrawlerOpsTasksForRecordIds(opsTasks).map(task => task.id),
  ['ops-a', 'ops-b'],
  'the background worker must retain its explicit global mode when no tenant filter is supplied',
);

const interruptedAtLimit = {
  ...opsTasks[0]!,
  status: 'processing' as const,
  attempts: 5,
  updatedAt: '2026-09-04T01:00:00.000Z',
};
const recovered = recoverInterruptedCrawlerOpsTask(interruptedAtLimit, '2026-09-04T02:00:00.000Z');
assert.equal(recovered.status, 'queued');
assert.equal(recovered.attempts, 4, 'restart recovery must return the interrupted attempt instead of charging it twice');
assert.equal(recovered.reason, 'recovered_after_restart');
assert.equal(
  recoverInterruptedCrawlerOpsTask(recovered, '2026-09-04T02:01:00.000Z').attempts,
  4,
  'a second restart before pickup must not return another attempt',
);
const runOnceCandidates = selectPendingCrawlerOpsTasks([recovered, opsTasks[1]!], 5, new Set(['video-a']), Date.parse('2026-09-04T02:00:00.000Z'));
assert.deepEqual(runOnceCandidates.map(task => task.id), ['ops-a']);
assert.equal(runOnceCandidates[0]!.attempts + 1, 5, 'the recovered run-once attempt must consume the returned fifth slot exactly once');

const legacyRestartZombie = recoverInterruptedCrawlerOpsTask({
  ...interruptedAtLimit,
  status: 'queued',
  reason: 'recovered_after_restart',
}, '2026-09-04T02:00:00.000Z');
assert.equal(legacyRestartZombie.attempts, 4, 'a queued max-attempt task left by the old restart recovery must receive its one missing recovery slot');
assert.equal(legacyRestartZombie.recoveredAt, '2026-09-04T02:00:00.000Z');
assert.equal(
  recoverInterruptedCrawlerOpsTask(legacyRestartZombie, '2026-09-04T02:02:00.000Z').attempts,
  4,
  'the compatibility recovery marker must prevent repeated refunds',
);

const exhausted = terminalizeExhaustedCrawlerOpsTask({ ...opsTasks[1]!, attempts: 5 }, 5, '2026-09-04T02:00:00.000Z');
assert.equal(exhausted.status, 'failed');
assert.equal(exhausted.reason, 'max_attempts_exhausted');
assert.equal(selectPendingCrawlerOpsTasks([exhausted], 5).length, 0, 'terminal exhaustion must not remain a permanently queued task');

const explicitRetry = resetCrawlerOpsTaskForExplicitRetryState(exhausted, {
  tenantId: 'tenant-b',
  userId: 'user-b',
  usesSourceQueue: true,
  now: '2026-09-04T03:00:00.000Z',
});
assert.equal(explicitRetry.status, 'resolved', 'the old task must retire so it cannot race the explicit retry');
assert.equal(explicitRetry.attempts, 0);
assert.equal(explicitRetry.lastError, undefined);
assert.equal(explicitRetry.retryResetBy, 'user-b');

assert.equal(shouldResumeReferenceAnalysis({
  usage: 'reference_only',
  requestedAnalysisMode: undefined,
  geminiStatus: 'video_failed',
  analysisError: 'exact_analysis_stalled',
}), true, '重复上传必须恢复已停滞的本地精准分析');
assert.equal(shouldResumeReferenceAnalysis({
  usage: 'reference_only',
  requestedAnalysisMode: 'exact',
  geminiStatus: 'analyzing',
}), false, '重复上传不能并发启动第二次正在运行的精准分析');
assert.equal(shouldResumeReferenceAnalysis({
  analysisMode: 'exact',
  analysisQuality: 'video',
  gemini: { scriptDetails15s: [{ time: '0-5', visual: '产品开场', materialType: 'product', narrativeRole: 'hook', classificationEvidence: '画面可见产品开场' }] },
}), false, '已有完整精准证据时不得无谓重跑');
assert.equal(shouldResumeReferenceAnalysis({
  analysisMode: 'exact',
  analysisQuality: 'video',
  gemini: { scriptDetails15s: [{ time: '0-5', visual: '产品开场' }] },
}), true, '只有时间线但缺少生产分类的旧记录必须补全一次，不能伪装为可生产结果');
assert.equal(canRepairStoredExactClassification({ id: 'video-1', duration: 5, status: 'analyzed' }, {
  analysisMode: 'exact', analysisQuality: 'video', geminiStatus: 'analyzed',
  gemini: { theme: '产品演示', firstTenSeconds: { atmosphere: '明亮', audioVisual: '同步', camera: '固定', visuals: '产品' }, coarseStructure: [{ time: '0-5', description: '产品展示' }], scriptDetails15s: [
    { time: '0-2.5', visual: '产品开场', materialType: 'unknown', narrativeRole: 'unknown', classificationEvidence: '', analysisGranularity: 'scene_cut_estimated' },
    { time: '2.5-5', visual: '产品展示', materialType: 'product', narrativeRole: 'product_intro', classificationEvidence: '画面可见产品', analysisGranularity: 'scene_cut_estimated' },
  ] },
}), true, '已完成视觉分析但只缺生产分类时必须走文本修复，不能再次分析视频');
assert.equal(shouldResumeReferenceAnalysis({
  analysisMode: 'exact',
  analysisQuality: 'video',
  gemini: { scriptDetails15s: [
    { time: '0-4', visual: '开场' }, { time: '4-8', visual: '展示' },
    { time: '8-12', visual: '生产' }, { time: '12-16', visual: '质检' },
    { time: '16-20', visual: '收尾' }, { time: '20-24.1', visual: '账号页' },
  ] },
}, 22.1), true, '重复上传必须重跑越过真实片尾的历史精准分析');
assert.equal(exactAnalysisDuration(22.1, [0, 12, 21.1]), 22.1, '已知真实时长必须覆盖“末帧 + 3 秒”的估算值');
assert.equal(exactAnalysisDuration(0, [0, 6.5]), 9.5, '只有缺少真实时长时才允许按末帧估算');
assert.deepEqual(exactAnalysisChunkRanges(15), [
  { start: 0, end: 6 },
  { start: 6, end: 12 },
  { start: 12, end: 15 },
], '高密度 15 秒视频必须拆成六秒以内的小块，避免逐镜结构输出反复超时');
const sourceClockAnalysis = { sourceMediaClock: { schemaVersion: 1 as const, duration: 9.41, fps: 30, sourceSha256: 'a'.repeat(64), analysisRunId: 'run-1', measuredAt: '2026-10-11T00:00:00.000Z' } } as any;
assert.equal(exactSourceClockDuration(sourceClockAnalysis, 'run-1'), 9.41, '当前分析运行的源容器时钟必须保留小数秒');
assert.equal(exactSourceClockDuration(sourceClockAnalysis, 'stale-run'), undefined, '旧分析运行的源容器时钟不得覆盖当前记录');
assert.equal(exactSourceClockDuration({ ...sourceClockAnalysis, sourceMediaClock: { ...sourceClockAnalysis.sourceMediaClock, sourceSha256: 'invalid' } }, 'run-1'), undefined, '缺少源内容哈希的时钟证据不得写回');
assert.equal(analysisTimelineQualityError({
  scriptDetails15s: [
    { time: '0-4', visual: '开场' },
    { time: '4-8', visual: '展示' },
    { time: '8-12', visual: '生产' },
    { time: '12-16', visual: '质检' },
    { time: '16-20', visual: '收尾' },
    { time: '20-24.1', visual: '账号页' },
  ],
} as never, 22.1, 'exact'), 'timeline_exceeds_24.10s_of_22.10s', '精准分析门禁必须拒绝超过真实视频结尾的时间轴');

console.log('video pipeline recovery tests passed');
