import assert from 'node:assert/strict';
import test from 'node:test';
import { contentLibraryOutputOrder, projectOutputs } from './contentLibrary.js';

test('completed videos expose persisted pin state and pinned output stays first', () => {
  const pinned = projectOutputs({
    id: 'pinned', title: '置顶成片', status: 'ready_for_approval', updated_at: '2026-10-15T00:00:00.000Z',
    spec: { renderOutputPath: '/tenant/pinned.mp4', libraryPinned: true },
  })[0]!;
  const recent = projectOutputs({
    id: 'recent', title: '最新普通成片', status: 'ready_for_approval', updated_at: '2026-10-16T00:00:00.000Z',
    spec: { renderOutputPath: '/tenant/recent.mp4' },
  })[0]!;

  assert.equal(pinned.pinned, true);
  assert.deepEqual([recent, pinned].sort(contentLibraryOutputOrder).map(item => item.id), ['pinned:current', 'recent:current']);
});
