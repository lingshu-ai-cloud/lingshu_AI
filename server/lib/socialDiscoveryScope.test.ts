import assert from 'node:assert/strict';
import { buildSocialCrawlStrategy } from '../../shared/socialInspirationStrategy.js';
import { discoveryKeywords } from '../../shared/socialDiscoveryKeywords.js';
import { parseDiscoveryRecommendations } from './discoveryRecommendations.js';
import { readSavedDiscoveryScope } from './socialDiscoveryScope.js';
import { store } from '../storage/index.js';

const recommendations = parseDiscoveryRecommendations(JSON.stringify({ productQueries: ['PCB inspection kit', 'PCB inspection kit'], sceneClusters: [null, { label: '来料检查', queryVariants: ['PCB incoming inspection'] }] }));
assert.deepEqual(recommendations.productQueries, ['PCB inspection kit']);
assert.equal(recommendations.sceneClusters.length, 1);
assert.throws(() => parseDiscoveryRecommendations('{"productQueries":[]}'));
assert.throws(() => parseDiscoveryRecommendations('null'));
const make = (product: string) => buildSocialCrawlStrategy({ businessGoal: '发现内容', productTerms: [product], market: '美国', language: '英语', platforms: ['youtube'], sceneClusters: [
  { label: '来料检查', demandDimension: 'scene', queryVariants: ['PCB incoming inspection'], status: 'approved' },
  { label: '已拒绝', demandDimension: 'scene', queryVariants: ['unrelated skincare'], status: 'rejected' },
  { label: '未确认', demandDimension: 'scene', queryVariants: ['unconfirmed'], status: 'suggested' },
] });
const a = make('PCB inspection kit');
const b = make('linen shirt');
assert.deepEqual(discoveryKeywords(a), ['PCB inspection kit', 'PCB incoming inspection']);
const list = store.list;
const records = new Map([['a', a], ['b', b]]);
store.list = (async (collection: string, options: any) => {
  assert.equal(collection, 'social_discovery_scopes');
  assert.equal(options.where.status, 'active');
  assert.equal(options.sort, '-updated_at');
  const payload = records.get(options.where.tenant_id);
  return { items: payload ? [{ id: 'scope', payload: structuredClone(payload) }] : [] };
}) as typeof store.list;
try {
  assert.equal((await readSavedDiscoveryScope('a'))?.keywordSet.scope.productRef, 'PCB inspection kit');
  assert.equal((await readSavedDiscoveryScope('b'))?.keywordSet.scope.productRef, 'linen shirt');
  assert.equal(await readSavedDiscoveryScope('unknown'), null);
  const updated = make('PCB microscope');
  updated.keywordSet.version = 2;
  records.set('a', updated);
  assert.equal((await readSavedDiscoveryScope('a'))?.keywordSet.version, 2);
  assert.equal(discoveryKeywords((await readSavedDiscoveryScope('a'))!)[0], 'PCB microscope');
} finally { store.list = list; }
console.log('Discovery recommendation validation, enabled queries, tenant isolation and latest version passed');

// Run the real save route against an isolated store, then read through the worker path.
const { socialDiscoveryRouter } = await import('../routes/socialDiscovery.js');
const original = { list: store.list, create: store.create, update: store.update };
let savedRecord: any = null;
store.list = (async () => ({ items: savedRecord ? [savedRecord] : [], totalItems: savedRecord ? 1 : 0, totalPages: 1, page: 1, perPage: 1 })) as typeof store.list;
store.create = (async (_collection: string, value: any) => { savedRecord = { id: 'saved', ...value }; return 'saved'; }) as typeof store.create;
store.update = (async () => true) as typeof store.update;
try {
  const layer = socialDiscoveryRouter.stack.find((item: any) => item.route?.path === '/scope' && item.route.methods.put);
  assert.ok(layer?.route);
  let response: any;
  await (layer.route.stack[0].handle as any)({ body: {
    productRef: '电路板外观观察套件', productTerms: ['电路板外观观察套件'],
    productQueries: recommendations.productQueries, market: '美国', language: '英语',
    companyRole: 'brand', audienceRole: 'distributor', platforms: ['youtube'],
    sceneClusters: recommendations.sceneClusters,
  } }, { locals: { tenantId: 'a', userId: 'u' }, json(value: unknown) { response = value; }, status(code: number) { throw new Error(`Unexpected HTTP ${code}`); } });
  assert.equal(response.persisted, true);
  const workerScope = await readSavedDiscoveryScope('a');
  assert.deepEqual(discoveryKeywords(workerScope!), ['PCB inspection kit', 'PCB incoming inspection']);
  assert.equal(workerScope?.keywordSet.scope.productRef, '电路板外观观察套件');
  assert.equal(workerScope?.keywordSet.scope.audienceRole, 'distributor');
  assert.deepEqual(workerScope?.keywords.find(row => row.category === 'discovery_seed')?.values, recommendations.productQueries);
  console.log('Actual save route preserves localized queries for subsequent worker reads');
} finally { Object.assign(store, original); }

// A five-term plan replaces legacy scene queries instead of appending to them.
const before = { list: store.list, create: store.create, update: store.update };
store.list = (async () => ({ items: [], totalItems: 0, totalPages: 1, page: 1, perPage: 1 })) as typeof store.list;
let fiveSaved: any;
store.create = (async (_collection: string, value: any) => { fiveSaved = value.payload; return 'five'; }) as typeof store.create;
try {
  const layer = socialDiscoveryRouter.stack.find((item: any) => item.route?.path === '/scope' && item.route.methods.put);
  assert.ok(layer?.route);
  const terms = ['mask factory', 'cosmetic spray factory', 'sheet mask', 'facial mist', 'clay mask'];
  const entries = terms.map(term => ({ term, sourceQuote: '面膜、喷雾', reason: '对应类别' }));
  await (layer.route.stack[0].handle as any)({ body: {
    productRef: '面膜与喷雾', productTerms: ['面膜与喷雾'], market: '美国', language: '英语', companyRole: 'factory',
    keywordRecommendation: { broadTerms: entries.slice(0, 2), mediumTerms: entries.slice(2), perspective: 'factory', sourceName: '货盘.pdf' },
    productQueries: ['old query'], sceneClusters: [{ label: '旧场景', queryVariants: ['old scene'] }],
  } }, { locals: { tenantId: 'a', userId: 'u' }, json() {}, status(code: number) { throw new Error(`Unexpected ${code}`); } });
  assert.deepEqual(discoveryKeywords(fiveSaved), terms);
  assert.equal(fiveSaved.keywordRecommendation.sourceName, '货盘.pdf');
  console.log('Five-term save preserves source metadata and removes legacy queries');
} finally { Object.assign(store, before); }
