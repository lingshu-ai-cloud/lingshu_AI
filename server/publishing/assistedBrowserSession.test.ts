import assert from 'node:assert/strict';
import {
  AssistedBrowserSessionError,
  claimAssistedBrowserTask,
  confirmAssistedBrowserTask,
  createAssistedBrowserTask,
  markAssistedBrowserEvidencePending,
  pauseAssistedBrowserTask,
  requestAssistedBrowserFinalConfirmation,
} from './assistedBrowserSession.js';

const created = createAssistedBrowserTask({
  tenantId: 'tenant-a',
  packageId: 'spkg_1234567890abcdef12345678',
  packageHash: 'a'.repeat(64),
  contentHash: 'b'.repeat(64),
  channelId: 'douyin_cn',
  targetAccountId: 'douyin-account-a',
  requestedBy: 'user-a',
  callbackOrigin: 'http://127.0.0.1:43127',
  now: new Date('2026-09-19T00:00:00.000Z'),
});
assert.equal('tokenDigest' in created.session, false);
assert.equal(created.record.tokenDigest.length, 64);
assert.equal(JSON.stringify(created.record).includes(created.oneTimeToken), false);
assert.equal(created.session.callbackOrigin, 'http://127.0.0.1:43127');

assert.throws(
  () => createAssistedBrowserTask({
    tenantId: 'tenant-a', packageId: 'spkg_1234567890abcdef12345678',
    packageHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), channelId: 'douyin_cn',
    targetAccountId: 'account-a', requestedBy: 'user-a', callbackOrigin: 'http://0.0.0.0:43127',
  }),
  (error: unknown) => error instanceof AssistedBrowserSessionError && error.code === 'assisted_browser_loopback_required',
);
assert.throws(
  () => createAssistedBrowserTask({
    tenantId: 'tenant-a', packageId: 'spkg_1234567890abcdef12345678',
    packageHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), channelId: 'douyin_cn',
    targetAccountId: 'account-a', requestedBy: 'user-a', callbackOrigin: 'http://127.0.0.1:43127',
    cookie: 'should-never-upload',
  } as never),
  (error: unknown) => error instanceof AssistedBrowserSessionError && error.code === 'assisted_browser_secret_field_forbidden',
);

assert.throws(
  () => claimAssistedBrowserTask(created.record, 'wrong-token', new Date('2026-09-19T00:00:30.000Z')),
  (error: unknown) => error instanceof AssistedBrowserSessionError && error.code === 'assisted_browser_token_invalid',
);
const claimed = claimAssistedBrowserTask(created.record, created.oneTimeToken, new Date('2026-09-19T00:00:30.000Z'));
assert.equal(claimed.status, 'in_progress');
assert.throws(
  () => claimAssistedBrowserTask(claimed, created.oneTimeToken, new Date('2026-09-19T00:00:31.000Z')),
  (error: unknown) => error instanceof AssistedBrowserSessionError && error.code === 'assisted_browser_token_already_used',
);

const captchaStop = pauseAssistedBrowserTask(claimed, 'captcha_required');
assert.equal(captchaStop.status, 'paused_for_user');
assert.equal(captchaStop.pauseReason, 'captcha_required');
assert.notEqual(captchaStop.status, 'completed');

const awaiting = requestAssistedBrowserFinalConfirmation(claimed);
assert.equal(awaiting.status, 'awaiting_final_confirmation');
assert.throws(
  () => confirmAssistedBrowserTask({
    record: awaiting, confirmed: true, confirmedBy: 'user-a',
    packageHash: 'c'.repeat(64), contentHash: awaiting.contentHash,
  }),
  (error: unknown) => error instanceof AssistedBrowserSessionError && error.code === 'assisted_browser_frozen_version_mismatch',
);
const confirmed = confirmAssistedBrowserTask({
  record: awaiting,
  confirmed: true,
  confirmedBy: 'user-a',
  packageHash: awaiting.packageHash,
  contentHash: awaiting.contentHash,
  now: new Date('2026-09-19T00:02:00.000Z'),
});
assert.equal(confirmed.status, 'confirmation_received');
const evidencePending = markAssistedBrowserEvidencePending(confirmed);
assert.equal(evidencePending.status, 'evidence_pending');
assert.notEqual(evidencePending.status, 'completed', 'final user confirmation is not publication proof');

console.log('assistedBrowserSession tests passed');
