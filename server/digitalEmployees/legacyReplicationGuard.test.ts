import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyReplicationBlocker, LEGACY_REPLICATION_BRIDGE_BLOCKER } from './legacyReplicationGuard.js';

test('legacy clone blocks before generic script, material matching, voice and render', () => {
  for (const stage of ['script', 'material_match', 'voice_subtitles', 'render']) {
    assert.equal(legacyReplicationBlocker({ route: 'clone', stage }), LEGACY_REPLICATION_BRIDGE_BLOCKER);
  }
});
test('ordinary material and product editing retain their production paths', () => {
  for (const route of ['material', 'product']) for (const stage of ['script', 'material_match', 'voice_subtitles', 'render']) {
    assert.equal(legacyReplicationBlocker({ route, stage }), '');
  }
});
test('workbench labels and old supplier IDs cannot bypass legacy rendering admission', () => {
  assert.equal(legacyReplicationBlocker({ route: 'clone', stage: 'material_match', creationPath: 'viral_replication' }), LEGACY_REPLICATION_BRIDGE_BLOCKER);
  assert.equal(legacyReplicationBlocker({ route: 'clone', stage: 'voice_subtitles', heygenJobId: 'existing-provider-job' }), LEGACY_REPLICATION_BRIDGE_BLOCKER);
  assert.equal(legacyReplicationBlocker({ route: 'clone', stage: 'render', heygenJobId: '  ' }), LEGACY_REPLICATION_BRIDGE_BLOCKER);
  assert.equal(legacyReplicationBlocker({ route: 'clone', stage: 'render', creationPath: 'viral_replication', heygenJobId: 'existing-provider-job' }), LEGACY_REPLICATION_BRIDGE_BLOCKER);
  assert.equal(legacyReplicationBlocker({ route: 'clone', stage: 'heygen', heygenJobId: 'existing-provider-job' }), '');
  assert.equal(legacyReplicationBlocker({ route: 'clone', stage: 'heygen' }), LEGACY_REPLICATION_BRIDGE_BLOCKER);
  for (const stage of ['quality', 'completed']) assert.equal(legacyReplicationBlocker({ route: 'clone', stage }), '');
});
