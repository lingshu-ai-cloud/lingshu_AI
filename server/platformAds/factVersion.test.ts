import assert from 'node:assert/strict';
import {
  comparePlatformAdProposalFactVersion,
  platformAdProposalFactIssue,
  platformAdProposalFactState,
  samePlatformAdEnterpriseFactVersion,
} from './factVersion.js';

const current = { id: 'enterprise-facts-v7', revision: 7, contentHash: 'hash-v7' };

assert.equal(comparePlatformAdProposalFactVersion({ proposal: null }, current).status, 'not_applicable');
assert.equal(comparePlatformAdProposalFactVersion({ proposal: {} }, current).status, 'missing');
assert.equal(comparePlatformAdProposalFactVersion({ proposal: { enterpriseFactVersion: 'enterprise-facts-v6' } }, current).status, 'stale');
assert.equal(comparePlatformAdProposalFactVersion({ proposal: { enterpriseFactVersion: current.id } }, current).status, 'current');
assert.match(platformAdProposalFactIssue(comparePlatformAdProposalFactVersion({ proposal: {} }, current)), /缺少企业事实版本/);
assert.equal(samePlatformAdEnterpriseFactVersion(current, { ...current }), true);
assert.equal(samePlatformAdEnterpriseFactVersion(current, { ...current, contentHash: 'changed' }), false);

let reads = 0;
const state = await platformAdProposalFactState('tenant-a', { proposal: { enterpriseFactVersion: current.id } }, async tenantId => {
  reads += 1;
  assert.equal(tenantId, 'tenant-a');
  return { version: current, profile: {} as never, context: '' };
});
assert.equal(state.status, 'current');
assert.equal(reads, 1);
await platformAdProposalFactState('tenant-a', { proposal: null }, async () => {
  throw new Error('manual tasks must not load enterprise facts');
});

console.log('platform ad enterprise fact-version tests passed');
