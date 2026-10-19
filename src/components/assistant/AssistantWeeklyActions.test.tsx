import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import AssistantWeeklyActions, { standaloneContentNavigation, weeklyActionsForPage, weeklyCapacityLimitLabel } from './AssistantWeeklyActions';

test('only the three approved closed loops are exposed on relevant pages', () => {
  assert.deepEqual(weeklyActionsForPage('digitalEmployees'), ['create', 'revise', 'publish']);
  assert.deepEqual(weeklyActionsForPage('smartAssets'), ['create', 'revise']);
  assert.deepEqual(weeklyActionsForPage('traffic'), ['publish']);
  assert.deepEqual(weeklyActionsForPage('orders'), []);
  assert.deepEqual(weeklyActionsForPage('scheduled'), []);
});
test('capacity restrictions use readable Chinese and never expose unknown internal fields', () => {
  assert.equal(weeklyCapacityLimitLabel('budget'), '可用预算不足');
  assert.equal(weeklyCapacityLimitLabel('internal_provider_quota_key'), '存在容量限制，请查看周任务说明');
});
test('idle action disclosure does not create a task, request, or crowd the first screen', () => {
  const html = renderToStaticMarkup(<AssistantWeeklyActions page="smartAssets" scopeKey="tenant:user" disabled={false} onReceipt={() => { throw new Error('must not fire'); }} />);
  assert.match(html, /执行任务/); assert.doesNotMatch(html, /确认提交周任务/);
});
test('task panel can collapse without clearing intake; confirmation details start folded', () => {
  const source = fs.readFileSync(new URL('./AssistantWeeklyActions.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label="收起执行任务"/);
  assert.match(source, /onClick=\{\(\) => setExpanded\(false\)\}/);
  assert.match(source, /<details[^>]*><summary[^>]*>查看任务详情<\/summary>/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.doesNotMatch(source, /新增任务使用独立的额外费用上限|新增排期会暂停本周尚未执行的发布授权|纳入周任务后，按实际资料/);
  assert.doesNotMatch(source, /我已知晓新增排期需重新确认原发布授权/);
});
test('standalone content creation does not require a weekly package and preserves the intake', () => {
  const detail = standaloneContentNavigation({ requestId: 17, product: { id: 'product-1', name: '云朵面霜' }, goal: '突出舒缓与保湿', platform: 'tiktok' });
  assert.equal(detail.page, 'smartAssets');
  assert.equal(detail.contentCreationRequest.creationPath, 'material_processing');
  assert.equal(detail.contentCreationRequest.prefill.productId, 'product-1');
  assert.deepEqual(detail.contentCreationRequest.prefill.platforms, ['tiktok']);
  assert.equal(detail.contentCreationRequest.specialRequirements, '突出舒缓与保湿');
  const source = fs.readFileSync(new URL('./AssistantWeeklyActions.tsx', import.meta.url), 'utf8');
  assert.match(source, /不加入周任务包（自由任务）/);
  assert.match(source, /standaloneCreate \|\| Boolean\(selectedPackage\)/);
  assert.doesNotMatch(source, /当前账号尚未建立可执行周任务包/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| context\.packages\.length === 0\}/);
});
test('intake stays explicit, verifies products and does not delegate free chat to mutations', () => {
  const source = fs.readFileSync(new URL('./AssistantWeeklyActions.tsx', import.meta.url), 'utf8');
  assert.match(source, /selectableProducts\.map/);
  assert.match(source, /selectedPackage\.allowedProductIds\.includes/);
  assert.match(source, /item\.packageIds\.includes\(selectedPackage\.packageId\)/);
  assert.match(source, /'package', 'product', 'goal', 'account', 'deadline', 'confirm'/);
  assert.match(source, /expectedArtifactVersion: target\.expectedArtifactVersion/);
  assert.match(source, /setRequestId\(crypto\.randomUUID\(\)\)/);
  assert.match(source, /locked\.current/);
  assert.match(source, /不会跳过审批直接发送/);
  assert.doesNotMatch(source, /assistant\/actions|source: 'natural_language'/);
  assert.match(source, /!budgetText\.trim\(\)/);
  assert.match(source, /confirmCapacity\(createInput, capacityProposal, budget/);
  assert.match(source, /scheduleInput\(input/);
  assert.match(source, /previewSchedule\(createInput, scheduleInput\.capacity/);
  assert.match(source, /!scheduleProposal\.plan\.fullGraphConditionallyReachable/);
  assert.match(source, /action === 'create' && !legacyCreate/);
  assert.match(source, /maximumAdditionalCostCny: Number\(legacyBudgetText\), confirmAdditionalBudget: true, publishMode: 'draft_only'/);
  assert.match(source, /weeklyActionScopeTokens\(selectedPackage\)/);
  assert.match(source, /weeklyActionScopeTokens\(target\)/);
  assert.match(source, /target\?\.model !== 'legacy' \? \['target', 'note', 'confirm'\]/);
  assert.match(source, /account\.status === 'connected' && account\.platform === target\?\.platform/);
  assert.match(source, /confirmPublishingIntent: true/);
  assert.match(source, /确认账号与发布时间/);
  assert.doesNotMatch(source, /if \(legacyCreate && !legacyGrantAcknowledged\)/);
  assert.doesNotMatch(source, /我已知晓新增排期需重新确认原发布授权/);
});
