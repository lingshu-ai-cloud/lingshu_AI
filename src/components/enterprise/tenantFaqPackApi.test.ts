import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTenantFaqPack } from './tenantFaqPackApi';
import { DEFAULT } from './enterpriseProfileState';
import { normalizeTenantFaqPacks } from '../../../shared/contracts/tenantFaqPacks';
const profile = {...DEFAULT,factVersion:{id:'facts',revision:1,contentHash:'current',confirmedAt:'2026-10-26',confirmedBy:'owner'}};

test('saving a pack patches only tenant overrides and verifies the persisted value',async()=>{
  const entries=[{q:'问题',a:'答案'}],calls:Array<{url:string;init?:RequestInit}>=[];
  const fetcher=(async(url,init)=>{calls.push({url:String(url),init});return Response.json(init?.method==='PATCH'?{ok:true}:{...profile,faqPackOverrides:{'general/presales':{items:entries}}});}) as typeof fetch;
  const result=await saveTenantFaqPack(profile,'general/presales',entries,'tenant-a',fetcher,()=> 'tenant-a',()=>({Authorization:'Bearer scope-a'}));
  assert.deepEqual(Object.keys(JSON.parse(String(calls[0].init?.body))),['faqPackOverrides']);
  assert.equal(calls[0].init?.method,'PATCH'); assert.equal((calls[0].init?.headers as any)['If-Match'],'"current"');
  assert.deepEqual(result.faqPackOverrides?.['general/presales'].items,entries);
});
test('identity switches stop saving and failed or missing read-back never reports success',async()=>{
  const entries=[{q:'问题',a:'答案'}]; let calls=0;
  const fetcher=(async()=>{calls++;return Response.json({ok:true});}) as typeof fetch;
  await assert.rejects(saveTenantFaqPack(profile,'general/presales',entries,'tenant-a',fetcher,()=> 'tenant-b',()=>({})),/登录身份已变化/); assert.equal(calls,0);
  await assert.rejects(saveTenantFaqPack(profile,'general/presales',entries,'tenant-a',fetcher,()=> 'tenant-a',()=>({})),/保存后核对失败/);
  await assert.rejects(saveTenantFaqPack(profile,'general/presales',entries,'tenant-a',(async()=>Response.json({message:'版本冲突'},{status:409})) as typeof fetch,()=> 'tenant-a',()=>({})),/版本冲突/);
});
test('invalid IDs, empty answers and duplicate questions cannot become tenant overrides',()=>{
  assert.throws(()=>normalizeTenantFaqPacks({'../victim':{items:[{q:'q',a:'a'}]}}));
  assert.throws(()=>normalizeTenantFaqPacks({'general/presales':{items:[{q:'q',a:''}]}}));
  assert.throws(()=>normalizeTenantFaqPacks({'general/presales':{items:[{q:'Q',a:'a'},{q:'q',a:'b'}]}}));
});
