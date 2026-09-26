import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFourPlatformRelease, RELEASE_PLATFORMS, type FourPlatformReleaseEvidence } from './four-platform-release-acceptance.js';

function evidence(environment: 'local' | 'pre_release' = 'pre_release'): FourPlatformReleaseEvidence {
  const lineage = { tenantId: 'tenant-a', artifactId: 'artifact-1', artifactVersion: 7, contentHash: 'sha256:abc', approvalId: 'approval-1' };
  return {
    schemaVersion: 1,
    environment,
    capturedAt: '2026-09-26T00:00:00.000Z',
    evidenceSource: {
      collector: environment === 'pre_release' ? 'live_pre_release_requests' : 'local_contract_fixture',
      pocketBaseRequestId: environment === 'pre_release' ? 'pb-request-1' : '',
      rawEvidenceSha256: environment === 'pre_release' ? `sha256:${'a'.repeat(64)}` : '',
      chromeSessionRecordIds: environment === 'pre_release'
        ? Object.fromEntries(RELEASE_PLATFORMS.map(platform => [platform, `chrome-${platform}-1`])) : {},
    },
    credentials: {
      pocketBaseAuthenticated: true,
      applicationSessionAuthenticated: true,
      platformSessions: Object.fromEntries(RELEASE_PLATFORMS.map(platform => [platform, true])),
      platformApiAuthorized: Object.fromEntries(RELEASE_PLATFORMS.map(platform => [platform, true])),
      publishTargetIds: Object.fromEntries(RELEASE_PLATFORMS.map(platform => [platform, `${platform}-target`])),
    },
    sourceArtifact: { ...lineage, kind: 'digital_human' },
    approval: { ...lineage, status: 'approved', approvedAt: '2026-09-26T00:00:00.000Z' },
    receipts: RELEASE_PLATFORMS.map(platform => ({
      ...lineage, platform, accountId: `${platform}-account`, state: 'published',
      providerReceiptId: `${platform}-receipt`, providerPostId: `${platform}-post`,
    })),
    isolationProbe: { foreignTenantId: 'tenant-b', readDenied: true, mutationDenied: true, leakedRecordIds: [] },
    revocationProbe: { approvalRevoked: true, publishRejected: true, providerNetworkCalls: 0 },
  };
}

test('pre-release evidence can pass consistency checks but cannot authorize launch', () => {
  const report = evaluateFourPlatformRelease(evidence());
  assert.equal(report.overall, 'passed');
  assert.equal(report.preReleaseEvidenceReady, true);
  assert.equal(report.releaseReady, false);
  assert.equal(report.launchDecision, 'requires_authorized_review');
});

test('missing credentials cannot be claimed as passed', () => {
  const input = evidence();
  input.credentials.platformSessions.youtube = false;
  const report = evaluateFourPlatformRelease(input);
  assert.equal(report.overall, 'blocked');
  assert.equal(report.releaseReady, false);
  assert.match(report.truthfulness, /不得对外宣称/);
});

test('unknown receipt is recoverable but remains blocked and never counts as published', () => {
  const input = evidence();
  input.receipts[0] = { ...input.receipts[0], state: 'unknown', providerReceiptId: undefined, providerPostId: undefined, queriedAt: '2026-09-26T00:05:00.000Z', resendSuppressed: true };
  const report = evaluateFourPlatformRelease(input);
  assert.equal(report.overall, 'blocked');
  assert.match(report.checks.find(item => item.key === 'receipt_tiktok')!.summary, /禁止盲目重发/);
});

test('tenant leakage and post-revocation provider calls fail the gate', () => {
  const input = evidence();
  input.isolationProbe.leakedRecordIds = ['foreign-post'];
  input.revocationProbe.providerNetworkCalls = 1;
  const report = evaluateFourPlatformRelease(input);
  assert.equal(report.overall, 'failed');
  assert.deepEqual(report.failures.map(item => item.split(':')[0]), ['tenant_isolation', 'permission_revocation']);
});

test('digital human uses the same exact approval lineage and local runs never become release ready', () => {
  const local = evidence('local');
  assert.equal(evaluateFourPlatformRelease(local).releaseReady, false);
  const mismatch = evidence();
  mismatch.approval.contentHash = 'sha256:changed';
  assert.equal(evaluateFourPlatformRelease(mismatch).overall, 'failed');
});

test('manually filled facts without live evidence provenance stay blocked', () => {
  const input = evidence();
  input.evidenceSource = { collector: 'local_contract_fixture', pocketBaseRequestId: '', rawEvidenceSha256: '', chromeSessionRecordIds: {} };
  const report = evaluateFourPlatformRelease(input);
  assert.equal(report.overall, 'blocked');
  assert.equal(report.preReleaseEvidenceReady, false);
});
