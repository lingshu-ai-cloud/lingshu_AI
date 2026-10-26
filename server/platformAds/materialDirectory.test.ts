import assert from 'node:assert/strict';
import test from 'node:test';
import { createMaterialDirectory } from './materialDirectory.js';
import { materialReportGroups } from '../../shared/adMaterialDirectory.js';
const source = { origin: 'social', key: 'social:s:a', sourceTaskId: 's', artifactId: 'a', name: 'same.mp4', sha256: 'sha-a', verifiedSource: true, createdAt: '', status: '', note: '' };
function setup(overrides: Record<string, any> = {}) {
  const seen: string[] = [];
  const deps = {
    async tasks(tenant: string) { seen.push(tenant); return [{ id: 'p1', name: 'Plan', goal: '提升有效视频观看', market: 'CA', status: 'draft', createdAt: '', configuration: { materialSource: { ...source, origin: 'social', sourceTenantId: tenant, sourceTenantName: 'Current' } } }]; },
    async sources(tenant: string, q: any) { seen.push(tenant); return { items: q.origin === 'social' ? [source] : [{ ...source, origin: 'studio', key: 'studio:duplicate', projectId: 'project' }, { ...source, key: 'other-version', artifactId: 'b', sha256: 'sha-b' }], totalPages: 1 }; },
    async external(tenant: string) { seen.push(tenant); return []; },
    async library(tenant: string) { seen.push(tenant); return { items: [{ task: { id: 'p1', name: 'Plan', goal: '提升有效视频观看', status: 'draft' }, connection: { id: 'c1', accountId: 'a1', name: 'Account', currency: 'CNY' }, binding: { ...source, id: 'b1', taskId: 'p1', status: 'ready' }, execution: { id: 'e1', adId: 'ad-mapped' } }], totalPages: 1, truncated: false }; },
    async accounts(tenant: string) { seen.push(tenant); return { items: [{ provider: 'meta', connectionId: 'c1', accountId: 'a1', name: 'Account' }], warnings: [] }; },
    async history(tenant: string) { seen.push(tenant); return { accountName: 'Account', currency: 'CNY', timezone: 'Asia/Shanghai', reportedAt: '2026-10-25', complete: true, items: [{ adId: 'ad-mapped', adName: 'same.mp4' }, { adId: 'ad-unmapped', adName: 'same.mp4' }] }; },
    ...overrides,
  };
  return { seen, list: createMaterialDirectory(deps as any) };
}
test('unified directory deduplicates verified lineage, preserves different versions and does not join filenames', async () => {
  const h = setup(), result = await h.list('tenant-a', {});
  assert.equal(result.items.length, 3); const local = result.items.find(i => i.source?.sha256 === 'sha-a')!;
  assert.equal(local.plans.length, 1); assert.equal(local.ads.length, 1); assert.equal(local.ads[0].executionId, 'e1');
  assert.equal(result.items.filter(i => !i.source).length, 1); assert.equal(result.items.find(i => !i.source)?.ads[0].adId, 'ad-unmapped');
  assert.ok(h.seen.every(tenant => tenant === 'tenant-a')); assert.deepEqual(result.warnings, []);
});
test('source/usage/goal/task filters are applied to the combined directory before pagination', async () => {
  const h = setup();
  const used = await h.list('tenant', { usage: 'used', perPage: '1', page: '2' }); assert.equal(used.totalItems, 2); assert.equal(used.items.length, 1);
  const local = await h.list('tenant', { origin: 'local', goal: '提升有效视频观看', taskId: 'p1' }); assert.equal(local.totalItems, 1);
  await assert.rejects(h.list('tenant', { taskId: 'foreign' }), /未找到/);
  await assert.rejects(h.list('tenant', { page: '-1' }), /分页/); await assert.rejects(h.list('tenant', { token: 'secret' }), /参数/);
});
test('failures and bounded source scans are explicit, never an empty complete total', async () => {
  const h = setup({ sources: async (_: string, q: any) => { if (q.origin === 'studio') throw Error(); return { items: [source], totalPages: 30 }; }, history: async () => { throw Error(); } });
  const result = await h.list('tenant', {}); assert.equal(result.truncated, true); assert.ok(result.warnings.some(w => w.includes('读取上限'))); assert.ok(result.warnings.some(w => w.includes('历史项目'))); assert.ok(result.warnings.some(w => w.includes('平台历史读取失败')));
  assert.ok(result.items.length > 0);
});
test('unmapped native ads from different accounts remain separate', async () => {
  const h = setup({ accounts: async () => ({ items: [{ provider: 'meta', connectionId: 'c1', accountId: 'a1', name: 'A' }, { provider: 'meta', connectionId: 'c2', accountId: 'a2', name: 'B' }], warnings: [] }) });
  const result = await h.list('tenant', { origin: 'platform' }); assert.equal(result.items.length, 3);
});
test('material costs use compatible weighted totals; missing values, currencies and attribution stay separate', () => {
  const base = { accountId: 'a', adId: '1', currency: 'CNY', reportTimezone: 'Asia/Shanghai', window: { since: '2026-10-01', until: '2026-10-07' }, metricLabel: 'Meta 表单线索', attributionSpec: [], spend: 10, results: 2, impressions: 100 };
  const group = materialReportGroups([base, { ...base, adId: '2', spend: 30, results: 3 }] as any)[0]; assert.equal(group.spend, 40); assert.equal(group.results, 5); assert.equal(group.derivedCost, 8);
  assert.equal(materialReportGroups([base, base] as any)[0].spend, 10);
  assert.equal(materialReportGroups([base, { ...base, adId: '2', results: null }] as any)[0].derivedCost, null);
  assert.equal(materialReportGroups([base, { ...base, adId: '2', currency: 'USD' }, { ...base, adId: '3', attributionSpec: [{ event_type: 'click', window_days: 1 }] }] as any).length, 3);
});

test('market-specific reports cannot be merged into one cost or a misleading fresh timestamp', () => {
  const base = { accountId: 'a', adId: '1', currency: 'CNY', reportTimezone: 'Asia/Shanghai', window: { since: '2026-10-01', until: '2026-10-07' }, metricLabel: 'Meta 表单线索', attributionSpec: [], spend: 10, results: 2, impressions: 100, market: 'CA', reportedAt: '2026-10-25T00:00:00Z' };
  assert.equal(materialReportGroups([base, { ...base, adId: '2', market: 'US' }] as any).length, 2);
  assert.equal(materialReportGroups([base, { ...base, adId: '2', reportedAt: '2026-10-24T00:00:00Z' }] as any)[0].reportedAt, '2026-10-24T00:00:00Z');
});

test('a draft reusing a source never inherits another plan advertising reports in the selected-plan scope', async () => {
  const h = setup({ library: async () => ({ items: [{ task: { id: 'p2', name: 'Another Plan', goal: '提升有效视频观看', status: 'paused' }, connection: { id: 'c1', accountId: 'a1', name: 'A', currency: 'CNY' }, binding: { ...source, id: 'b2', taskId: 'p2', status: 'ready' }, execution: { id: 'e2', adId: 'other-plan-ad' } }], totalPages: 1, truncated: false }), history: async () => ({ complete: true, items: [] }) });
  const selected = await h.list('tenant', { taskId: 'p1' });
  assert.equal(selected.items.length, 1); assert.equal(selected.items[0].ads.length, 0);
  const all = await h.list('tenant', {}); assert.equal(all.items.find(i => i.source?.sha256 === 'sha-a')?.ads[0].taskId, 'p2');
});
