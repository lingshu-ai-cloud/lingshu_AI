import assert from 'node:assert/strict';
import type { SocialDiscoveryBrief, SocialInspirationCollectionRun } from '../../shared/contracts/socialContentWorkflow.js';
import { buildDiscoverySummary, dueDiscoveryModes, nextDiscoveryRunAt, normalizeModePolicies, validateDiscoveryBrief } from './domain.js';

const policies = normalizeModePolicies({
  momentum: { resultLimit: 17, refreshIntervalMinutes: 120, sourceRefs: ['connector', 'connector'] },
  account: { resultLimit: 6, sourceRefs: ['https://facebook.com/acme'] },
  innovation: { enabled: false, resultLimit: 3, sourceRefs: ['proof-order'] },
}, ['momentum', 'account'], 30, ['tiktok', 'facebook']);

assert.equal(policies.momentum?.resultLimit, 17);
assert.deepEqual(policies.momentum?.sourceRefs, ['connector']);
assert.equal(policies.account?.resultLimit, 6);
assert.equal(policies.innovation?.enabled, false);
assert.deepEqual(policies.momentum?.platforms, ['tiktok', 'facebook']);
assert.notEqual(policies.momentum?.resultLimit, policies.account?.resultLimit, '三类供给不能被固定比例覆盖');

const brief: SocialDiscoveryBrief = {
  discoveryBriefId: 'brief-1', keywordSetId: 'set-1', keywordSetVersion: 3, productRef: 'connector', market: 'DE', audience: 'brand_buyer',
  discoverySeedIds: ['seed-1'], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['account'],
  platforms: ['facebook'], lookbackDays: 7, resultLimit: 30, budgetLimitCny: null, productionGap: null,
  createdBy: 'director_agent' as const, modePolicies: { account: { enabled: true, sourceRefs: [], platforms: ['facebook'], resultLimit: 5, refreshIntervalMinutes: 60, budgetLimitCny: null } },
};
assert.deepEqual(validateDiscoveryBrief(brief), ['account: 请先确认至少一个对标账号']);

const run: SocialInspirationCollectionRun = {
  runId: 'run-1', planId: 'brief-1', keywordSetId: 'set-1', keywordSetVersion: 3, status: 'succeeded', triggerType: 'scheduled', scopeSnapshot: brief,
  modeStats: {
    momentum: { requested: 10, fetched: 8, deduplicated: 2, accepted: 6, momentumCandidates: 2, failed: 0, costCny: 1.2, effectiveRate: 0.75 },
    account: { requested: 4, fetched: 4, deduplicated: 1, accepted: 3, momentumCandidates: 1, failed: 0, costCny: null, effectiveRate: 0.75 },
  },
  discoveryScopeId: 'scope-1', discoveryScopeVersion: 3, sourceRunRefs: ['apify-run'], queryBasis: {}, market: 'DE', language: 'en', stopReason: 'completed', startedAt: '2026-09-26T01:00:00.000Z', finishedAt: '2026-09-26T01:05:00.000Z', error: null,
};
const summary = buildDiscoverySummary({ keywordSetId: 'set-1', keywordSetVersion: 3, runs: [run], pendingBusinessConfirmations: 2 });
assert.equal(summary.totals.accepted, 9);
assert.equal(summary.byMode.momentum?.costCny, 1.2);
assert.equal(summary.byMode.account?.costCny, null, '未知成本不能被伪造为 0');
assert.equal(summary.accountDecisionsPendingBusinessConfirmation, 2);
assert.equal(summary.byMode.momentum?.effectiveRate, 0.75);
assert.deepEqual(summary.coverageGaps, ['innovation']);
assert.equal(summary.costComplete, false);
assert.deepEqual(dueDiscoveryModes({ ...brief, discoveryModes: ['account'], competitorAccounts: ['https://facebook.com/acme'] }, [run], new Date('2026-09-26T02:04:59.000Z')), []);
assert.deepEqual(dueDiscoveryModes({ ...brief, discoveryModes: ['account'], competitorAccounts: ['https://facebook.com/acme'] }, [run], new Date('2026-09-26T02:05:00.000Z')), ['account']);
assert.equal(nextDiscoveryRunAt({ ...brief, discoveryModes: ['account'] }, [run]), '2026-09-26T02:05:00.000Z');

console.log('social discovery domain tests passed');
