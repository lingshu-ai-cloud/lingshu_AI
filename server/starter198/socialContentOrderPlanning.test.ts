import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter198Repository} from './repository.js';
import {initialSocialContentOrder} from './socialContentOrderAdmission.js';
import {createContentCreationQuotaService} from '../socialPrograms/contentCreationQuota.js';
import {readSocialContentOrderPlanning,replaceSocialContentPlannedOrder,increaseSocialContentOrderTarget,reconcileSocialContentPlannedCancellation} from './socialContentOrderPlanning.js';
async function fixture(){
 const tables:Record<string,any[]>={};let serial=0;const table=(c:string)=>tables[c]??=[];
 const store:any={supportsAtomicCompareAndSwap:()=>true,getById:async(c:string,id:string)=>structuredClone(table(c).find(r=>r.id===id)??null),
 create:async(c:string,v:any)=>{const id=v.id??`row-${++serial}`;if(table(c).some(r=>r.id===id))return null;const r={...structuredClone(v),id};table(c).push(r);return structuredClone(r);},
 update:async(c:string,id:string,p:any)=>{const r=table(c).find(r=>r.id===id);if(!r)return false;Object.assign(r,structuredClone(p));return true;},delete:async(c:string,id:string)=>{const n=table(c).findIndex(r=>r.id===id);if(n<0)return false;table(c).splice(n,1);return true;},
 compareAndSwap:async(c:string,id:string,e:any,p:any)=>{const r=table(c).find(r=>r.id===id);if(!r||Object.entries(e).some(([k,v])=>JSON.stringify(r[k])!==JSON.stringify(v)))return false;Object.assign(r,structuredClone(p));return true;},
 list:async(c:string,q:any={})=>{const r=table(c).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return{items:structuredClone(r.slice(0,q.perPage??1000)),totalItems:r.length};}};
 const scope={tenantId:'planning-test-tenant',programId:'program',weekStart:'2026-10-12'};
 tables.social_programs=[{id:'program',tenant_id:scope.tenantId,program_id:'program'}];
 const add=(id:string,entry:'weekly_package'|'workspace')=>{const row={id,tenant_id:scope.tenantId,task_id:id,title:id,status:'draft',version:'1',brief:{},content_order:{...initialSocialContentOrder(id,entry),programId:'program',originWeek:scope.weekStart}};table('starter_social_content_tasks').push(row);return row;};
 const old=add('old','weekly_package'),replacement=add('new','workspace');
 const quota=createContentCreationQuotaService({store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:false,inFlight:false,paid:false,unknown:false}),verifyDelivery:async()=>false});
 await quota.plan(scope,{commandId:'plan',actorId:'policy',reason:'actual plan'},{contentId:'old',entry:'weekly_package',packageId:'pkg',packageVersion:1});
 const i={...scope,repository:createStarter198Repository(store)},replace={...i,userId:'user',commandId:'replace',reason:'replace with custom content',expectedRevision:1,selectedContentId:'old',replacementTaskId:'new'};
 return{table,store,quota,scope,i,replace,old,replacement};
}
test('explicit planned replacement retains original record, no dispatch and no new quota or fee',async()=>{
 const f=await fixture();const before=await readSocialContentOrderPlanning(f.i);assert.equal(before.orders[0].replaceable,true);
 const after=await replaceSocialContentPlannedOrder(f.replace);assert.equal(after.limit,5);assert.equal(after.orders.length,2);assert.equal(f.old.status,'cancelled');
 assert.equal(after.orders.find(o=>o.contentId==='new')!.state,'planned');assert.equal(after.orders.find(o=>o.contentId==='new')!.replacesContentId,'old');
 assert.equal((await f.quota.read(f.scope))!.outbox[0].state,'acknowledged');assert.equal(f.table('content_execution_jobs').length,0);
 await replaceSocialContentPlannedOrder(f.replace);assert.equal((await f.quota.read(f.scope))!.audit.filter(a=>a.action==='plan_replaced').length,1);
 await f.quota.reserve(f.scope,{commandId:'start-new',actorId:'user',reason:'explicit start'},{contentId:'new',entry:'workspace'});
 assert.equal((await f.quota.read(f.scope))!.orders.new.replacesContentId,'old');
 Object.assign(f.replacement,{status:'producing',run_id:'real-new-run',orchestrator_item_id:'real-new-queue'});
 const replay=await replaceSocialContentPlannedOrder(f.replace);assert.equal(replay.orders.find(o=>o.contentId==='new')!.state,'reserved');
 await assert.rejects(replaceSocialContentPlannedOrder({...f.replace,replacementTaskId:'different'}),/command_reused/);
 await assert.rejects(replaceSocialContentPlannedOrder({...f.replace,userId:'different-actor'}),/command_reused/);
 await assert.rejects(replaceSocialContentPlannedOrder({...f.replace,expectedRevision:0}),/command_reused/);
 await assert.rejects(f.quota.reserve(f.scope,{commandId:'old-auto-start',actorId:'policy',reason:'old start'},{contentId:'old',entry:'weekly_package'}),/released_content/);
});
test('automatic reserve winning CAS prevents replacement; live or unknown tasks are not replaceable',async()=>{
 const f=await fixture();await f.quota.reserve(f.scope,{commandId:'auto',actorId:'policy',reason:'auto start'},{contentId:'old',entry:'weekly_package'});
 await assert.rejects(replaceSocialContentPlannedOrder(f.replace),/version_conflict/);assert.equal(f.old.status,'draft');
 const other=await fixture();(other.old as any).run_id='historical';
 assert.equal((await readSocialContentOrderPlanning(other.i)).orders[0].replaceable,false);
 await assert.rejects(replaceSocialContentPlannedOrder(other.replace),/replacement_not_safe/);
});
test('target increase requires explicit confirmation and revision, retains orders and is retry safe',async()=>{
 const f=await fixture(),request={...f.i,userId:'user',commandId:'increase',reason:'one more original',expectedRevision:1,newLimit:6,confirmed:true};
 await assert.rejects(increaseSocialContentOrderTarget({...request,confirmed:false}),/explicit_confirmation/);
 await assert.rejects(increaseSocialContentOrderTarget({...request,expectedRevision:0}),/version_conflict/);
 const a=await increaseSocialContentOrderTarget(request);assert.equal(a.limit,6);assert.equal(a.orders.length,1);await increaseSocialContentOrderTarget(request);
 assert.equal((await f.quota.read(f.scope))!.audit.filter(a=>a.action==='target_increased').length,1);assert.equal(f.table('content_execution_jobs').length,0);
 await assert.rejects(increaseSocialContentOrderTarget({...request,newLimit:7}),/command_reused/);
});
test('outbox repairs committed obsolete plan projection after interruption',async()=>{
 const f=await fixture();f.replacement.content_order.programId=null as any;f.replacement.content_order.originWeek=null as any;
 await f.quota.replacePlanned(f.scope,{commandId:'replace',actorId:'user',reason:'replace with custom content'},{expectedRevision:1,selectedContentId:'old',replacement:{contentId:'new',entry:'workspace'}});
 assert.equal(f.old.status,'draft');await reconcileSocialContentPlannedCancellation({...f.i,contentId:'old',commandId:'replace'});
 assert.equal(f.old.status,'cancelled');assert.equal((await f.quota.read(f.scope))!.outbox[0].state,'acknowledged');
 assert.equal(f.replacement.content_order.programId,'program');assert.equal(f.replacement.content_order.originWeek,f.scope.weekStart);
});
test('failed stale, empty-pool, absent-plan and CAS-race replacements leave unbound drafts unchanged',async()=>{
 for(const mode of ['stale','empty','missing','race']){
  const f=await fixture();f.replacement.content_order.programId=null as any;f.replacement.content_order.originWeek=null as any;
  const before=structuredClone(f.replacement.content_order);
  if(mode==='empty')f.table('social_content_creation_quotas').splice(0);
  if(mode==='race'){
   const original=f.store.compareAndSwap;let once=true;
   f.store.compareAndSwap=async(c:string,id:string,expected:any,patch:any)=>{
    if(once&&c==='social_content_creation_quotas'&&patch.payload?.audit?.at(-1)?.action==='plan_replaced'){
     once=false;await f.quota.increaseTarget(f.scope,{commandId:'concurrent-target',actorId:'user',reason:'concurrent explicit target'},{newLimit:6,confirmationRef:'confirmed'});return false;
    }return original(c,id,expected,patch);
   };
  }
  await assert.rejects(replaceSocialContentPlannedOrder({...f.replace,...(mode==='stale'?{expectedRevision:0}:{}),...(mode==='missing'?{selectedContentId:'absent'}:{})}));
  assert.deepEqual(f.replacement.content_order,before,mode);assert.equal(f.old.status,'draft',mode);
 }
});
test('committed replacement recovery refuses conflicting scope without ACK or stealing draft',async()=>{
 const f=await fixture();await f.quota.replacePlanned(f.scope,{commandId:'replace',actorId:'user',reason:'replace with custom content'},{expectedRevision:1,selectedContentId:'old',replacement:{contentId:'new',entry:'workspace'}});
 f.replacement.content_order.originWeek='2026-10-19';
 await assert.rejects(reconcileSocialContentPlannedCancellation({...f.i,contentId:'old',commandId:'replace'}),/scope_changed/);
 assert.equal((await f.quota.read(f.scope))!.outbox[0].state,'pending');assert.equal(f.replacement.content_order.originWeek,'2026-10-19');assert.equal(f.old.status,'draft');
});
