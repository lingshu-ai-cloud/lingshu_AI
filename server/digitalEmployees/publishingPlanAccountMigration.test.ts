import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateLegacyPublishingPlanAccountBindings, packageGrantWasInvalidatedAfterApproval } from './publishingPlanAccountMigration.js';

const legacyPlan = () => ({
  packageApprovedBy: 'owner',
  packageApprovedAt: '2026-10-13T10:00:00.000Z',
  managedPublishingGrantId: 'grant',
  configSnapshot: { publishingTargets: [
    { platform: 'tiktok', accountId: 'local-tiktok-tenant', accountLabel: 'Demo', weeklyCount: 1 },
    { platform: 'facebook', accountId: 'local-facebook-tenant', accountLabel: 'Demo', weeklyCount: 1 },
    { platform: 'instagram', accountId: 'local-instagram-tenant', accountLabel: 'Demo', weeklyCount: 0 },
  ] },
  businessPackage: {
    revision: 2,
    matrixPlan: [
      { platform: 'tiktok', accountId: 'local-tiktok-tenant', weeklyCount: 1, connected: true },
      { platform: 'facebook', accountId: 'local-facebook-tenant', weeklyCount: 1, connected: true },
    ],
    authorization: { mode: 'bounded', accountIds: ['local-tiktok-tenant', 'local-facebook-tenant', 'local-instagram-tenant'], maxPublishItems: 2 },
    operatingContext: {
      accounts: [{ platform: 'tiktok', accountId: 'local-tiktok-tenant', accountLabel: 'Demo' }],
      authorization: { accountIds: ['local-tiktok-tenant', 'local-facebook-tenant', 'local-instagram-tenant'] },
    },
    tasks: [{ templateId: 'production', videoPlans: [{
      platform: 'tiktok', matrix: { accountId: 'local-tiktok-tenant' },
      planningEvidence: { matrixAccountId: 'local-tiktok-tenant' },
      deliveryVariants: [{ accountId: 'local-tiktok-tenant', accountLabel: 'Demo' }],
    }] }],
  },
});

const connected = [
  { platform: 'tiktok' as const, accountId: 'real-tiktok', accountLabel: 'TikTok Shop', status: 'connected' as const },
  { platform: 'facebook' as const, accountId: 'real-facebook', accountLabel: 'Facebook Page', status: 'connected' as const },
];

test('migrates a complete one-to-one legacy account binding and invalidates only the automatic grant', () => {
  const source = legacyPlan();
  const result = migrateLegacyPublishingPlanAccountBindings(source, connected, '2026-10-14T00:00:00.000Z');
  assert.equal(result.changed, true);
  assert.equal(source.businessPackage.matrixPlan[0]!.accountId, 'local-tiktok-tenant', 'the frozen source is not mutated');
  assert.deepEqual(result.plan.businessPackage.authorization.accountIds, ['real-tiktok', 'real-facebook']);
  assert.equal(result.plan.businessPackage.matrixPlan[0].accountId, 'real-tiktok');
  assert.equal(result.plan.businessPackage.tasks[0].videoPlans[0].matrix.accountId, 'real-tiktok');
  assert.equal(result.plan.businessPackage.tasks[0].videoPlans[0].planningEvidence.matrixAccountId, 'real-tiktok');
  assert.equal(result.plan.businessPackage.tasks[0].videoPlans[0].deliveryVariants[0].accountId, 'real-tiktok');
  assert.equal(result.plan.configSnapshot.publishingTargets[2].accountId, 'local-instagram-tenant', 'inactive settings stay outside this run');
  assert.equal(result.plan.packageApprovedBy, 'owner', 'provenance remains available for the immutable approval package');
  assert.equal(result.plan.managedPublishingGrantId, '', 'a recurring grant is never transferred to another account');
  assert.equal(result.plan.businessPackage.revision, 3);
  assert.equal(packageGrantWasInvalidatedAfterApproval(result.plan), true);
});

test('refuses partial, missing, or ambiguous account matching', () => {
  assert.equal(migrateLegacyPublishingPlanAccountBindings(legacyPlan(), connected.slice(0, 1)).changed, false);
  assert.equal(migrateLegacyPublishingPlanAccountBindings(legacyPlan(), [...connected, {
    platform: 'tiktok' as const, accountId: 'real-tiktok-2', accountLabel: 'Other TikTok', status: 'connected' as const,
  }]).changed, false);
  const nonLegacy = legacyPlan();
  nonLegacy.businessPackage.matrixPlan.forEach((row, index) => { row.accountId = connected[index]!.accountId; });
  nonLegacy.configSnapshot.publishingTargets[0]!.accountId = 'real-tiktok';
  nonLegacy.configSnapshot.publishingTargets[1]!.accountId = 'real-facebook';
  assert.equal(migrateLegacyPublishingPlanAccountBindings(nonLegacy, connected).changed, false);
});
