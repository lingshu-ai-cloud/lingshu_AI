import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMetaTargeting, emptyMetaTargeting, metaTargetingMatches, normalizeMetaTargeting } from '../../shared/metaTargeting.js';
import { MetaAdsAdapter, validateMetaVideoInput } from './metaAdapter.js';
import { readMetaTargetingOptions, parseMetaTargetingQuery } from './metaTargetingOptions.js';
import { validatePlatformAdTask } from './tasks.js';
process.env.META_ADS_API_VERSION = 'v25.0';
const config = { ...emptyMetaTargeting, ageMin: 25, ageMax: 55, gender: 'female' as const, locales: [{ id: '6', name: 'English' }], interests: [{ id: '123', name: 'Manufacturing' }], customAudiences: [{ id: '456', name: 'Customers' }], placementMode: 'manual' as const, facebookPositions: ['feed', 'facebook_reels'] };
test('saved targeting reaches the real adapter request and survives provider readback ordering/labels', async () => {
  const calls: Array<{ edge: string; body: URLSearchParams }> = [];
  const adapter = new MetaAdsAdapter('private', (async (url, init) => {
    if (init?.method === 'GET') return Response.json({ id: '1', access_token: 'page-private' });
    calls.push({ edge: new URL(String(url)).pathname.split('/').at(-1)!, body: new URLSearchParams(String(init?.body)) });
    return Response.json({ id: String(10 + calls.length) });
  }) as typeof fetch);
  const input = validateMetaVideoInput({ pageId: '1', videoId: '2', imageUrl: 'https://example.com/v.jpg', countries: ['CA'], dailyBudget: 5, targeting: config }, 100, true);
  await adapter.createPausedVideoTraffic('5', 'Audience', input, 100, async () => {}, true, ['Facebook']);
  const actual = JSON.parse(calls.find(c => c.edge === 'adsets')!.body.get('targeting')!);
  assert.deepEqual(actual.flexible_spec, [{ interests: [{ id: '123' }] }]);
  assert.deepEqual(actual.custom_audiences, [{ id: '456' }]);
  assert.deepEqual(actual.genders, [2]); assert.deepEqual(actual.locales, [6]);
  assert.equal(actual.age_min, 25); assert.equal(actual.age_max, 55);
  actual.facebook_positions.reverse(); actual.flexible_spec[0].interests[0].name = 'Meta label';
  assert.ok(metaTargetingMatches(actual, buildMetaTargeting(['CA'], ['Facebook'], config)));
  for (const mutation of [(v: any) => v.age_min = 18, (v: any) => v.locales = [], (v: any) => v.genders = [1], (v: any) => v.facebook_positions = ['story'], (v: any) => v.custom_audiences = []]) {
    const changed = structuredClone(actual); mutation(changed); assert.equal(metaTargetingMatches(changed, buildMetaTargeting(['CA'], ['Facebook'], config)), false);
  }
  assert.ok(calls.every(c => c.edge === 'adcreatives' || c.body.get('status') === 'PAUSED'));
});
test('invalid target settings fail before any provider request; legacy auto semantics stay intact', async () => {
  for (const value of [{ ...config, ageMin: 60 }, { ...config, ageMax: 70 }, { ...config, facebookPositions: ['invented'] }, { ...config, placementMode: 'automatic' }, { ...config, unknown: true }, { ...config, locales: [{ id: 'en', name: 'English' }] }]) assert.throws(() => normalizeMetaTargeting(value, ['Facebook']));
  assert.throws(() => normalizeMetaTargeting(config, ['Instagram']), /Facebook/);
  assert.throws(() => normalizeMetaTargeting(config, ['Facebook', 'Instagram']), /每个/);
  assert.deepEqual(buildMetaTargeting(['CA'], ['Facebook']), { geo_locations: { countries: ['CA'] }, age_min: 18, publisher_platforms: ['facebook'] });
});
test('draft validation keeps structured fields and rejects cross-platform or invalid settings', () => {
  const base = { name: 'Audience', video: 'Video', market: 'CA', budget: 100, currency: 'USD', goal: '提升有效视频观看', channels: ['Facebook'], configuration: { metaTargeting: config } };
  assert.deepEqual(validatePlatformAdTask(base).configuration.metaTargeting, normalizeMetaTargeting(config));
  assert.throws(() => validatePlatformAdTask({ ...base, channels: ['TikTok'] }), /Meta|Facebook/);
  assert.throws(() => validatePlatformAdTask({ ...base, configuration: { metaTargeting: { ...config, ageMin: 99 } } }), /年龄/);
});
test('platform option search preserves IDs, only returns cursor metadata and supports pagination', async () => {
  const calls: any[] = [];
  const adapter = { request: async (path: string, params: any) => { calls.push({ path, params }); return { data: [{ key: 6, name: 'English' }], paging: { next: 'https://graph.facebook.com/?access_token=SECRET', cursors: { after: 'cursor' } } }; } };
  const result = await readMetaTargetingOptions(adapter, '5', { kind: 'locale', q: 'English' });
  assert.deepEqual(result.items, [{ id: '6', name: 'English' }]); assert.equal(result.after, 'cursor');
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.equal(calls[0].params.type, 'adlocale');
  await readMetaTargetingOptions({ request: async (path, params) => { assert.equal(path, 'act_5/customaudiences'); assert.equal(params?.after, 'cursor'); return { data: [{ id: '9', name: 'Buyers' }] }; } }, '5', { kind: 'audience', after: 'cursor' });
  await assert.rejects(readMetaTargetingOptions({ request: async () => ({ data: [], paging: { next: 'secret' } }) }, '5', { kind: 'interest', q: 'steel' }), /分页/);
  await assert.rejects(readMetaTargetingOptions({ request: async () => ({ data: [{ id: 'bad', name: 'Invalid' }] }) }, '5', { kind: 'interest', q: 'steel' }), /标识/);
  assert.throws(() => parseMetaTargetingQuery({ kind: 'interest', q: 'x' })); assert.throws(() => parseMetaTargetingQuery({ kind: 'interest', q: 'steel', accountId: 'other' }));
});
