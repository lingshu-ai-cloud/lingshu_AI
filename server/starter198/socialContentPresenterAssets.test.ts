import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSocialTaskBrief, readAuthorizedPresenterAssetIds, readAuthorizedPresenterInventory } from './socialContentRecords.js';
import { defaultBrief } from './socialContentTaskSupport.js';

test('Content Agent reads only authorized usable tenant presenter assets', async () => {
  const repository: any = { dataStore: { list: async (_collection: string, query: any) => {
    assert.deepEqual(query.where, { tenant_id: 'tenant-a' });
    return { totalItems: 1, totalPages: 1, page: 1, perPage: 2, items: [{ tenant_id: 'tenant-a', payload: { presenters: [
      { id: 'talker', authorized: true, avatarId: 'avatar', voiceId: 'voice' },
      { id: 'reference', authorized: true, avatarId: '', voiceId: '', toolMappings: { runway: { referenceMaterialIds: ['portrait'] } } },
      { id: 'unauthorized', authorized: false, avatarId: 'a', voiceId: 'v' },
      { id: 'empty', authorized: true, avatarId: '', voiceId: '' },
    ] } }] };
  } } };
  assert.deepEqual(await readAuthorizedPresenterAssetIds(repository, 'tenant-a'), ['talker', 'reference']);
  assert.deepEqual((await readAuthorizedPresenterInventory(repository, 'tenant-a', null, 'talker')).assetIds, ['talker']);
});

test('Content Agent fails closed when presenter inventory cannot be read', async () => {
  const repository: any = { dataStore: { list: async () => { throw new Error('down'); } } };
  await assert.rejects(readAuthorizedPresenterAssetIds(repository, 'tenant-a'), /social_content_presenter_assets_unavailable/);
});

test('Content Agent pins exactly one published presenter identity to a social account', async () => {
  const repository: any = { dataStore: { list: async () => ({ totalItems: 1, items: [{ payload: { presenters: [{
    id: 'account-presenter', authorized: true, avatarId: 'avatar-v3', voiceId: 'voice-v3',
    socialAccountId: 'account-tiktok', presenterProfileId: 'profile-host', presenterProfileVersion: '3',
    presenterProfileStatus: 'published', commercialRightsStatus: 'cleared',
    consistencyKey: 'account-tiktok:profile-host:3', rightsEvidence: { authorizationRef: 'auth-3', consentRef: 'consent-3',
      subjectAdultConfirmed: true, permittedUses: ['digital_presenter'] },
  }, {
    id: 'other-account-presenter', authorized: true, avatarId: 'avatar-other', voiceId: 'voice-other',
    socialAccountId: 'account-other', presenterProfileId: 'profile-other', presenterProfileVersion: '1',
    presenterProfileStatus: 'published', commercialRightsStatus: 'cleared',
    consistencyKey: 'account-other:profile-other:1', rightsEvidence: { authorizationRef: 'auth-other', consentRef: 'consent-other',
      subjectAdultConfirmed: true, permittedUses: ['digital_presenter'] },
  }] } }] }) } };
  const inventory = await readAuthorizedPresenterInventory(repository, 'tenant-a', 'account-tiktok');
  assert.deepEqual(inventory.assetIds, ['account-presenter']);
  assert.equal(inventory.accountPresenterLock?.consistencyKey, 'account-tiktok:profile-host:3');
  assert.equal(inventory.accountPresenterLock?.avatarId, 'avatar-v3');
});

test('Content Agent rejects multiple published identities for one social account', async () => {
  const profile = { authorized: true, avatarId: 'avatar', voiceId: 'voice', socialAccountId: 'account-tiktok',
    presenterProfileId: 'profile', presenterProfileVersion: '1', presenterProfileStatus: 'published',
    commercialRightsStatus: 'cleared', consistencyKey: 'account-tiktok:profile:1', rightsEvidence: { authorizationRef: 'auth', consentRef: 'consent',
      subjectAdultConfirmed: true, permittedUses: ['digital_presenter'] } };
  const repository: any = { dataStore: { list: async () => ({ totalItems: 1, items: [{ payload: { presenters: [
    { ...profile, id: 'presenter-a' }, { ...profile, id: 'presenter-b' },
  ] } }] }) } };
  await assert.rejects(readAuthorizedPresenterInventory(repository, 'tenant-a', 'account-tiktok'), /social_content_presenter_assets_unavailable/);
});

test('task persistence retains the account lineage needed for presenter locking', () => {
  const stored = defaultBrief({
    title: '账号视频', objective: '获取询盘',
    presenterAssetId: 'account-presenter',
    programRef: { objectType: 'social_program', id: 'program-1', version: '2' },
    targetAccountRef: { objectType: 'social_owned_account', id: 'account-tiktok', version: '4' },
    accountPlaybookRef: { objectType: 'account_playbook', id: 'playbook-1', version: '5', accountRef: 'account-tiktok' },
    referenceMode: 'single_source_fidelity', primaryExperimentVariable: '前三秒钩子',
  });
  const parsed = parseSocialTaskBrief(stored);
  assert.equal(parsed.targetAccountRef?.id, 'account-tiktok');
  assert.equal(parsed.accountPlaybookRef?.accountRef, 'account-tiktok');
  assert.equal(parsed.referenceMode, 'single_source_fidelity');
  assert.equal(parsed.presenterAssetId, 'account-presenter');
});
