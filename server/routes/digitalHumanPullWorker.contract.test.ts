import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createWorkerLeaseId,
  workerJobClaimable,
  workerLeaseExpired,
  workerLeaseMatches,
  workerLeaseRecoveryAction,
} from '../lib/digitalHumanWorkerLease.js';

const studio = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../scripts/digital-human-local-worker.ts', import.meta.url), 'utf8');

assert.match(studio, /digital-human\/worker\/claim/);
assert.match(studio, /digital-human\/worker\/presence/);
assert.match(studio, /WORKER_PREFLIGHT_FAILED/);
assert.match(studio, /workerLeaseUntil/);
assert.match(studio, /workerLeaseId/);
assert.match(studio, /workerAttemptCount/);
assert.match(studio, /requireDigitalHumanWorker/);
assert.match(studio, /result-upload/);
assert.match(studio, /application\/octet-stream/);
assert.match(studio, /for await \(const raw of req\)/, '服务端必须流式读取 Worker 成片');
assert.match(studio, /DIGITAL_HUMAN_MAX_OUTPUT_BYTES/, '流式入口必须限制成片大小');
assert.match(studio, /createHash\('sha256'\)/, '流式入口必须边接收边计算 SHA256');
assert.match(studio, /uploadedResultSha256/);
assert.match(studio, /completedWorkerTransferMatches/, '重复 finalize 必须按 workerId + leaseId + SHA256 幂等确认');
assert.match(studio, /BASE64_RESULT_DISABLED/, '旧 Base64 完成回传必须明确拒绝');
assert.match(studio, /finalizeDigitalHumanFile\(job, uploadPath/, '完成接口必须从已校验的上传文件入库');
assert.match(studio, /pullWorkerEnabled/);
assert.match(studio, /digitalHumanWorkerPresence\.touch\(workerId\)/, '通过认证的 claim/心跳必须刷新 Worker 在线状态');
assert.match(studio, /digitalHumanWorkerPresence\.snapshot\(Date\.now\(\), digitalHumanWorkerOnlineTtlMs\(\), digitalHumanWorkerPreflightOptions\(\)\)/, '能力接口必须按心跳 TTL 及 P1 预检判定可用');
assert.match(studio, /config\.pullWorkerEnabled \? worker\?\.ready === true : Boolean\(config\.baseUrl\)/, '启用 Pull Worker 时必须通过资源与版本预检');
assert.doesNotMatch(studio, /worker:\s*\{[^}]*apiKey|worker:\s*\{[^}]*workerKey/s, '能力接口不得返回 Worker 密钥');
assert.ok((studio.match(/digitalHumanProviderPayloadForJob\(/g) || []).length >= 3, 'direct 和 pull 必须复用同一任务 payload 构建器');
assert.match(studio, /buildDigitalHumanProviderJobPayload\(\{ \.\.\.job, usagePurpose \}/, '任务 payload 必须统一构建，且旧任务也要显式降级为内部预览用途');
assert.match(studio, /validateDigitalHumanMediaFile\(sourcePath/, '服务端 finalize 必须独立检测上传成片');
assert.match(studio, /expectedSha256:\s*transfer\?\.sha256/, '服务端必须复算并对比上传 SHA256');
assert.match(studio, /commercial-v1\+server-media-v1/, '只有 Worker 与服务端双重门禁通过才能 completed');
assert.match(worker, /DIGITAL_HUMAN_HUB_URL/);
assert.match(worker, /DIGITAL_HUMAN_WORKER_KEY/);
assert.match(worker, /collectWorkerHealthReport/);
assert.match(worker, /nvidia-smi/);
assert.match(worker, /statfsSync/);
assert.match(worker, /reportHubPresence/);
assert.match(worker, /pollHub/);
assert.match(worker, /heartbeatHubJob/);
assert.match(worker, /DIGITAL_HUMAN_WORKER_HEARTBEAT_MS \|\| 30_000/);
assert.match(worker, /JSON\.stringify\(\{ workerId, leaseId/);
assert.doesNotMatch(worker, /dataBase64/, 'Worker 完成结果不得编码为 Base64 JSON');
assert.match(worker, /fs\.createReadStream\(record\.outputPath\)/, 'Worker 必须用文件流上传结果');
assert.match(worker, /'Content-Type': 'application\/octet-stream'/);
assert.match(worker, /'X-Worker-Id': record\.workerId/);
assert.match(worker, /'X-Worker-Lease-Id': record\.leaseId/);
assert.match(worker, /'X-Content-Sha256': record\.sha256/);
assert.match(worker, /result-outbox\.json/, 'Worker 必须持久化结果 outbox');
assert.match(worker, /flushResultOutbox/);
assert.match(worker, /recoverCompletedResultOutbox/, 'Worker 重启后必须重建遗漏的完成结果 outbox');
assert.match(worker, /transferHeartbeatTimer/, '长时间流式上传期间必须继续续租');
assert.match(worker, /retryDigitalHumanResult/, '网络失败必须进入指数退避补传');
assert.match(worker, /acknowledgeDigitalHumanResult/, '服务端确认后必须持久化 ack');
assert.match(worker, /status: 'completed',[\s\S]{0,160}sha256: current\.sha256/, 'finalize 只传 SHA256 和质量报告');
assert.match(worker, /vertical_composition/);
assert.match(worker, /const input: WorkerInput = \{[\s\S]+motionClips: remote\.motionClips[\s\S]+validatePerformanceInput\(input\)/, '领取远程任务后必须先构造并校验真实输入，禁止引用未定义变量');
assert.doesNotMatch(worker, /try \{\s*validatePerformanceInput\(input\);\s*const response = await hubFetch/, '领取任务前不存在 input，不能提前校验');
assert.match(studio, /motionClips: motionMaterials\.map/, '服务器必须把全部动作视频的受控 URL 下发给本地 Worker');
assert.match(worker, /renderPerformanceSequence/, '本地 Worker 必须真正执行多动作片段流水线');
assert.match(worker, /concat=n=\$\{segmentOutputs\.length\}/, '多动作结果必须在 Worker 中拼接为连续视频');
assert.match(studio, /digital-human\/worker\/jobs\/:id\/heartbeat/, '服务端必须提供独立心跳续租端点');
assert.match(studio, /cancelRequested/, '心跳必须可向 Worker 下发取消信号');
assert.match(studio, /workerLeaseId: undefined, workerLeaseUntil: undefined,[\s\S]{0,120}workerAttemptCount: 0, cancelRequested: false/, '重试时必须清理旧租约和尝试计数');
assert.doesNotMatch(studio, /item\.id === req\.params\.id && item\.workerId === workerId/, '不得只用 workerId 认证进度或结果');

const now = Date.now();
const leaseA = createWorkerLeaseId();
const leaseB = createWorkerLeaseId();
assert.notEqual(leaseA, leaseB, '每次 claim 都必须生成不同的不可预测租约 ID');
assert.match(leaseA, /^[0-9a-f-]{36}$/i);
assert.equal(workerJobClaimable({ status: 'queued', workerAttemptCount: 0 }, now, 3), true);
for (const status of ['submitting', 'processing', 'quality_check'] as const) {
  const expired = { status, workerLeaseUntil: new Date(now - 1).toISOString(), workerAttemptCount: 1 };
  assert.equal(workerLeaseExpired(expired, now), true, `${status} 租约超时必须可检测`);
  assert.equal(workerJobClaimable(expired, now, 3), true, `${status} 租约超时必须可重新领取`);
}
assert.equal(workerJobClaimable({ status: 'processing', workerLeaseUntil: new Date(now - 1).toISOString(), workerAttemptCount: 3 }, now, 3), false, '达到最大尝试数后不得再领取');
assert.equal(workerLeaseRecoveryAction({ status: 'processing', workerLeaseUntil: new Date(now - 1).toISOString(), workerAttemptCount: 1 }, now, 3), 'requeue');
assert.equal(workerLeaseRecoveryAction({ status: 'processing', workerLeaseUntil: new Date(now - 1).toISOString(), workerAttemptCount: 3 }, now, 3), 'fail');
assert.equal(workerLeaseMatches({ status: 'processing', workerId: 'gpu-1', workerLeaseId: leaseA, workerLeaseUntil: new Date(now + 60_000).toISOString() }, 'gpu-1', leaseA, now), true);
assert.equal(workerLeaseMatches({ status: 'processing', workerId: 'gpu-1', workerLeaseId: leaseA, workerLeaseUntil: new Date(now - 1).toISOString() }, 'gpu-1', leaseA, now), false, '已过期租约即使 ID 匹配也不得上报');
assert.equal(workerLeaseMatches({ status: 'processing', workerId: 'gpu-1', workerLeaseId: leaseA, workerLeaseUntil: new Date(now + 60_000).toISOString() }, 'gpu-1', leaseB, now), false, '同 workerId 的旧租约不得上报');

console.log('digital human pull-worker contract tests passed');
