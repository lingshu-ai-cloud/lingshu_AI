import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const previewSource = source.slice(source.indexOf('function PreproductionVideo'), source.indexOf('type QueuePerformance'));

test('system-planned storyboard steps are presented as a production route, not missing material', () => {
  assert.match(source, /step\.status === "system_planned"/);
  assert.match(source, /systemPlanned\s*\?\s*"系统选路"/,
    'an empty system-planned preview must not say that user material is missing');
  assert.match(source, /systemPlanned[\s\S]*"系统生产计划"/);
  assert.match(source, /systemPlanned && step\.supplyRoute[\s\S]*路线：\{step\.supplyRoute\}/,
    'the selected system route stays visible');
  assert.match(source, /systemPlanned && step\.supplyNote[\s\S]*\{step\.supplyNote\}/,
    'the service-owned production note stays visible');
});

test('pre-production media and typography use the shared visual primitives', () => {
  assert.match(previewSource, /LsMediaStateFrame/);
  assert.match(previewSource, /LsProgressiveMedia/);
  assert.doesNotMatch(previewSource, /text-\[(?:7|8|9|10)px\]/,
    'pre-production business information must use at least the 12px body-small token');
});

test('material readiness uses one conservative status and cannot show a false pass', () => {
  assert.match(previewSource, /const blocked = materials\.status !== "ready" \|\| !preview\.readiness\.canStart \|\| hasUnresolvedMaterial/);
  assert.match(previewSource, /\{blocked\?<div role="alert"[\s\S]*:<p[^>]*>素材、授权和预算检查已通过/,
    'the pass copy must be the exclusive alternative to the blocked state');
  assert.match(previewSource, /blocked\?"任务不能开始":"制作输入已锁定"/);
});

test('product preparation navigation carries all resolvable context', () => {
  assert.match(source, /page: "enterprise", view: "products", productName: item\.productName, materialIds:[\s\S]*contentItemId: item\.id/);
  assert.match(source, /打开产品资料与素材入口/,
    'the action must describe the stable entry instead of promising a fake material deep-link');
});

test('account-scoped review delegates to the shared business data review', () => {
  assert.match(source, /if \(view === "review"\) return <BusinessDataReview data=\{data\} selectedAccountId=\{selectedAccountId\}/,
    'account filtering and content review must stay in the shared review workspace');
});
