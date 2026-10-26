import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformRewriteService } from './platformRewrite.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
const scope = { tenantId: 't', userId: 'u', role: 'admin' };
function fixture() {
  const rows = new Map<string, Record_>([['source', { id: 'source', tenant_id: 't', title: '原稿', status: 'draft', spec: { script: '真实产品口播，不添加不存在的功效。' } }]]);
  let creates = 0, loseReceipt = false;
  const data = { getById: async (_c: string, id: string) => rows.get(id) || null,
    create: async (_c: string, value: Record<string, unknown>) => { creates++; const row = { ...structuredClone(value), id: String(value.id) }; rows.set(row.id, row); if (loseReceipt) throw Error('connection lost after create'); return row; },
  } as DataStore;
  const service = createPlatformRewriteService({ data, profile: async () => ({ factVersion: 'facts1', enterprise: '已确认产品资料' }), generate: async () => JSON.stringify({ variants: ['TikTok', 'YouTube'].map(platform => ({ platform, title: `${platform}产品介绍`, script: '已确认事实的口播改写。', caption: '了解产品规格', rationale: '调整开场与语气' })) }) });
  return { rows, service, creates: () => creates, lose: () => { loseReceipt = true; } };
}
test('platform variants remain editable drafts and save idempotently into the actual Studio script library', async () => {
  const f = fixture(), source = JSON.stringify(f.rows.get('source'));
  const draft = await f.service.generate(scope, { sourceScriptId: 'source', platforms: ['TikTok', 'YouTube'], language: '英语' });
  assert.equal(f.creates(), 0);
  const input = { ...draft, requestId: 'f903907b-e03e-4b6c-a9db-805d93231c1e' };
  f.lose(); const result = await f.service.save(scope, input); assert.equal(result.status, 'saved'); assert.equal(f.creates(), 2);
  assert.equal((await f.service.save(scope, input)).status, 'saved'); assert.equal(f.creates(), 2);
  assert.equal(JSON.stringify(f.rows.get('source')), source);
  for (const saved of result.saved) {
    const row = f.rows.get(saved.id)!; assert.equal(row.status, 'draft'); assert.equal(row.tenant_id, 't');
    assert.equal((row.spec as Record<string, unknown>).script, '已确认事实的口播改写。');
    assert.equal((row.spec as Record<string, unknown>).lang, 'en');
    assert.equal((row.spec as Record<string, unknown>).platform, saved.platform.toLowerCase());
  }
  await assert.rejects(f.service.save(scope, { ...input, variants: input.variants.map(v => ({ ...v, script: '另一个版本' })) }), /绑定其他版本/);
});
test('cross-tenant sources and stale source revisions fail before generating or saving', async () => {
  const f = fixture();
  await assert.rejects(f.service.generate({ ...scope, tenantId: 'other' }, { sourceScriptId: 'source', platforms: ['TikTok'], language: '英语' }), /不可访问/);
  const draft = await f.service.generate(scope, { sourceScriptId: 'source', platforms: ['TikTok', 'YouTube'], language: '英语' });
  f.rows.get('source')!.updated_at = 'changed';
  await assert.rejects(f.service.save(scope, { ...draft, requestId: 'f903907b-e03e-4b6c-a9db-805d93231c1e' }), /源脚本已变化/);
  assert.equal(f.creates(), 0);
});
