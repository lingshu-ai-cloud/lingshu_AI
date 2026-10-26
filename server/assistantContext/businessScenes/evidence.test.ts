import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataStore, Record_, ListQuery } from '../../storage/datastore.js';
import { scanTenantRecords } from './readScope.js';
import { operatingSceneEvidence } from './operatingEvidence.js';
import { customerSceneEvidence } from './customerEvidence.js';
import { adSceneEvidence, adReaders } from './adEvidence.js';
const period = { sceneId: 'OP-04' as const, from: '2026-10-01', to: '2026-10-26' };
function data(rows: Record_[]): Pick<DataStore, 'list'> {
  return { async list<T>(collection: string, q?: ListQuery) {
    const all = collection === 'workflow_tasks' ? rows : [], page = q?.page || 1, perPage = q?.perPage || 200;
    return { items: all.slice((page - 1) * perPage, page * perPage) as T[], totalItems: all.length, totalPages: Math.ceil(all.length / perPage), page, perPage };
  } };
}
test('period summaries exhaust pages rather than turning four examples into totals', async () => {
  const rows = Array.from({ length: 405 }, (_, i) => ({ id: `r${i}`, tenant_id: 't', updated_at: i < 401 ? '2026-10-10T01:00:00Z' : '2026-09-10T00:00:00Z', status: i % 2 ? 'pending' : 'completed' }));
  const result = await operatingSceneEvidence('t', period, data(rows));
  const task = result.sources.find(s => s.collection === 'workflow_tasks')!;
  assert.equal(task.state, 'complete'); assert.equal(task.summary?.recordsInPeriod, 401); assert.equal(task.examples?.length, 4);
  assert.equal(task.scannedRecords, 405);
});
test('foreign rows, changing totals, missing dates and failed sources cannot become complete or zero business results', async () => {
  await assert.rejects(scanTenantRecords(data([{ id: 'foreign', tenant_id: 'other' }]), 'workflow_tasks', 't'), /归属/);
  const result = await operatingSceneEvidence('t', period, data([{ id: 'missing-time', tenant_id: 't', status: 'completed' }]));
  assert.equal(result.sources.find(s => s.collection === 'workflow_tasks')?.state, 'partial_dates');
  const denied: Pick<DataStore, 'list'> = { list: async () => { throw Error('secret'); } };
  assert.equal((await operatingSceneEvidence('t', period, denied)).sources[0].summary, null);
});
test('customer evidence binds selection, period and ranking; archived/opted-out/test customers are never real followup targets', () => {
  const rows = [{ id: 'real', name: 'buyer', intentScore: 80, timeline: [{ id: 'm', actor: 'buyer', body: 'Need 100 units', timestamp: Date.parse('2026-10-20T00:00:00Z') }] },
    { id: 'opted', optedOut: true, intentScore: 100, timeline: [{ body: 'stop', timestamp: Date.parse('2026-10-20') }] },
    { id: 'old', isHistorical: true, timeline: [{ body: 'old', timestamp: Date.parse('2026-10-20') }] }];
  const all = customerSceneEvidence(rows, { ...period, sceneId: 'CS-01' });
  assert.deepEqual(all.ranking.map(r => r.customerId), ['real']);
  const selected = customerSceneEvidence(rows, { ...period, sceneId: 'CS-02', customerId: 'real' });
  assert.equal(selected.customers.length, 1); assert.equal(selected.customers[0].messages[0].body, 'Need 100 units');
  assert.equal(selected.customers[0].conversationCoverage.sellerMessagesPresent, false);
  assert.throws(() => customerSceneEvidence(rows, { ...period, sceneId: 'CS-02', customerId: 'foreign' }), /不可访问/);
});
test('ad analysis reuses three owned Meta report levels and never exposes credentials or mutates execution', async () => {
  const levels: string[] = [];
  const read = { ...adReaders,
    task: async () => ({ id: 'task', version: 1, budget: 100, currency: 'USD', authorization: {}, configuration: {} }),
    connections: async () => [{ id: 'connection', provider: 'meta', tokenCipher: 'SECRET', accountId: 'a', status: 'connected' }],
    executions: async () => [{ id: 'execution', taskId: 'task', connectionId: 'connection', action: 'create', status: 'VERIFIED' }],
    approvals: async () => [], launches: async () => [], creatives: async () => [], history: async () => ({ items: [], source: 'local_snapshots' }),
    report: async (_t: string, _id: string, query: Record<string, unknown>) => { levels.push(String(query.level)); return { source: 'provider', currency: 'USD', totals: { spend: 5 } }; },
  } as unknown as typeof adReaders;
  const result = await adSceneEvidence('t', { ...period, sceneId: 'AD-01', adTaskId: 'task' }, read);
  assert.deepEqual(levels.sort(), ['ad', 'adset', 'campaign']); assert.doesNotMatch(JSON.stringify(result), /SECRET|tokenCipher/);
  await assert.rejects(adSceneEvidence('t', { ...period, sceneId: 'AD-01', adTaskId: 'foreign' }, { ...read, task: async () => null }), /不可访问/);
});

test('untrusted grouping labels cannot modify object prototypes', async () => {
  const result = await operatingSceneEvidence('t', period, data([{ id: 'poison', tenant_id: 't', updated_at: '2026-10-10', status: '__proto__' }]));
  const source = result.sources.find(s => s.collection === 'workflow_tasks')!;
  assert.equal(source.summary?.byStatus['__proto__'], 1);
  assert.equal(Object.getPrototypeOf(source.summary!.byStatus), null);
});
