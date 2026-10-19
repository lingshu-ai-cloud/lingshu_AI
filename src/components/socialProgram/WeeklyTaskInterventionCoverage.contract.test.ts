import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const quickActions = readFileSync(new URL('./WeeklyTaskQuickActions.tsx', import.meta.url), 'utf8');

test('original weekly task details expose same-product footage without implying candidate approval', () => {
  assert.match(quickActions, /const productFootageRequired=items\.some/);
  assert.match(quickActions, /productFootageRequired&&<div id=\{`weekly-product-footage-/);
  assert.doesNotMatch(quickActions, /\n <WeeklyProductFootageIntervention scope=/);
  const footage = readFileSync(new URL('./WeeklyProductFootageIntervention.tsx', import.meta.url), 'utf8');
  assert.match(footage, /待独立核验/);
  assert.match(footage, /异品或通用片段不能替代同品实拍/);
  assert.match(footage, /合法计划修订/);
});

test('collection card does not advertise an unlimited crawl budget or unlock paid collection', () => {
  assert.match(quickActions, /采集与语义分析需分别取得明确人民币额度/);
  assert.match(quickActions, /费用上界未核验前不得付费采集/);
  assert.doesNotMatch(quickActions, /不设置采集金额上限/);
  const collection = readFileSync(new URL('./WeeklyCollectionCredentialIntervention.tsx', import.meta.url), 'utf8');
  assert.match(collection, /公开价格场景范围/);
  assert.match(collection, /Actor 实际价格尚未核验，因此不能给出单点预计/);
  assert.doesNotMatch(collection, /公开价格场景估算/);
  assert.match(quickActions, /const collectionStatusRequired=items\.some/);
  assert.match(quickActions, /collectionStatusRequired&&<div id=\{`weekly-collection-status-/);
  assert.doesNotMatch(quickActions, /\n <WeeklyCollectionCredentialIntervention scope=/);
});
