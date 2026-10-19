import assert from 'node:assert/strict';
import test from 'node:test';
import { planWeeklyKeywordSources } from './dailySourceAllocation.js';

const refs = ['cleansing foam factory', 'cleansing foam supplier', 'cleansing foam', 'makeup remover foam', 'foaming cleanser'];
const platforms = ['youtube', 'tiktok', 'instagram', 'facebook'];

test('ten keyword slots use the approved 4:3:2:1 platform split and cover five terms twice', () => {
  const plan = planWeeklyKeywordSources({ refs, platforms, configuredAccountCount: 0 });
  assert.equal(plan.keywordLimit, 10);
  assert.deepEqual(Object.fromEntries(plan.platformLimits), { tiktok: 4, facebook: 3, instagram: 2, youtube: 1 });
  for (const ref of refs) assert.equal(plan.sources.filter(source => source.ref === ref).reduce((sum, source) => sum + source.limit, 0), 2);
  assert.equal(plan.sources.reduce((sum, source) => sum + source.limit, 0), 10);
});

test('configured account minimum comes first and leaves only the remaining daily quota for keywords', () => {
  const plan = planWeeklyKeywordSources({ refs, platforms, configuredAccountCount: 2 });
  assert.equal(plan.keywordLimit, 8);
  assert.equal(plan.sources.reduce((sum, source) => sum + source.limit, 0), 8);
  assert.equal([...plan.platformLimits.values()].reduce((sum, count) => sum + count, 0), 8);
  assert.throws(() => planWeeklyKeywordSources({ refs, platforms, configuredAccountCount: 11 }), /daily_collection_account_minimum_exceeds_limit/);
});

test('daily rotation changes keyword-platform pairing without changing either quota',()=>{
 const first=planWeeklyKeywordSources({refs,platforms,configuredAccountCount:0,businessDate:'2026-10-18'});
 const second=planWeeklyKeywordSources({refs,platforms,configuredAccountCount:0,businessDate:'2026-10-19'});
 assert.notDeepEqual(first.sources,second.sources);
 for(const plan of [first,second]){
  assert.deepEqual(Object.fromEntries(plan.platformLimits),{tiktok:4,facebook:3,instagram:2,youtube:1});
  for(const ref of refs)assert.equal(plan.sources.filter(source=>source.ref===ref).reduce((sum,source)=>sum+source.limit,0),2);
 }
});
