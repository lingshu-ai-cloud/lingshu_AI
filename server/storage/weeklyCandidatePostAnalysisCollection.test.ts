import test from 'node:test';
import assert from 'node:assert/strict';
import {runWithDataAuthority} from './dataAuthority.js';
import {ensureWeeklyCandidatePostAnalysisCollection} from './ensureDeliveryCollections.js';
import {WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS} from '../runtime/weeklyCandidatePostAnalysis.js';

test('isolated PocketBase API provisions admin-only tuple uniqueness and a fresh reader sees the same progress',async t=>{
 const old={url:process.env.PB_URL,email:process.env.PB_ADMIN_EMAIL,password:process.env.PB_ADMIN_PASSWORD,fetch:globalThis.fetch};
 process.env.PB_URL='http://postanalysis-pocketbase.test';delete process.env.PB_ADMIN_EMAIL;delete process.env.PB_ADMIN_PASSWORD;
 t.after(()=>{globalThis.fetch=old.fetch;if(old.url===undefined)delete process.env.PB_URL;else process.env.PB_URL=old.url;if(old.email===undefined)delete process.env.PB_ADMIN_EMAIL;else process.env.PB_ADMIN_EMAIL=old.email;if(old.password===undefined)delete process.env.PB_ADMIN_PASSWORD;else process.env.PB_ADMIN_PASSWORD=old.password;});
 let schema:Record<string,unknown>|null=null;const records=new Map<string,Record<string,unknown>>();let creates=0;
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input)),method=(init.method??'GET').toUpperCase(),parts=url.pathname.split('/').filter(Boolean),collection=parts[2],id=parts[4];
  if(parts.length===2&&method==='POST'){const body=JSON.parse(String(init.body));if(body.name!==WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS)return new Response(null,{status:404});schema=body;return Response.json(schema);}
  if(collection!==WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS)return new Response(null,{status:404});
  if(parts.length===3){
   if(method==='GET')return schema?Response.json(schema):new Response(null,{status:404});
   if(method==='PATCH'){schema={...schema,...JSON.parse(String(init.body))};return Response.json(schema);}
  }
  if(parts[3]==='records'){
   if(method==='POST'){const body=JSON.parse(String(init.body)) as Record<string,unknown>;creates++;if(records.has(String(body.id)))return new Response('duplicate',{status:400});records.set(String(body.id),body);return Response.json(body);}
   if(method==='GET'&&id){const found=records.get(id);return found?Response.json(found):new Response(null,{status:404});}
   if(method==='GET')return Response.json({items:[...records.values()],totalItems:records.size,totalPages:1,page:1,perPage:30});
  }
  return new Response(null,{status:404});
 };
 await runWithDataAuthority('pocketbase',()=>ensureWeeklyCandidatePostAnalysisCollection());
 const provisioned=JSON.parse(JSON.stringify(schema)) as Record<string,unknown>;
 assert.equal(provisioned.listRule,null);assert.equal(provisioned.viewRule,null);assert.equal(provisioned.createRule,null);assert.equal(provisioned.updateRule,null);assert.equal(provisioned.deleteRule,null);
 assert.match(String((provisioned.indexes as string[])[0]),/UNIQUE INDEX.*tenant_id, job_id, run_id, candidate_id/);
 const {pbStore}=await import('./pbStore.js');const record={id:'a'.repeat(15),tenant_id:'tenant',job_id:'job',run_id:'run',candidate_id:'candidate',record_hash:'b'.repeat(64),payload:{state:'semantic_pending',code:'candidate_context_semantic_budget_authorization_required'}};
 await runWithDataAuthority('pocketbase',()=>pbStore.create(WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS,record));
 await runWithDataAuthority('pocketbase',()=>ensureWeeklyCandidatePostAnalysisCollection());
 const fresh=await runWithDataAuthority('pocketbase',()=>pbStore.getById<Record<string,unknown>>(WEEKLY_CANDIDATE_POSTANALYSIS_PROGRESS,record.id));
 assert.equal((fresh?.payload as {code?:string})?.code,'candidate_context_semantic_budget_authorization_required');
 assert.equal(creates,1);
});
