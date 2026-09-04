import assert from 'node:assert/strict';
import {
  buildYtDlpArgs,
  describeVideoAnalysisRecovery,
  filterCrawlerOpsTasksForRecordIds,
  platformReferer,
  recoverInterruptedCrawlerOpsTask,
  resetCrawlerOpsTaskForExplicitRetryState,
  selectPendingCrawlerOpsTasks,
  terminalizeExhaustedCrawlerOpsTask,
} from './videos.js';

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

console.log('video pipeline recovery tests passed');
