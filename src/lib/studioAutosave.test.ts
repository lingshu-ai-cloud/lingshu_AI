import assert from 'node:assert/strict';
import test from 'node:test';
import { studioAutosaveFingerprint, studioDraftChanged } from './studioAutosave.js';

test('studio autosave ignores object key order and undefined fields', () => {
  const first = studioAutosaveFingerprint('project-1', ' 视频草稿 ', {
    script: 'hello',
    storyboard: { second: 2, first: 1, ignored: undefined },
  });
  const second = studioAutosaveFingerprint('project-1', '视频草稿', {
    storyboard: { first: 1, second: 2 },
    script: 'hello',
  });
  assert.equal(first, second);
  assert.equal(studioDraftChanged(first, second), false);
});

test('studio autosave detects content and project identity changes', () => {
  const original = studioAutosaveFingerprint('project-1', '视频草稿', { script: 'hello' });
  assert.equal(studioDraftChanged(original, studioAutosaveFingerprint('project-1', '视频草稿', { script: 'updated' })), true);
  assert.equal(studioDraftChanged(original, studioAutosaveFingerprint('project-2', '视频草稿', { script: 'hello' })), true);
});
