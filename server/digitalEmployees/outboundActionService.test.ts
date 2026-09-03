import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildOutboundActionProposal, outboundAuthorizationFailure, proposalIntegrityHash } from './outboundActionService.js';
import type { ExecutionContract } from './executionContract.js';

const contract: ExecutionContract = {
  schemaVersion: 1, goalVersion: 1, compiledAt: '2026-09-01T00:00:00.000Z', payloadHash: 'contract-hash', readiness: 'ready',
  intent: { outcome: 'Generate qualified demand', priority: 'high', focusProducts: ['Widget'], audience: 'buyers', market: 'US' },
  measurement: { metric: 'views', definition: 'period increment', baseline: 0, target: 100, unit: 'views', window: { startsAt: '2026-09-01', endsAt: '2026-09-07' }, source: 'social_metric_snapshots', missing: false },
  facts: [], resources: { productCount: 1, connectedAccounts: [{ id: 'account-1', platform: 'tiktok' }], historicalPosts: 1, metricSnapshots: 2, studioAvailable: true },
  dataGovernance: { aiAccessEnabled: true, sourceVersion: 'v1' },
  policy: { autonomyMode: 'managed', aiAccessEnabled: true, realPublishRequiresApproval: true, approvalOwner: 'owner-1', budgetLimit: 100, constraints: [], stopConditions: [] },
  budgetAllocation: [], qualityGates: [], completionCriteria: [], assumptions: [], gaps: [], sourceFingerprint: 'source-hash',
};

function draftInput(project: Record<string, unknown>, platform = 'tiktok') {
  const draftSnapshot = {
    platform, language: 'en', hook: 'Review the Widget facts.', audience: 'buyers',
    cta: 'Request the verified specification sheet.', title: 'Widget overview',
    caption: 'Widget documented facts.', hashtags: ['#Widget'], voiceover: ['Review the Widget facts.'], storyboard: [],
    evidenceRefs: ['products'], claimBindings: [{ claim: 'Widget', evidenceRef: 'products', evidenceQuote: 'Widget' }],
  };
  return {
    studioProject: project,
    script: { id: 'script-1' },
    draftSummary: { platform, language: 'en', hook: draftSnapshot.hook },
    draftSnapshot,
    artifactPayloadHash: createHash('sha256').update(JSON.stringify(draftSnapshot)).digest('hex'),
  };
}

const priorFlag = process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED;
process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED = 'true';
const proposal = buildOutboundActionProposal({
  tenantId: 'tenant-1', runId: 'run-1', taskId: 'task-1', goalTitle: 'Goal', contract,
  draft: draftInput({ id: 'project-1', version: 2, videoPath: '/video.mp4', videoSha256: 'a'.repeat(64), deepLink: '/studio?project=project-1' }),
  now: new Date('2026-09-02T00:00:00.000Z'),
});
assert.equal(proposal.mode, 'dry_run', 'TikTok must hand off for current creator capabilities and express user choices');
assert.match(proposal.nextStep, /TikTok 创作者权限/);
assert.equal(proposal.payloadHash, proposalIntegrityHash(proposal));
assert.notEqual(proposalIntegrityHash({ ...proposal, scheduledAt: '2026-09-06T00:00:00.000Z' }), proposal.payloadHash);
assert.notEqual(proposalIntegrityHash({ ...proposal, targetAccount: { ...proposal.targetAccount, id: 'account-2' } }), proposal.payloadHash);
assert.notEqual(proposalIntegrityHash({ ...proposal, schedulePayload: { ...proposal.schedulePayload, description: 'tampered' } }), proposal.payloadHash);
assert.notEqual(proposalIntegrityHash({ ...proposal, artifact: { ...proposal.artifact, videoSha256: 'b'.repeat(64) } }), proposal.payloadHash);
assert.equal(proposal.schedulePayload.title, 'Widget overview');
assert.equal(proposal.schedulePayload.description, 'Widget documented facts.\n\n#Widget\n\nRequest the verified specification sheet.');
assert.equal(proposal.contentPayloadHash, createHash('sha256').update(JSON.stringify(proposal.contentSnapshot)).digest('hex'));

const approval = {
  id: 'approval-1', tenant_id: 'tenant-1', run_id: 'run-1', task_id: 'task-1', status: 'approved',
  approved_payload_hash: proposal.payloadHash, action_version: proposal.version, action_payload: proposal,
  decided_by: 'admin-1', revision: 5,
};
const run = { id: 'run-1', tenant_id: 'tenant-1', status: 'running', budget_limit: 100, budget_spent: 0, revision: 7 };
const task = { id: 'task-1', tenant_id: 'tenant-1', run_id: 'run-1', status: 'running', revision: 4 };
const authorizationInput = {
  tenantId: 'tenant-1', runId: 'run-1', taskId: 'task-1', approvalId: 'approval-1', proposal,
  approvedPayloadHash: proposal.payloadHash, approval, run, task, now: Date.parse('2026-09-02T00:01:00.000Z'),
  expectedApprovalRevision: 5, expectedRunRevision: 7, expectedTaskRevision: 4,
};
assert.equal(outboundAuthorizationFailure(authorizationInput), null);
assert.equal(outboundAuthorizationFailure({ ...authorizationInput, run: { ...run, status: 'paused' } }), 'run_not_executable');
assert.equal(outboundAuthorizationFailure({ ...authorizationInput, approval: { ...approval, revision: 6 } }), 'approval_revision_changed');
assert.equal(outboundAuthorizationFailure({ ...authorizationInput, task: { ...task, status: 'cancelled' } }), 'task_not_executable');
const invalidExpiryProposal = { ...proposal, expiresAt: 'not-a-date', payloadHash: '' };
invalidExpiryProposal.payloadHash = proposalIntegrityHash(invalidExpiryProposal);
assert.equal(outboundAuthorizationFailure({
  ...authorizationInput,
  proposal: invalidExpiryProposal,
  approvedPayloadHash: invalidExpiryProposal.payloadHash,
  approval: { ...approval, approved_payload_hash: invalidExpiryProposal.payloadHash, action_payload: invalidExpiryProposal },
}), 'approved_action_expired');

const suggestProposal = buildOutboundActionProposal({
  tenantId: 'tenant-1', runId: 'run-2', taskId: 'task-2', goalTitle: 'Goal',
  contract: { ...contract, policy: { ...contract.policy, autonomyMode: 'suggest' } },
  draft: draftInput({ id: 'project-2', version: 1, videoPath: '/video.mp4', videoSha256: 'a'.repeat(64) }),
  now: new Date('2026-09-02T00:00:00.000Z'),
});
assert.equal(suggestProposal.mode, 'dry_run', 'suggest mode must never compile a real outbound action');

const remoteOnlyProposal = buildOutboundActionProposal({
  tenantId: 'tenant-1', runId: 'run-3', taskId: 'task-3', goalTitle: 'Goal', contract,
  draft: draftInput({ id: 'project-3', version: 1, videoUrl: 'https://cdn.example/video.mp4', videoSha256: 'a'.repeat(64) }),
  now: new Date('2026-09-02T00:00:00.000Z'),
});
assert.equal(remoteOnlyProposal.mode, 'dry_run', 'a mutable remote URL must not be treated as digest-bound publish media');

const mismatchedPlatformProposal = buildOutboundActionProposal({
  tenantId: 'tenant-1', runId: 'run-4', taskId: 'task-4', goalTitle: 'Goal', contract,
  draft: draftInput({ id: 'project-4', version: 1, videoPath: '/video.mp4', videoSha256: 'a'.repeat(64) }, 'youtube'),
  now: new Date('2026-09-02T00:00:00.000Z'),
});
assert.equal(mismatchedPlatformProposal.mode, 'dry_run', 'content must never be silently sent to an account on a different platform');
assert.equal(mismatchedPlatformProposal.targetAccount.id, '');
assert.deepEqual(mismatchedPlatformProposal.schedulePayload.targetAccountIds, []);

const exactYoutubeContract = {
  ...contract,
  resources: { ...contract.resources, connectedAccounts: [
    { id: 'account-tiktok', platform: 'tiktok' },
    { id: 'account-youtube', platform: 'youtube' },
  ] },
};
const exactYoutubeProposal = buildOutboundActionProposal({
  tenantId: 'tenant-1', runId: 'run-5', taskId: 'task-5', goalTitle: 'Goal', contract: exactYoutubeContract,
  draft: draftInput({ id: 'project-5', version: 1, videoPath: '/video.mp4', videoSha256: 'a'.repeat(64) }, 'youtube'),
  now: new Date('2026-09-02T00:00:00.000Z'),
});
assert.equal(exactYoutubeProposal.mode, 'real');
assert.equal(exactYoutubeProposal.targetAccount.id, 'account-youtube', 'proposal must select the account matching the approved content platform');
if (priorFlag === undefined) delete process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED;
else process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED = priorFlag;

console.log('outbound action proposal integrity tests passed');
