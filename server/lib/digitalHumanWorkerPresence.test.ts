import assert from 'node:assert/strict';
import {
  DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA,
  DigitalHumanWorkerPresenceRegistry,
  assessDigitalHumanWorkerPreflight,
  digitalHumanWorkerIsOnline,
  parseDigitalHumanWorkerHealthReport,
} from './digitalHumanWorkerPresence.js';

const now = Date.parse('2026-09-02T10:00:00.000Z');
const mouthStabilizerAlgorithmVersion = 'mouth-roi-temporal-stabilizer-v1';
const mouthStabilizerScriptSha256 = 'a'.repeat(64);
assert.equal(digitalHumanWorkerIsOnline(now - 89_999, now, 90_000), true);
assert.equal(digitalHumanWorkerIsOnline(now - 90_001, now, 90_000), false);
assert.equal(digitalHumanWorkerIsOnline(undefined, now, 90_000), false);

const registry = new DigitalHumanWorkerPresenceRegistry();
const options = {
  expectedPipelineVersion: 'digital-human-v2-p1.4',
  expectedMouthStabilizerAlgorithmVersion: mouthStabilizerAlgorithmVersion,
  expectedMouthStabilizerScriptSha256: mouthStabilizerScriptSha256,
};
assert.equal(registry.snapshot(now, 90_000, options).ready, false);
registry.touch('heartbeat-only', now - 1000);
const heartbeatOnly = registry.snapshot(now, 90_000, options);
assert.equal(heartbeatOnly.online, true);
assert.equal(heartbeatOnly.ready, false, 'poll heartbeat without hardware/version evidence is not ready');

const healthy = parseDigitalHumanWorkerHealthReport({
  schemaVersion: DIGITAL_HUMAN_WORKER_PRESENCE_SCHEMA,
  pipelineVersion: 'digital-human-v2-p1.4',
  runnerConfigured: true,
  mouthStabilizerConfigured: true,
  mouthStabilizerAlgorithmVersion,
  mouthStabilizerScriptSha256,
  gpu: { available: true, name: 'RTX', totalVramMb: 8192, freeVramMb: 6100 },
  disk: { freeBytes: 20 * 1024 ** 3 },
  validatorConfigured: true,
  validatorVersion: 'final-quality-v2.4.0',
  gateVersion: 'performance-shot-gate-v1',
  reportedAt: new Date(now - 500).toISOString(),
});
assert.ok(healthy);
assert.equal(assessDigitalHumanWorkerPreflight(healthy!, options).ready, true);
registry.touch('gpu-ready', healthy, now - 500);
const ready = registry.snapshot(now, 90_000, options);
assert.equal(ready.online, true);
assert.equal(ready.ready, true);
assert.equal(ready.workerId, 'gpu-ready');
assert.equal(ready.preflight.freeVramMb, 6100);
assert.equal(ready.preflight.mouthStabilizerConfigured, true);
assert.equal(ready.preflight.observedMouthStabilizerAlgorithmVersion, mouthStabilizerAlgorithmVersion);
assert.equal(ready.preflight.observedMouthStabilizerScriptSha256, mouthStabilizerScriptSha256);

const wrongPipeline = { ...healthy!, pipelineVersion: 'digital-human-v2-p0' };
assert.equal(assessDigitalHumanWorkerPreflight(wrongPipeline, options).ready, false);
const lowVram = { ...healthy!, gpu: { ...healthy!.gpu, freeVramMb: 1000 } };
assert.equal(assessDigitalHumanWorkerPreflight(lowVram, options).ready, false);
assert.equal(parseDigitalHumanWorkerHealthReport({ ...healthy, gateVersion: '' }), null);
assert.equal(parseDigitalHumanWorkerHealthReport({ ...healthy, schemaVersion: 'digital-human-worker-presence-v1' }), null,
  '旧 presence schema 必须被拒绝');
for (const missingField of [
  'mouthStabilizerConfigured',
  'mouthStabilizerAlgorithmVersion',
  'mouthStabilizerScriptSha256',
] as const) {
  const missing = { ...healthy } as Record<string, unknown>;
  delete missing[missingField];
  assert.equal(parseDigitalHumanWorkerHealthReport(missing), null, `缺少 ${missingField} 必须 fail closed`);
}
assert.equal(parseDigitalHumanWorkerHealthReport({ ...healthy, mouthStabilizerScriptSha256: 'not-a-sha' }), null,
  '非法 mouth stabilizer SHA 必须在解析阶段拒绝');

const unconfiguredMouthStabilizer = { ...healthy!, mouthStabilizerConfigured: false };
const unconfiguredPreflight = assessDigitalHumanWorkerPreflight(unconfiguredMouthStabilizer, options);
assert.equal(unconfiguredPreflight.ready, false);
assert.match(unconfiguredPreflight.failures.join(' '), /未配置可执行的嘴部局部稳定器/);

const wrongMouthStabilizerVersion = { ...healthy!, mouthStabilizerAlgorithmVersion: 'mouth-roi-temporal-stabilizer-v0' };
const wrongVersionPreflight = assessDigitalHumanWorkerPreflight(wrongMouthStabilizerVersion, options);
assert.equal(wrongVersionPreflight.ready, false);
assert.match(wrongVersionPreflight.failures.join(' '), /算法版本不匹配.*v1.*v0/);

const wrongMouthStabilizerSha = { ...healthy!, mouthStabilizerScriptSha256: 'b'.repeat(64) };
const wrongShaPreflight = assessDigitalHumanWorkerPreflight(wrongMouthStabilizerSha, options);
assert.equal(wrongShaPreflight.ready, false);
assert.match(wrongShaPreflight.failures.join(' '), /脚本 SHA256 不匹配/);

const invalidServerExpectation = assessDigitalHumanWorkerPreflight(healthy!, {
  ...options,
  expectedMouthStabilizerScriptSha256: 'invalid',
});
assert.equal(invalidServerExpectation.ready, false);
assert.match(invalidServerExpectation.failures.join(' '), /服务端未配置有效.*SHA256/);
assert.equal(registry.snapshot(now + 90_001, 90_000, options).online, false);

console.log('digital human worker-presence tests passed');
