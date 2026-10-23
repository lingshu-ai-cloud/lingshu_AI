import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const studio = readAiStudioApplicationSources();

test('render acceptance is saved in the tenant-scoped Studio project and restored after refresh', () => {
  assert.match(studio, /renderAcceptance:\s*reviewedRenderPath/);
  assert.match(studio, /acceptedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(studio, /input\.saveDraft\(\{[\s\S]{0,700}renderAcceptance:/, 'the real delivery action must persist the acceptance override');
  assert.match(studio, /saveDraft: specOverrides => saveProject\('draft',[\s\S]{0,220}specOverrides/, 'the page draft bridge must delegate the same override to the canonical save');
  assert.match(studio, /deliveryWorkspace\.updateRenderAcceptance\(accepted, createDeliveryContext\(\)\)/, 'the page acceptance action must use the delivery workspace');
  assert.match(studio, /savedAcceptance[\s\S]*?setReviewedRenderPath/);
  assert.match(studio, /历史素材/);
});
