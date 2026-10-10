import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentRenderOutput } from './studioRenderVersion';

test('a selected version accepts only its own rendered output', () => {
  const selected = { inputSignature: 'script-a:zh:music-a' };
  const matching = { inputSignature: selected.inputSignature, path: '/a.mp4' };
  const otherLanguage = { inputSignature: 'script-a:en:music-a', path: '/en.mp4' };
  const editedScript = { inputSignature: 'script-b:zh:music-a', path: '/old.mp4' };
  assert.equal(currentRenderOutput(selected, matching), matching);
  assert.equal(currentRenderOutput(selected, otherLanguage), undefined);
  assert.equal(currentRenderOutput(selected, editedScript), undefined);
  assert.equal(currentRenderOutput(selected, { inputSignature: undefined, path: '/legacy.mp4' }), undefined);
  assert.equal(currentRenderOutput(undefined, matching), undefined);
});
