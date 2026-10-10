import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalEmployeeOverview, ContentQueueItem } from '../../lib/digitalEmployees';
import type { VideoCreationPlan } from '../../lib/videoCreationPlan';
import type { ConnectedSocialPerformance } from '../../lib/socialPerformance';
import { buildReviewAccounts, buildReviewContents, retainReviewPerformance, reviewMetric, reviewSum, reviewDateInRange } from './BusinessDataReview.model';

const plans = Array.from({ length: 18 }, (_, index) => ({
  contentId: `content-${Math.floor(index / 4)}`, platform: ['youtube', 'tiktok', 'instagram', 'facebook'][index % 4],
  matrix: { accountId: `account-${index % 4}` }, theme: `选题 ${index}`, productName: `产品 ${index % 3}`,
  plannedPublishDate: '2026-10-02', duration: 30, publication: { title: `标题 ${index}`, caption: `文案 ${index}`, tags: ['采购'] },
} as VideoCreationPlan));
function fixture(): DigitalEmployeeOverview {
  return {
    goal: { startsAt: '2026-09-27', endsAt: '2026-10-03', videoPlans: plans },
    config: { publishingTargets: Array.from({ length: 4 }, (_, index) => ({ accountId: `account-${index}`, accountLabel: `账号 ${index}`, platform: plans[index].platform })) },
    plan: null, contentQueue: { items: [] },
  } as unknown as DigitalEmployeeOverview;
}

test('all planned platform publications remain visible without runtime queue or metric samples', () => {
  const data = fixture();
  const rows = buildReviewContents(data);
  assert.equal(rows.length, 18);
  assert.equal(new Set(rows.map(row => row.id)).size, 18, 'shared content IDs across platform editions cannot collide');
  assert.ok(rows.every(row => row.status === 'planned' && row.settledCost === null));
  assert.ok(rows.every(row => row.executionItemId === ''), 'plan row keys cannot become execution detail identifiers');
  const accounts = buildReviewAccounts(data, null);
  assert.equal(accounts.length, 4);
  assert.equal(accounts.reduce((sum, account) => sum + account.planned, 0), 18);
  assert.ok(accounts.every(account => !account.connected && account.views === null), 'configuration targets are not connection evidence');
});

test('queue records bind by content, platform and account, preserving their detail ID', () => {
  const data = fixture();
  const queued = { id: 'queue-2', contentId: plans[1].contentId, platform: 'tiktok', accountId: 'account-1', accountLabel: 'TikTok', status: 'completed', settledCostCny: 0, estimatedCostCny: 10, taskId: 'task-2' } as ContentQueueItem;
  data.contentQueue!.items = [queued];
  const rows = buildReviewContents(data);
  assert.equal(rows.length, 18);
  assert.equal(rows.find(row => row.id === 'queue-2')?.status, 'completed');
  assert.equal(rows.find(row => row.id === 'queue-2')?.settledCost, 0);
  assert.equal(rows.find(row => row.id === 'queue-2')?.executionItemId, 'queue-2', 'detail navigation resolves the original execution item');
  assert.equal(rows.find(row => row.platform === 'youtube')?.status, 'planned');
  assert.ok(buildReviewContents(data, 'account-1').every(row => row.accountId === 'account-1'));
});

test('partial refresh retains the last confirmed account snapshot and its timestamp', () => {
  const previous: ConnectedSocialPerformance = { accounts: [], contents: [], unavailable: [], loadedAt: '2026-10-10T00:00:00Z' };
  const failed: ConnectedSocialPerformance = { accounts: [], contents: [], unavailable: [{ platform: 'youtube', reason: '同步失败' }], loadedAt: '2026-10-10T01:00:00Z' };
  assert.equal(retainReviewPerformance(previous, failed), previous);
  assert.equal(retainReviewPerformance(null, failed), failed, 'first load preserves available partial evidence');
  const next = { ...previous, loadedAt: '2026-10-10T02:00:00Z' };
  assert.equal(retainReviewPerformance(previous, next), next);
});

test('missing measurements do not become zero or invented engagement', () => {
  assert.equal(reviewMetric({ value: 4, status: 'pending', source: 'waiting' }), null);
  assert.equal(reviewMetric({ value: 0, status: 'available', source: 'platform' }), 0);
  assert.equal(reviewSum([null, undefined]), null);
  assert.equal(reviewSum([null, 0]), 0);
  assert.equal(reviewDateInRange('', '2026-09-27', '2026-10-03'), false);
  assert.equal(reviewDateInRange('2026-10-03T12:00:00Z', '2026-09-27', '2026-10-03'), true);
});
