import assert from 'node:assert/strict';
import { scheduledExecutionState } from '../routes/schedulerTaskStore.js';
import { formatScheduledDiscoveryResult } from './scheduledResult.js';

const failed = formatScheduledDiscoveryResult({ run: {
  runId: 'run-failed', status: 'failed', stopReason: 'source_failed', error: 'TikTok keyword search returned no usable videos',
  modeStats: { momentum: { accepted: 0 } }, platformStats: { tiktok: { failed: 5 }, youtube: { failed: 2 } },
  failureDetails: [
    { mode: 'momentum', platform: 'tiktok', queryRef: 'face cleanser supplier', error: 'TikTok rejected query' },
    { mode: 'momentum', platform: 'youtube', queryRef: 'clay mask', error: 'YouTube quota exceeded' },
  ],
} });
assert.equal(scheduledExecutionState(failed), 'failed');
assert.match(failed, /发现采集受阻（tiktok、youtube）/);
assert.match(failed, /有效内容：0 条/);
assert.match(failed, /tiktok\/face cleanser supplier: TikTok rejected query/);
assert.match(failed, /youtube\/clay mask: YouTube quota exceeded/);

const empty = formatScheduledDiscoveryResult({ run: {
  runId: 'run-empty', status: 'stopped', stopReason: 'no_valid_results', modeStats: { momentum: { accepted: 0 } },
} });
assert.equal(scheduledExecutionState(empty), 'failed');
assert.match(empty, /没有通过质量门的可用内容/);

const partial = formatScheduledDiscoveryResult({ run: {
  runId: 'run-partial', status: 'partial', stopReason: 'completed', modeStats: { momentum: { accepted: 2 } }, platformStats: { instagram: { failed: 1 } },
} });
assert.equal(scheduledExecutionState(partial), 'partial');

const success = formatScheduledDiscoveryResult({ run: {
  runId: 'run-ok', status: 'succeeded', stopReason: 'completed', modeStats: { momentum: { accepted: 3 } },
} });
assert.equal(scheduledExecutionState(success), 'succeeded');
assert.match(success, /有效内容 3 条/);

const skipped = formatScheduledDiscoveryResult({ skipped: true, reason: 'no_discovery_mode_due' });
assert.equal(scheduledExecutionState(skipped), 'no_data');

console.log('scheduled discovery result tests passed');
