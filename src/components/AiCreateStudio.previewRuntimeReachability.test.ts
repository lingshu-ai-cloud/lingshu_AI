import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');

test('the formal video workbench is the sole mounted preview playback path', () => {
  assert.doesNotMatch(source, /\bstartPreview\b|\bpreviewIdx\b|\bpreviewTimeline\b/, 'orphaned storyboard playback must not run effects or prefetch media');
  assert.match(source, /step === 'preview' && workbenchFormalPreviewUrl/);
  assert.match(source, /<video[\s\S]{0,200}key=\{workbenchFormalPreviewUrl\}[\s\S]{0,100}src=\{workbenchFormalPreviewUrl\}/);
  assert.match(source, /const downloadMp4 = async[\s\S]*?selectedRenderableOutput\?\.status === 'done'/);
});
