import assert from 'node:assert/strict';
import { resolveCrawlKeywords } from './crawlKeywords.js';

const profile = { products: { categories: '服装', items: [{name: '产品1'}] } };
assert.deepEqual(resolveCrawlKeywords('产品1', profile), {keywords: ['clothing'], source: 'category', evidence: ['服装']});
assert.equal(resolveCrawlKeywords('LS-S1 智能开关面板', profile).source, 'explicit', 'explicit real product choices are preserved');
assert.deepEqual(resolveCrawlKeywords('product 1', {products: {items: [{name: 'Linen shirt',category:'clothing'}]}}).keywords, ['Linen shirt']);
assert.deepEqual(resolveCrawlKeywords('产品1', {products:{categories:'服装',items:[{name:'产品1',category:'灯具'},{name:'其他产品',category:'家具'}]}}).keywords, ['lighting'], 'selected product category takes priority over unrelated catalog entries');
assert.throws(() => resolveCrawlKeywords('产品1', {}), /缺少可识别/);
assert.throws(() => resolveCrawlKeywords('', {products:{categories:'11'}}), /缺少可识别/);
assert.deepEqual(resolveCrawlKeywords('产品1', {products: {...profile.products, searchKeywords: 'linen shirt\n棉质T恤'}}), {keywords:['linen shirt','棉质T恤'],source:'knowledge',evidence:['linen shirt','棉质T恤']});
assert.equal(resolveCrawlKeywords('clothing', {products:{searchKeywords:'summer outfits'}}).source, 'knowledge', 'saved knowledge search terms override an earlier generated query');
console.log('Evidence-based crawl keyword selection passed');

// Exercise the actual profile save/read path with an isolated store.
const { store } = await import('../storage/index.js');
const { readTenantEnterpriseProfile, updateTenantEnterpriseProfile } = await import('../routes/enterprise.js');
const original = { list: store.list, update: store.update };
const profiles: any[] = [
  { id: 'a', tenant_id: 'a', profile: {products:{categories:'服装',items:[]}} },
  { id: 'b', tenant_id: 'b', profile: {products:{categories:'灯具',searchKeywords:'smart switch',items:[]}} },
];
store.list = (async (_collection: string, query: any) => {
  const items = profiles.filter(item => item.tenant_id === query.where.tenant_id);
  return {items:structuredClone(items),page:1,perPage:1,totalItems:items.length,totalPages:1};
}) as typeof store.list;
store.update = (async (_collection: string, id: string, patch: any) => {
  Object.assign(profiles.find(item => item.id === id), patch); return true;
}) as typeof store.update;
try {
  const current = await readTenantEnterpriseProfile('a');
  await updateTenantEnterpriseProfile('a', {products:{...current.products,searchKeywords:'linen shirt\n棉质T恤'}});
  const saved = await readTenantEnterpriseProfile('a');
  assert.deepEqual(resolveCrawlKeywords('产品1', saved).keywords, ['linen shirt','棉质T恤']);
  assert.equal(saved.products.categories, '服装', 'saving search terms preserves other enterprise facts');
  assert.deepEqual(resolveCrawlKeywords('产品1', await readTenantEnterpriseProfile('b')).keywords, ['smart switch']);
  console.log('Knowledge search term persistence and tenant isolation passed');
} finally { Object.assign(store, original); }
