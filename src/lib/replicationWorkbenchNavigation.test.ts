import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenWorkbenchRenderSettings, workbenchExportBlockReason } from './replicationWorkbenchNavigation';

test('17-shot replication enters render settings while render admission remains separate', () => {
  assert.equal(canOpenWorkbenchRenderSettings({ shotCount: 17, replication: true, freeCreation: false, freeCreationReady: false }), true);
  assert.equal(canOpenWorkbenchRenderSettings({ shotCount: 0, replication: true, freeCreation: false, freeCreationReady: false }), false);
  assert.equal(canOpenWorkbenchRenderSettings({ shotCount: 17, replication: false, freeCreation: true, freeCreationReady: false }), false);
});
test('current replication output exports without human acceptance; missing or stale output cannot export', () => {
  assert.equal(workbenchExportBlockReason({ replication: true, currentOutputPath: '/current.mp4' }), '');
  assert.equal(workbenchExportBlockReason({ replication: true, currentOutputPath: null, reviewedPath: '/old.mp4', qualityRecordPath: '/old.mp4' }), '成片尚未生成');
});
test('free creation keeps its existing human acceptance and signed quality requirements', () => {
  assert.match(workbenchExportBlockReason({ replication: false, currentOutputPath: '/current.mp4' }), /检查并确认/);
  assert.match(workbenchExportBlockReason({ replication: false, currentOutputPath: '/current.mp4', reviewedPath: '/current.mp4', qualityRecordPath: '/old.mp4' }), /重新质检/);
  assert.equal(workbenchExportBlockReason({ replication: false, currentOutputPath: '/current.mp4', reviewedPath: '/current.mp4', qualityRecordPath: '/current.mp4' }), '');
});
