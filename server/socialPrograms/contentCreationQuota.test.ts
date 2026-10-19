import assert from 'node:assert/strict';
import test from 'node:test';
import {createContentCreationQuotaService,shanghaiNaturalWeek} from './contentCreationQuota.js';
import type {DataStore} from '../storage/datastore.js';
function fixture(){
 const rows=new Map<string,any>();let unsafe=false,delivery=false,revisionVerified=false;
 const verifiedTaskIds:Array<string|null>=[];
 const store:DataStore={getById:async(_c,id)=>structuredClone(rows.get(id)??null),create:async(_c,data)=>{if(rows.has(String(data.id)))return null;rows.set(String(data.id),structuredClone(data));return structuredClone(data) as any;},update:async()=>false,delete:async()=>false,list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:20}),compareAndSwap:async(_c,id,expected,data)=>{const row=rows.get(id);if(!row||row.revision!==expected.revision)return false;rows.set(id,structuredClone({...row,...data}));return true;}};
 const service=createContentCreationQuotaService({store,assertAtomicStore:async()=>{},readReleaseSafety:async()=>({leaseActive:unsafe,inFlight:false,paid:false,unknown:false}),verifyDelivery:async order=>{verifiedTaskIds.push(order.productionTaskId);return delivery;},verifyRevisionDispatch:async(_o,_s,r)=>revisionVerified&&r.lineageHash==='a'.repeat(64)});
 return{service,verifiedTaskIds,setUnsafe:(v:boolean)=>unsafe=v,setDelivery:(v:boolean)=>delivery=v,setRevisionVerified:(v:boolean)=>revisionVerified=v};
}
const scope={tenantId:'tenant',programId:'program',weekStart:'2026-10-12'};
const cmd=(commandId:string)=>({commandId,actorId:'user',reason:'explicit test operation'});
test('Shanghai natural week respects Sunday/Monday boundary',()=>{assert.equal(shanghaiNaturalWeek(new Date('2026-10-18T15:59:59Z')),'2026-10-12');assert.equal(shanghaiNaturalWeek(new Date('2026-10-18T16:00:00Z')),'2026-10-19');});
test('cross-entry race reserves five slots, retries preserve order and outbox',async()=>{
 const {service}=fixture();const results=await Promise.allSettled(Array.from({length:12},(_,i)=>service.reserve(scope,cmd(`r${i}`),{contentId:`c${i}`,entry:i%2?'assistant':'workspace'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,5);let pool=(await service.read(scope))!;assert.equal(pool.outbox.length,5);
 const order=Object.values(pool.orders)[0];const index=Number(order.contentId.slice(1));await service.reserve(scope,cmd(`r${index}`),{contentId:order.contentId,entry:index%2?'assistant':'workspace'});pool=(await service.read(scope))!;assert.equal(pool.outbox.length,5);
 await assert.rejects(service.reserve(scope,cmd(`r${index}`),{contentId:'another',entry:'workspace'}),/command_reused/);
});
test('manual start replaces only an unstarted planned slot with durable cancel and dispatch',async()=>{
 const {service,setUnsafe}=fixture();for(let i=0;i<5;i++)await service.plan(scope,cmd(`p${i}`),{contentId:`auto${i}`,entry:'weekly_package',packageId:'package',packageVersion:1});
 setUnsafe(true);await assert.rejects(service.reserve(scope,cmd('manual'),{contentId:'manual',entry:'assistant'}),/replacement_not_safe/);
 setUnsafe(false);const result=await service.reserve(scope,cmd('manual'),{contentId:'manual',entry:'assistant'});assert.equal(result.order!.replacesContentId,'auto0');assert.equal(result.pool.orders.auto0.state,'released');assert.deepEqual(result.pool.outbox.map(x=>x.kind),['cancel_planned','dispatch']);
 await service.acknowledgeOutbox(scope,cmd('ack'),{outboxCommandId:'manual',contentId:'manual',kind:'dispatch'});assert.equal((await service.read(scope))!.outbox[1].state,'acknowledged');
});
test('package revisions and production retries do not mint quota; delivery requires real proof',async()=>{
 const {service,setDelivery,setUnsafe}=fixture();await service.reserve(scope,cmd('start'),{contentId:'c',entry:'weekly_package',packageId:'p',packageVersion:1});
 await service.reserve(scope,cmd('revision'),{contentId:'c',entry:'weekly_package',packageId:'p',packageVersion:2});assert.equal(Object.keys((await service.read(scope))!.orders).length,1);
 await service.transition(scope,cmd('run'),{contentId:'c',state:'running',productionTaskId:'task'});setUnsafe(true);await assert.rejects(service.release(scope,cmd('cancel'),'c'),/release_not_safe/);
 await assert.rejects(service.transition(scope,cmd('done'),{contentId:'c',state:'delivered',productionTaskId:'task',deliveryRef:'artifact'}),/real_delivery_required/);
 setDelivery(true);await service.transition(scope,cmd('done'),{contentId:'c',state:'delivered',productionTaskId:'task',deliveryRef:'artifact'});await service.transition(scope,cmd('done2'),{contentId:'c',state:'delivered',productionTaskId:'task',deliveryRef:'artifact'});assert.equal((await service.read(scope))!.orders.c.state,'delivered');
});
test('explicit target increase is scoped, audited and idempotent',async()=>{const{service}=fixture();await service.increaseTarget(scope,cmd('increase'),{newLimit:6,confirmationRef:'goal-revision:1'});await service.increaseTarget(scope,cmd('increase'),{newLimit:6,confirmationRef:'goal-revision:1'});assert.equal((await service.read(scope))!.limit,6);assert.equal(await service.read({...scope,tenantId:'other'}),null);assert.equal(await service.read({...scope,weekStart:'2026-10-19'}),null);});
test('manual starts prefer a not-started automatic slot even while empty slots exist',async()=>{const{service}=fixture();await service.plan(scope,cmd('p'),{contentId:'automatic',entry:'weekly_package'});const result=await service.reserve(scope,cmd('m'),{contentId:'manual',entry:'workspace'});assert.equal(result.order!.replacesContentId,'automatic');assert.equal(result.pool.slots.filter(s=>s.contentId!==null).length,1);});
test('explicit replacement races automatic admission on the same aggregate, never keeps both executable',async()=>{
 const{service}=fixture();await service.plan(scope,cmd('plan'),{contentId:'automatic',entry:'weekly_package'});
 const results=await Promise.allSettled([
  service.replacePlanned(scope,cmd('replace'),{expectedRevision:1,selectedContentId:'automatic',replacement:{contentId:'manual',entry:'workspace'}}),
  service.reserve(scope,cmd('automatic-start'),{contentId:'automatic',entry:'weekly_package'}),
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const pool=(await service.read(scope))!;assert.equal(pool.slots.filter(s=>s.contentId).length,1);
 assert.ok(pool.orders.automatic.state==='reserved'||pool.orders.automatic.state==='released');
 if(pool.orders.manual)assert.equal(pool.orders.automatic.state,'released');
});
test('verified revision dispatch has its own outbox but never a second original slot or settlement',async()=>{
 const f=fixture();await f.service.reserve(scope,cmd('root'),{contentId:'root',entry:'workspace'});f.setDelivery(true);
 await f.service.transition(scope,cmd('delivery'),{contentId:'root',state:'delivered',productionTaskId:'root-task',deliveryRef:'original-artifact'});
 const value={contentId:'root',executionTaskId:'child',lineageHash:'a'.repeat(64)};
 await assert.rejects(f.service.registerRevisionDispatch(scope,cmd('repair'),value),/revision_lineage_required/);f.setRevisionVerified(true);
 await f.service.registerRevisionDispatch(scope,cmd('repair'),value);await f.service.registerRevisionDispatch(scope,cmd('repair-retry'),value);
 const pool=(await f.service.read(scope))!;assert.equal(Object.keys(pool.orders).length,1);assert.equal(pool.slots.filter(s=>s.contentId).length,1);
 assert.equal(pool.orders.root.state,'delivered');assert.equal(pool.orders.root.productionTaskId,'root-task');assert.equal(pool.orders.root.deliveryRef,'original-artifact');
 assert.equal(pool.outbox.length,2);assert.equal(pool.outbox[1].executionTaskId,'child');assert.equal(pool.orders.root.revisions!.length,1);
 await assert.rejects(f.service.registerRevisionDispatch(scope,cmd('forged'),{...value,lineageHash:'b'.repeat(64)}),/revision_lineage_required/);
 await f.service.registerRevisionDispatch(scope,cmd('same-task-revision'),{...value,executionTaskId:'root'});
 assert.equal((await f.service.read(scope))!.orders.root.revisions!.length,2);
});
test('real revision deliveries append independently without replacing original settlement or spending a slot',async()=>{
 const f=fixture();await f.service.reserve(scope,cmd('root'),{contentId:'root',entry:'workspace'});f.setDelivery(true);
 await f.service.transition(scope,cmd('original-delivery'),{contentId:'root',productionTaskId:'root',state:'delivered',deliveryRef:'original-package'});
 f.setRevisionVerified(true);const revision={contentId:'root',executionTaskId:'child',lineageHash:'a'.repeat(64)};
 await f.service.registerRevisionDispatch(scope,cmd('revision-dispatch'),revision);
 const value={...revision,deliveryRef:'revision-package'};f.setDelivery(false);
 await assert.rejects(f.service.recordRevisionDelivery(scope,cmd('revision-delivery'),value),/real_revision_delivery_required/);
 f.setDelivery(true);await f.service.recordRevisionDelivery(scope,cmd('revision-delivery'),value);await f.service.recordRevisionDelivery(scope,cmd('revision-delivery-replay'),value);
 const pool=(await f.service.read(scope))!,order=pool.orders.root;
 assert.equal(order.state,'delivered');assert.equal(order.productionTaskId,'root');assert.equal(order.deliveryRef,'original-package');
 assert.equal(Object.keys(pool.orders).length,1);assert.equal(pool.slots.filter(s=>s.contentId).length,1);
 assert.equal(order.revisions![0].deliveries!.length,1);assert.equal(order.revisions![0].deliveries![0].deliveryRef,'revision-package');assert.equal(f.verifiedTaskIds.at(-1),'child');
 await assert.rejects(f.service.recordRevisionDelivery(scope,cmd('unregistered'),{...value,executionTaskId:'stranger'}),/revision_delivery_binding_required/);
 // A same-task new production revision also has an independent delivery log.
 await f.service.registerRevisionDispatch(scope,cmd('same-task-dispatch'),{...revision,executionTaskId:'root'});
 await f.service.recordRevisionDelivery(scope,cmd('same-task-delivery'),{...value,executionTaskId:'root',deliveryRef:'same-task-revision-package'});
 assert.equal((await f.service.read(scope))!.orders.root.revisions![1].deliveries![0].deliveryRef,'same-task-revision-package');
 assert.equal((await f.service.read(scope))!.orders.root.deliveryRef,'original-package');
});
