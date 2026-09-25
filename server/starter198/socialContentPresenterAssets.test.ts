import assert from 'node:assert/strict';
import test from 'node:test';
import { readAuthorizedPresenterAssetIds } from './socialContentRecords.js';

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
});

test('Content Agent fails closed when presenter inventory cannot be read', async () => {
  const repository: any = { dataStore: { list: async () => { throw new Error('down'); } } };
  await assert.rejects(readAuthorizedPresenterAssetIds(repository, 'tenant-a'), /social_content_presenter_assets_unavailable/);
});
