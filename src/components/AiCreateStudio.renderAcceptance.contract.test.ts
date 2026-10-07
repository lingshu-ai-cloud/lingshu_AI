import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const studio = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');

test('render acceptance is saved in the tenant-scoped Studio project and restored after refresh', () => {
  assert.match(studio, /renderAcceptance:\s*reviewedRenderPath/);
  assert.match(studio, /acceptedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(studio, /saveProject\('draft',[\s\S]*?specOverrides:[\s\S]*?renderAcceptance/);
  assert.match(studio, /savedAcceptance[\s\S]*?setReviewedRenderPath/);
  assert.match(studio, /历史素材/);
});

