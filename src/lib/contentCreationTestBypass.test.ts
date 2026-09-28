import assert from 'node:assert/strict';
import test from 'node:test';
import { contentCreationDemoMaterialIds } from './contentCreationTestBypass.js';

test('local content demo selects the newest raw owned uploads only', () => {
  const ids = contentCreationDemoMaterialIds([
    { id: 'upload-1', name: '飞书20260928-172517', type: 'video', url: '/one.mp4', scope: 'own' },
    { id: 'upload-2', name: '飞书20260928-172522', type: 'video', url: '/two.mp4', scope: 'own' },
    { id: 'upload-3', name: '飞书20260928-172528', type: 'video', url: '/three.mp4', scope: 'own' },
    { id: 'presenter', name: '飞书（数字人·分镜2）', type: 'video', url: '/avatar.mp4', scope: 'own' },
    { id: 'shared', name: '公共素材', type: 'video', url: '/shared.mp4', scope: 'shared' },
    { id: 'reference', name: '参考片', type: 'video', url: '/ref.mp4', usage: 'reference_only' },
  ]);
  assert.deepEqual(ids, ['upload-1', 'upload-2', 'upload-3']);
});
