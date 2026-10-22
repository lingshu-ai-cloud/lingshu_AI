import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8');

test('the selected benchmark opens the current director detail rather than an unreachable legacy script panel', () => {
  assert.match(pageSource, /selectedVideo && \(\s*<DirectorVideoDetailPanel/);
  assert.match(pageSource, /onEnterWorkflow\?\.\(/);
  assert.doesNotMatch(pageSource, /function ScriptPanel\s*\(/);
  assert.doesNotMatch(pageSource, /seedanceVideo\(/);
});
