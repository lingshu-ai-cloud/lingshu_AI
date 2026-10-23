import assert from 'node:assert/strict';
import test from 'node:test';
import { materialSignedUrlTtlSeconds, visibleBgmTracks, withRecommendedBgmNames, type BgmTrack } from './studioBgmCatalog.js';

const track = (id: string, values: Partial<BgmTrack> = {}): BgmTrack => ({
  id, name: id, mood: 'calm', duration: 20, file: `${id}.mp3`, url: `/bgm/${id}.mp3`,
  createdAt: '2026-10-20T00:00:00Z', ...values,
});

test('BGM library keeps legacy shared records but excludes another tenant upload', () => {
  const list = [
    track('official', { builtin: true, scope: 'shared' }),
    track('legacy'),
    track('own', { tenantId: 'tenant-a', scope: 'tenant' }),
    track('other', { tenantId: 'tenant-b', scope: 'tenant' }),
  ];
  assert.deepEqual(visibleBgmTracks(list, 'tenant-a').map(item => item.id), ['official', 'legacy', 'own']);
  assert.equal(list.length, 4, 'the projection must not mutate the stored catalog');
});

test('BGM presentation preserves recommendation order and scope labels', () => {
  const list = [track('own', { tenantId: 'tenant-a', scope: 'tenant' }), track('recommended', { recommended: true })];
  const presented = withRecommendedBgmNames(list);
  assert.deepEqual(presented.map(item => item.id), ['recommended', 'own']);
  assert.deepEqual(presented.map(item => item.name), ['灵枢推荐配乐01', '灵枢推荐配乐02']);
  assert.equal(presented[0]?.scope, 'shared');
  assert.equal(presented[1]?.uploadedBy, '客户上传');
  assert.equal(list[0]?.name, 'own');
});

test('signed material URL lifetime remains bounded', () => {
  const before = process.env.MATERIAL_SIGNED_URL_TTL_SECONDS;
  try {
    process.env.MATERIAL_SIGNED_URL_TTL_SECONDS = '10';
    assert.equal(materialSignedUrlTtlSeconds(), 60);
    process.env.MATERIAL_SIGNED_URL_TTL_SECONDS = '9000';
    assert.equal(materialSignedUrlTtlSeconds(), 3600);
    process.env.MATERIAL_SIGNED_URL_TTL_SECONDS = 'not-a-number';
    assert.equal(materialSignedUrlTtlSeconds(), 900);
  } finally {
    if (before === undefined) delete process.env.MATERIAL_SIGNED_URL_TTL_SECONDS;
    else process.env.MATERIAL_SIGNED_URL_TTL_SECONDS = before;
  }
});
