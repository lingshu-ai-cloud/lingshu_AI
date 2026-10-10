import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RunwayPersonReplacementPanel.tsx', import.meta.url), 'utf8');

test('shows honest maturity and limitation information for person replacement modes', () => {
  assert.match(source, /当前可用性/);
  assert.match(source, /option\.maturityLabel/);
  assert.match(source, /contract\.suitableFor/);
  assert.match(source, /contract\.limitations/);
});

test('does not expose an unimplemented preview action as usable', () => {
  assert.match(source, /<button type="button" disabled className=/);
  assert.match(source, /预览生成尚未接入/);
  assert.doesNotMatch(source, /选择企业人物并生成 2–3 秒预览/);
});
