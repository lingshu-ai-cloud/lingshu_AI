import assert from 'node:assert/strict';
import {
  acknowledgeDigitalHumanResult,
  digitalHumanResultRetryDelayMs,
  dueDigitalHumanResultOutbox,
  markDigitalHumanResultUploaded,
  normalizeDigitalHumanResultSha256,
  retryDigitalHumanResult,
  reviveDigitalHumanDeadLetter,
  type DigitalHumanResultOutboxRecord,
} from './digitalHumanResultTransfer.js';

const sha = 'A'.repeat(64);
assert.equal(normalizeDigitalHumanResultSha256(sha), sha.toLowerCase());
assert.equal(normalizeDigitalHumanResultSha256('not-a-sha'), undefined);
assert.equal(digitalHumanResultRetryDelayMs(1), 2_000);
assert.equal(digitalHumanResultRetryDelayMs(4), 16_000);
assert.equal(digitalHumanResultRetryDelayMs(30), 5 * 60_000);

const createdAt = '2026-09-02T00:00:00.000Z';
const record: DigitalHumanResultOutboxRecord = {
  id: 'delivery-1', remoteJobId: 'remote-1', localJobId: 'local-1', workerId: 'gpu-1', leaseId: 'lease-1',
  outputPath: 'result.mp4', sha256: sha.toLowerCase(), sizeBytes: 1_024, quality: { passed: true },
  phase: 'upload_pending', attempts: 0, nextAttemptAt: createdAt, createdAt, updatedAt: createdAt,
};
const uploaded = markDigitalHumanResultUploaded(record, Date.parse(createdAt) + 1_000);
assert.equal(uploaded.phase, 'finalize_pending');
assert.equal(uploaded.attempts, 0);
const retried = retryDigitalHumanResult(uploaded, new Error('offline'), Date.parse(createdAt) + 2_000);
assert.equal(retried.attempts, 1);
assert.equal(Date.parse(retried.nextAttemptAt), Date.parse(createdAt) + 4_000);
assert.equal(dueDigitalHumanResultOutbox([retried], Date.parse(createdAt) + 3_999).length, 0);
assert.deepEqual(dueDigitalHumanResultOutbox([retried], Date.parse(createdAt) + 4_000).map(item => item.id), ['delivery-1']);
const acked = acknowledgeDigitalHumanResult(retried, Date.parse(createdAt) + 5_000);
assert.equal(acked.phase, 'acked');
assert.ok(acked.acknowledgedAt);
assert.equal(dueDigitalHumanResultOutbox([acked], Date.parse(createdAt) + 10_000).length, 0);
const exhausted = retryDigitalHumanResult({ ...record, attempts: 1 }, new Error('offline'), Date.parse(createdAt), 1000, 1000, 2);
assert.equal(exhausted.phase, 'dead_letter');
const revived = reviveDigitalHumanDeadLetter(exhausted, Date.parse(createdAt) + 1, 1);
assert.equal(revived.phase, 'upload_pending');
assert.equal(revived.deadLetterRecoveries, 1);
assert.equal(reviveDigitalHumanDeadLetter({ ...revived, phase: 'dead_letter' }, Date.parse(createdAt) + 2, 1).phase, 'dead_letter');

console.log('digital human result transfer tests passed');
