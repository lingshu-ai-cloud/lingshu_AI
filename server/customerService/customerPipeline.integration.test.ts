import { controlledMessengerAccount } from '../messenger/controlledCapability.fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { createCustomerReplyRequests } from './replyRequests.js';
import { createCustomerBatchesRouter } from '../routes/customerBatches.js';
import { createCustomerBatchService } from './customerBatchService.js';
import { createCustomerSegmentSnapshot, eligibleFollowupCustomerIds, DEFAULT_FOLLOWUP_SEGMENT_CRITERIA, createFollowupBatch, applyFollowupBatchDecision } from '../digitalEmployees/customerWorkflow.js';
import { projectCustomerBusinessProfile, buyerConversationFingerprint } from './businessProfile.js';
import { parseCustomerCriteria } from '../../shared/contracts/customerSegmentation.js';
import { nativeDispatchFixture } from '../digitalEmployees/weeklyNativeFollowupDispatch.fixture.js';
import { readWeeklyCustomerStep } from '../runtime/socialWeeklyCustomerBridge.js';
import { store as runtimeStore } from '../storage/index.js';
function memory() {
  const rows:Record<string,Record_[]>={}; let serial=0;
  const store:DataStore={getById:async<T>(c:string,id:string)=>(rows[c]?.find(r=>r.id===id)??null) as T|null,
    list:async<T>(c:string,q:any={})=>{let all=(rows[c]||[]).filter(r=>Object.entries(q.where||{}).every(([k,v])=>r[k]===v));if(q.sort==='-version')all=[...all].sort((a,b)=>Number(b.version)-Number(a.version));const page=q.page||1,per=q.perPage||250;return{items:all.slice((page-1)*per,page*per) as T[],totalItems:all.length,totalPages:Math.ceil(all.length/per),page,perPage:per};},
    create:async<T>(c:string,p:Record<string,unknown>)=>{const row={id:`r${++serial}`,...structuredClone(p)} as Record_;if((rows[c]||[]).some(r=>r.id===row.id))return null;(rows[c]??=[]).push(row);return structuredClone(row) as T;},
    update:async(c,id,p)=>{const row=rows[c]?.find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(p));return true;},delete:async()=>false};
  return{rows,store};
}
async function http(app:ReturnType<typeof express>,run:(url:string)=>Promise<void>) {
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
const input={customerId:'buyer',timeline:[{actor:'buyer',body:'Hello'}],requestId:'request-1234'};
test('reply HTTP contract rejects unknown input, persists facts/decision, replays once and isolates actors',async()=>{
  const f=memory();let calls=0;const requests=createCustomerReplyRequests(f.store,async()=>{calls++;return{status:200,factVersion:'facts-v2',body:{draft:'Hello.',verification:{status:'verified',issues:[]}}};});
  const app=express();app.use(express.json(),(req,res,next)=>{res.locals.tenantId=req.headers['x-tenant']||'tenant';res.locals.userId='actor';next();});app.post('/draft',requests.execute);app.get('/draft/:requestId',requests.read);
  await http(app,async url=>{
    const post=(body:unknown)=>fetch(`${url}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({...input,intent:'unknown'})).status,400);assert.equal((await post({...input,randomField:true})).status,400);assert.equal(calls,0);
    const first=await post(input);assert.equal(first.status,200);const result=await first.json();assert.equal(result.enterpriseFactVersion,'facts-v2');assert.equal(result.decision.execution,'draft');assert.equal(result.status,'succeeded');
    assert.deepEqual(await (await post(input)).json(),result);assert.equal(calls,1);
    assert.equal((await post({...input,instruction:'different'})).status,409);
    assert.equal((await fetch(`${url}/draft/request-1234`,{headers:{'x-tenant':'foreign'}})).status,404);
  });
});
test('timeout retains original pending request and accepts late result without a second generation',async()=>{
  const f=memory();let release!:(v:any)=>void;let calls=0;
  const requests=createCustomerReplyRequests(f.store,async()=>{calls++;return new Promise(r=>{release=r;});},5);
  const app=express();app.use(express.json(),(_req,res,next)=>{res.locals.tenantId='tenant';res.locals.userId='actor';next();});app.post('/draft',requests.execute);app.get('/draft/:requestId',requests.read);
  await http(app,async url=>{
    const post=()=>fetch(`${url}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    assert.equal((await post()).status,202);const unknown=await post();assert.equal(unknown.status,409);assert.equal((await unknown.json()).code,'customer_reply_generation_outcome_unknown');assert.equal(calls,1);
    release({status:200,factVersion:'v1',body:{draft:'Safe bridge.',verification:{status:'safe_fallback',issues:['provider_unavailable']}}});
    await new Promise(r=>setImmediate(r));const result=await(await fetch(`${url}/draft/request-1234`)).json();assert.equal(result.status,'degraded');assert.equal(result.generationSource,'degraded');assert.equal(calls,1);
  });
});
test('partial segment write resumes frozen children after source changes; never advertises incomplete generated',async()=>{
  const f=memory();const create=f.store.create;let failed=false;
  f.store.create=async(c,p)=>{if(c==='customer_segment_members'&&p.customer_id==='b'&&!failed){failed=true;throw Error('disk_failure');}return create(c,p);};
  const command={tenantId:'tenant',runId:'run',goalId:'goal',taskId:'segment',userId:'actor',criteria:{tagsAll:['询价中']}};
  const customers=async()=>[{id:'a',tags:['询价中']},{id:'b',tags:['询价中']}];
  await assert.rejects(createCustomerSegmentSnapshot(command,customers,f.store),/disk_failure/);assert.equal(f.rows.customer_segments[0]!.status,'building');
  const result=await createCustomerSegmentSnapshot(command,async()=>[],f.store);assert.equal(result.members.length,2);assert.equal(result.segment.status,'generated');assert.equal(result.segment.member_count,2);assert.equal(result.created,false);
});
test('criteria reject unknown dimensions and ranges, distinguish all/any/none and preserve low-score exclusion',()=>{
  assert.throws(()=>parseCustomerCriteria({typoTag:['x']}),/customer_criteria_invalid/);
  assert.throws(()=>parseCustomerCriteria({inactiveDaysMin:40,inactiveDaysMax:10}),/customer_criteria_invalid/);
  const buyers=[{id:'low',stage:'inquiry',intentScore:10,tags:['询价中']},{id:'high',stage:'inquiry',intentScore:90,tags:['询价中','预算已提供']}];
  assert.deepEqual(eligibleFollowupCustomerIds(buyers,DEFAULT_FOLLOWUP_SEGMENT_CRITERIA),['high']);
  assert.deepEqual(eligibleFollowupCustomerIds(buyers,{tagsAll:['询价中','预算已提供']}),['high']);
  assert.deepEqual(eligibleFollowupCustomerIds(buyers,{tagsAny:['询价中','预算已提供'],tagsNone:['预算已提供']}),['low']);
});
test('proved classification does not restore stale account data and buyer revocation removes obsolete tags',()=>{
  const timeline=[{id:'m1',actor:'buyer',body:'Please send samples',timestamp:1000}];
  const meta={contextTagsAnalysisVersion:5,contextTagsBuyerFingerprint:buyerConversationFingerprint(timeline),contextTagEvidence:[{tag:'索取样品',messageId:'m1',excerpt:'Please send samples'}],summary:'foreign cached summary'};
  const valid=projectCustomerBusinessProfile({timeline},meta);assert.deepEqual(valid.tags,['索取样品']);assert.equal(valid.summary,undefined);
  const changed=[...timeline,{id:'m2',actor:'buyer',body:'No samples',timestamp:2000}];assert.deepEqual(projectCustomerBusinessProfile({timeline:changed},meta).tags,[]);
});
test('batch management HTTP preview, classification, new-customer screen and stale preview isolation',async()=>{
  const f=memory();f.rows.workflow_runs=[{id:'run',tenant_id:'tenant',goal_id:'goal',status:'running'}];f.rows.weekly_goals=[{id:'goal',tenant_id:'tenant',starts_at:'2026-10-01',ends_at:'2026-10-07'}];f.rows.workflow_tasks=[{id:'seg-task',tenant_id:'tenant',run_id:'run',task_key:'customer_segmentation',agent_role:'customer'}];
  const stampedAt=Date.now()-1000;let body='Please send samples';const read=async()=>[{id:'buyer',tenantId:'tenant',accountId:'account',accountHash:'a',source:'messenger',timeline:[{id:'m1',actor:'buyer',body,timestamp:stampedAt}]}];
  const service=createCustomerBatchService(f.store,{read,classify:async()=>[{tag:'索取样品',messageId:'m1',excerpt:body}]});
  const app=express();app.use(express.json());app.use('/batches',createCustomerBatchesRouter(service,(_req,res,next)=>{res.locals.tenantId='tenant';res.locals.userId='actor';res.locals.browserReadRole='customer_service';next();}));
  await http(app,async url=>{
    const post=(path:string,body:unknown)=>fetch(`${url}/batches/runs/run/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('preview',{criteria:{unknown:'x'}})).status,400);
    await post('classify',{customerIds:['buyer']});const criteria={purpose:'screen',managementAction:'screen',tagsAll:['索取样品']};
    const p=await(await post('preview',{criteria})).json();assert.equal(p.counts.included,1);assert.equal((await f.store.list('customer_segments')).totalItems,0);
    const freeze=await post('segments',{criteria,expectedPreviewHash:p.previewHash});assert.equal(freeze.status,201);const saved=await freeze.json();assert.equal(saved.messagesSent,0);assert.equal(saved.segment.member_count,1);
    assert.equal((await post('segments',{criteria,expectedPreviewHash:p.previewHash})).status,201);assert.equal(f.rows.customer_segments.length,1);
    body='No samples';assert.equal((await post('segments',{criteria,expectedPreviewHash:p.previewHash})).status,409);
    await assert.rejects(service.preview('foreign','run',{}),/not_found/);
  });
});
test('actual new-inquiry segmentation through draft, approval, native send and durable weekly proof, with replay',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-06T12:00:00Z')});
  const f=await nativeDispatchFixture('messenger',false,'account_repair',()=>new Date());const old={getById:runtimeStore.getById,list:runtimeStore.list,create:runtimeStore.create,update:runtimeStore.update};
  for(const key of Object.keys(old) as Array<keyof typeof old>)(runtimeStore as any)[key]=(f.store[key] as Function).bind(f.store);
  try{
    f.data.followup_batches=[];f.data.followup_batch_items=[];
    const selection=(f.data.customer_segment_members![0]!.customer_snapshot as any).weeklyChannelSelection;
    f.source.customerSnapshot={timeZone:'UTC',language:'English'};
    const customers=async()=>[{id:'buyer',tenantId:'tenant',source:'messenger',accountId:'account',accountHash:selection.accountHash,weeklyChannelSelection:selection,timeline:f.source.messages,timeZone:'UTC',language:'English'}];
    const management=createCustomerBatchService(f.store,{read:customers,now:()=>Date.now()});
    const criteria={purpose:'new_inquiry' as const,managementAction:'draft' as const,relationships:['new_inquiry' as const]};
    const p=await management.preview('tenant','run',criteria);assert.equal(p.counts.included,1);
    const frozen=await management.freeze('tenant','owner','run',criteria,p.previewHash);
    const generated=await createFollowupBatch({tenantId:'tenant',runId:'run',goalId:String(frozen.segment.goal_id),taskId:'followup_batch_draft',segmentId:frozen.segment.id,userId:'owner',draftOverrides:{buyer:'Please confirm your preferred specification.'},enterpriseProfile:{} as any},customers);
    assert.equal(generated.items.length,1);assert.equal(generated.items[0]!.status,'draft');
    const approval=f.data.approval_requests![0]!;Object.assign(approval,{subject_version:generated.batch.version,content_hash:generated.batch.content_hash,status:'approved'});
    await applyFollowupBatchDecision({tenantId:'tenant',batchId:generated.batch.id,userId:'owner',decision:'approved',approvalId:String(approval.id)},f.store);
    for(const task of f.data.workflow_tasks!)if(['customer_segmentation','followup_batch_draft','followup_batch_approval'].includes(String(task.task_key)))task.status='succeeded';
    const command={...f.command,batchId:generated.batch.id,itemId:generated.items[0]!.id,expectedBatchVersion:generated.batch.version,expectedItemHash:generated.items[0]!.content_hash};
    await assert.rejects(f.service.dispatch(command),/schedule_not_due/);
    t.mock.timers.tick(Date.parse(generated.items[0]!.scheduled_at)-Date.now());
    f.data.social_accounts=[controlledMessengerAccount({accountId:'account',tenantId:'tenant',pageId:'native-account'})];
    const result=await f.service.dispatch(command);assert.equal(result.status,'sent');assert.equal(f.sends(),1);assert.equal((await f.service.dispatch(command)).messagesSent,0);assert.equal(f.sends(),1);
    const proof=await readWeeklyCustomerStep(f.store,{tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1},'run','customer_followup_dispatch');assert.equal(proof.status,'succeeded');
  }finally{Object.assign(runtimeStore,old);f.restore();}
});

test('old-contact reactivation and recorded-order repurchase include silent won customers without claiming gateway payment',async()=>{
  const f=memory();const now=Date.parse('2026-10-22T12:00:00Z');
  f.rows.workflow_runs=[{id:'run',tenant_id:'tenant',goal_id:'goal',status:'running'}];f.rows.weekly_goals=[{id:'goal',tenant_id:'tenant',starts_at:'2026-10-19',ends_at:'2026-10-25'}];f.rows.workflow_tasks=[{id:'seg-task',tenant_id:'tenant',run_id:'run',task_key:'customer_segmentation',agent_role:'customer'}];
  f.rows.whatsapp_customers=[{id:'buyer-store',tenant_id:'tenant',customer_id:'old',payload:{id:'old',tenantId:'tenant'}}];
  f.rows.whatsapp_interactions=[{id:'first',tenant_id:'tenant',customer_id:'old',interaction_id:'first',payload:{id:'first',tenantId:'tenant',customerId:'old',type:'msg_in',body:'We need to restock',timestamp:now-90*86400000,metaMessageId:'wamid.first'}}];
  f.rows.tenant_orders=[{id:'ledger-order',tenant_id:'tenant',order_no:'O1',order:{customerId:'old',orderNo:'O1',status:'paid',orderDate:'2026-07-01'}}];
  const read=async()=>[{id:'old',tenantId:'tenant',accountId:'account',accountHash:'proof',waNumber:'15551234567',source:'whatsapp',timeline:[{id:'first',actor:'buyer',body:'We need to restock',timestamp:now-90*86400000}]}];
  const service=createCustomerBatchService(f.store,{read,now:()=>now,classify:async()=>[{tag:'补货采购',messageId:'first',excerpt:'We need to restock'}]});
  await service.classify('tenant','run',['old']);
  const p=await service.preview('tenant','run',{purpose:'reactivate',relationships:['existing_contact'],inactiveDaysMin:60,tagsAll:['补货采购']});assert.equal(p.counts.included,1);
  const repurchase=await service.preview('tenant','run',{purpose:'repurchase',purchase:'recorded_paid',stages:['won']});assert.equal(repurchase.counts.included,1);
  assert.equal((repurchase.rows[0]!.evidence.facts as any).purchaseEvidence[0].verification,'recorded_not_payment_gateway');
  assert.equal((await service.preview('tenant','run',{purpose:'new_inquiry',relationships:['new_inquiry']})).counts.included,0);
  const fingerprint=buyerConversationFingerprint((await read())[0]!.timeline);
  await assert.rejects(service.reviewProfile('tenant','owner','run','old',fingerprint,{language:'English',timeZone:'invalid/timezone'}),/time_zone_invalid/);
  await service.reviewProfile('tenant','owner','run','old',fingerprint,{language:'English',timeZone:'America/New_York'});
  assert.equal((await service.profiles('tenant','run'))[0]!.timeZone,'America/New_York');
});
test('batch child-write interruption resumes exact frozen bodies and schedules; approval write failure is never success',async()=>{
  const f=memory();f.rows.customer_segments=[{id:'segment',tenant_id:'tenant',run_id:'run',status:'generated',criteria:{purpose:'reactivate'}}];f.rows.customer_segment_members=['a','b'].map(id=>({id,tenant_id:'tenant',segment_id:'segment',customer_id:id,membership:'included',customer_snapshot:{id},risk_level:'low'}));
  const old={getById:runtimeStore.getById,list:runtimeStore.list,create:runtimeStore.create,update:runtimeStore.update};let injected=false;const create=f.store.create;
  f.store.create=async(c,p)=>{if(c==='followup_batch_items'&&p.customer_id==='b'&&!injected){injected=true;throw Error('partial_disk_failure');}return create(c,p);};
  for(const key of Object.keys(old) as Array<keyof typeof old>)(runtimeStore as any)[key]=(f.store[key] as Function).bind(f.store);
  try{
    const command={tenantId:'tenant',runId:'run',goalId:'goal',taskId:'draft',segmentId:'segment',userId:'owner',enterpriseProfile:{} as any,draftOverrides:{a:'Hello A',b:'Hello B'}};
    const read=async()=>['a','b'].map(id=>({id,waNumber:'15551234567',timeZone:'UTC',language:'en',timeline:[{actor:'buyer',timestamp:Date.now(),body:'Hello'}]}));
    await assert.rejects(createFollowupBatch(command,read),/partial_disk_failure/);assert.equal(f.rows.followup_batches[0]!.status,'building');
    const resumed=await createFollowupBatch({...command,draftOverrides:{a:'changed',b:'changed'}},async()=>[]);assert.equal(resumed.batch.status,'draft');assert.deepEqual(resumed.items.map(i=>i.draft_body),['Hello A','Hello B']);
    const update=f.store.update;f.store.update=async(c,id,p)=>c==='followup_batch_items'?false:update(c,id,p);
    await assert.rejects(applyFollowupBatchDecision({tenantId:'tenant',batchId:resumed.batch.id,userId:'owner',decision:'approved'},f.store),/approval_item_write_failed/);
  }finally{Object.assign(runtimeStore,old);}
});
test('parent route registration includes real WeCom entry and refreshed Messenger proof preserves unchanged authority',async t=>{
  const {mountWhatsAppOAuthRoutes}=await import('../routes/whatsappParentMount.js');const paths:string[]=[];mountWhatsAppOAuthRoutes({use:(path:string)=>{paths.push(path);}} as any);
  assert.ok(paths.includes('/api/overseas/wecom-customer-service'));
  const {assertMessengerCapabilityAuthority}=await import('../messenger/capabilityAuthority.js');
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-06T12:00:00Z')});
  const first=controlledMessengerAccount({accountId:'account',tenantId:'tenant',pageId:'page'}),identity=assertMessengerCapabilityAuthority(first);
  t.mock.timers.tick(11*60*1000);assert.throws(()=>assertMessengerCapabilityAuthority(first),/expired/);
  assert.equal(assertMessengerCapabilityAuthority(controlledMessengerAccount({accountId:'account',tenantId:'tenant',pageId:'page'})),identity);
});

test('frozen recovery tolerates storage JSON key order while rejecting corrupted child content',async()=>{
 const f=memory();const {buildManifest,completeAggregate}=await import('./aggregateRecovery.js');
 const plan=[{tenant_id:'tenant',customer_id:'a',customer_snapshot:{z:1,a:2}}];
 const manifest=JSON.parse(JSON.stringify(buildManifest(plan)));manifest.children[0]={customer_snapshot:{a:2,z:1},customer_id:'a',tenant_id:'tenant'};
 const parent:any={id:'parent',tenant_id:'tenant',status:'building',member_count:1,excluded_count:0,exclusion_summary:{buildManifest:manifest}};f.rows.customer_segments=[parent];
 const config={collection:'customer_segments',children:'customer_segment_members',foreignKey:'segment_id',metadata:'exclusion_summary',finalStatus:'generated'};
 const result=await completeAggregate(f.store,parent,config);assert.equal(result.children.length,1);
 parent.status='building';f.rows.customer_segment_members[0]!.customer_snapshot={a:99,z:1};
 await assert.rejects(completeAggregate(f.store,parent,config),/child_content_changed/);
});
test('persisted per-customer generation and classification do not repeat a provider after interrupted result storage',async()=>{
 const f=memory();const {durableFollowupDraft}=await import('./durableFollowupDraft.js');let calls=0;const update=f.store.update;
 f.store.update=async()=>false;
 const input={tenantId:'tenant',actorId:'owner',identity:{run:'run',member:'a'}};
 await assert.rejects(durableFollowupDraft(f.store,input,async()=>{calls++;return 'Draft';}),/save_unconfirmed/);
 f.store.update=update;
 await assert.rejects(durableFollowupDraft(f.store,input,async()=>{calls++;return 'Duplicate';}),/outcome_unconfirmed/);assert.equal(calls,1);
});

test('aggregate publication waits for full readback and rejects conflicting recovered writes',async()=>{
 const {buildManifest,completeAggregate}=await import('./aggregateRecovery.js');
 const config={collection:'customer_segments',children:'customer_segment_members',foreignKey:'segment_id',metadata:'exclusion_summary',finalStatus:'generated'};
 for(const mode of ['extra','conflict']){
  const f=memory();const parent:any={id:'parent',tenant_id:'tenant',status:'building',member_count:1,excluded_count:0,exclusion_summary:{buildManifest:buildManifest([{tenant_id:'tenant',customer_id:'a'}])}};
  f.rows.customer_segments=[parent];const create=f.store.create;
  if(mode==='extra')f.rows.customer_segment_members=[{id:'unexpected',tenant_id:'tenant',segment_id:'parent',customer_id:'other'}];
  else f.store.create=async(c,p)=>{await create(c,{...p,customer_id:'tampered'});return null;};
  await assert.rejects(completeAggregate(f.store,parent,config),mode==='extra'?/incomplete/:/child_content_changed/);
  assert.equal(parent.status,'building');
 }
 const f=memory();const batch:any={id:'batch',tenant_id:'tenant',status:'building',counts:{total:1},safety_summary:{buildManifest:buildManifest([{tenant_id:'tenant',customer_id:'a',status:'draft'}])}};
 f.rows.followup_batches=[batch];const batchConfig={collection:'followup_batches',children:'followup_batch_items',foreignKey:'batch_id',metadata:'safety_summary',finalStatus:'draft'};
 await completeAggregate(f.store,batch,batchConfig);batch.status='approved';f.rows.followup_batch_items[0]!.status='sent';
 assert.equal((await completeAggregate(f.store,batch,batchConfig)).children[0]!.status,'sent');
});

test('classification caches preserve source opt-out and human handling restrictions',async()=>{
 const {readCustomerBusinessProfile,customerClassificationId}=await import('./businessProfile.js');const f=memory();
 const customer={id:'buyer',accountId:'account',accountHash:'current',timeline:[{id:'m1',actor:'buyer',body:'Please quote',timestamp:1000}]};
 const id=customerClassificationId('tenant',customer);f.rows.customer_classifications=[{id,tenant_id:'tenant',customer_id:'buyer',payload:{accountHash:'current',contextTagsAnalysisVersion:5,contextTagsBuyerFingerprint:buyerConversationFingerprint(customer.timeline),contextTagEvidence:[]}}];
 const profile=await readCustomerBusinessProfile(f.store,'tenant',customer,{tags:['黑名单'],handlingMode:'human_needed'});
 assert.equal(profile.optedOut,true);assert.equal(profile.handlingMode,'human_needed');assert.deepEqual(eligibleFollowupCustomerIds([profile],{}),[]);
 const projected=projectCustomerBusinessProfile({...customer,optedOut:true,handlingMode:'human_needed'},{});
 assert.equal(projected.optedOut,true);assert.equal(projected.handlingMode,'human_needed');
});

test('native first inquiry requires explicit scoped buyer evidence; unselected native customers remain screen-only',async()=>{
 const f=memory();const now=Date.parse('2026-10-22T12:00:00Z');f.rows.workflow_runs=[{id:'run',tenant_id:'tenant',goal_id:'goal',status:'running'}];f.rows.weekly_goals=[{id:'goal',tenant_id:'tenant',starts_at:'2026-10-19',ends_at:'2026-10-25'}];f.rows.workflow_tasks=[{id:'segment',tenant_id:'tenant',run_id:'run',task_key:'customer_segmentation',agent_role:'customer'}];
 const timeline=[{id:'mid.real',actor:'buyer',body:'Please quote',timestamp:now-1000}];
 const read=async()=>[{id:'buyer',tenantId:'tenant',accountId:'account',accountHash:'current',source:'messenger',timeline}];
 const service=createCustomerBatchService(f.store,{read,now:()=>now});
 assert.equal((await service.preview('tenant','run',{relationships:['new_inquiry']})).counts.included,0);
 await assert.rejects(service.confirmNewInquiry('tenant','owner','run','buyer',{expectedFingerprint:buyerConversationFingerprint(timeline),firstMessageId:'missing',reason:'confirm'}),/unverified/);
 await service.confirmNewInquiry('tenant','owner','run','buyer',{expectedFingerprint:buyerConversationFingerprint(timeline),firstMessageId:'mid.real',reason:'Reviewed the first verified buyer message for this week'});
 const screened=await service.preview('tenant','run',{purpose:'new_inquiry',managementAction:'screen',relationships:['new_inquiry']});assert.equal(screened.counts.included,1);
 const draft=await service.preview('tenant','run',{purpose:'new_inquiry',managementAction:'draft',relationships:['new_inquiry']});assert.equal(draft.counts.included,0);assert.ok(draft.rows[0]!.exclusionReasons.includes('native_channel_selection_required'));
});
test('verified buyer opt-out and restrictive manual handling remain exclusion and review gates after projection',()=>{
 const timeline=[{id:'m1',actor:'buyer',body:'Do not contact me again',timestamp:1000}];const profile=projectCustomerBusinessProfile({id:'buyer',source:'messenger',timeline},{handlingMode:'human_needed'});
 assert.equal(profile.optedOut,true);assert.equal(profile.handlingMode,'human_needed');assert.deepEqual(eligibleFollowupCustomerIds([profile],{}),[]);
 const stale=projectCustomerBusinessProfile({id:'buyer',timeline:[]},{tags:['do not contact']});assert.equal(stale.optedOut,true);
});

test('WeCom real ingress route verifies challenge, persists before ack, rejects invalid signature and replays without processing twice',async()=>{
 const {createWeComCustomerIngress}=await import('../routes/wecomCustomerIngress.js');let saved=0,processed=0;
 const service={verifyCallbackChallenge:async()=> 'verified-echo',ingestCallback:async(input:any)=>{if(input.signature!=='valid')throw Object.assign(Error('invalid_signature'),{status:403});assert.equal(input.rawXml,'<xml/>');saved++;return{callbackId:'callback',duplicate:saved>1,status:'queued' as const,shouldProcess:saved===1};},processCallback:async()=>{assert.ok(saved);processed++;return{callbackId:'callback',status:'processed' as const,pages:1,messages:1};}};
 const app=express();app.use('/callback',createWeComCustomerIngress(service));
 await http(app,async url=>{
  assert.equal(await(await fetch(`${url}/callback/tenant?echostr=encrypted`)).text(),'verified-echo');
  const post=(signature:string)=>fetch(`${url}/callback/tenant?msg_signature=${signature}`,{method:'POST',headers:{'Content-Type':'application/xml'},body:'<xml/>'});
  assert.equal((await post('invalid')).status,403);assert.equal(saved,0);assert.equal(await(await post('valid')).text(),'success');await post('valid');assert.equal(processed,1);
 });
});

test('batch progress filtering uses canonical quote and sealed exception records instead of guessed tags',async()=>{
 const {applyCustomerBusinessProgress}=await import('./businessProgress.js');const {socialRequestHash}=await import('../starter198/socialContentValidation.js');
 const customer={id:'buyer',stage:'inquiry',businessFacts:{lastBuyerAt:Date.parse('2026-10-22T10:00:00Z')}};
 const quote:any={id:'quote',tenant_id:'tenant',customer_id:'buyer',status:'confirmed',updated_at:'2026-10-22T12:00:00Z',payload:{customerId:'buyer',status:'confirmed',confirmedBy:'owner',revision:2,delivery:{status:'sent',sentAt:'2026-10-22T12:00:00Z',providerMessageId:'mid.provider-quote'}}};
 const quoted=applyCustomerBusinessProgress(customer,'tenant','run',[quote],[]);assert.equal(quoted.stage,'quoted');assert.equal(quoted.businessFacts.waitingFor,'customer');
 assert.deepEqual(eligibleFollowupCustomerIds([quoted],{waitingFor:['customer']}),['buyer']);
 const body={requestId:'exception',version:1,scope:{tenantId:'tenant',runId:'run'},customerId:'buyer',kind:'knowledge',status:'requested'};const payload={...body,recordHash:socialRequestHash(body)};
 const row:any={id:'exception-row',tenant_id:'tenant',run_id:'run',request_id:'exception',content_hash:payload.recordHash,payload};
 assert.equal(applyCustomerBusinessProgress(customer,'tenant','run',[],[row]).businessFacts.waitingFor,'knowledge_review');
 row.payload={...payload,customerId:'foreign'};assert.notEqual(applyCustomerBusinessProgress(customer,'tenant','run',[],[row]).businessFacts.waitingFor,'knowledge_review');
});
test('classification reports partial outcomes and reuses completed per-customer work on retry',async()=>{
 const f=memory();f.rows.workflow_runs=[{id:'run',tenant_id:'tenant',goal_id:'goal',status:'running'}];f.rows.weekly_goals=[{id:'goal',tenant_id:'tenant'}];f.rows.workflow_tasks=[{id:'seg',tenant_id:'tenant',run_id:'run',agent_role:'customer',task_key:'customer_segmentation'}];let calls=0;
 const service=createCustomerBatchService(f.store,{read:async()=>[{id:'buyer',tenantId:'tenant',accountId:'a',accountHash:'h',timeline:[{id:'mid.a',actor:'buyer',body:'Hello',timestamp:1}]}],classify:async()=>{calls++;return[];}});
 const result=await service.classify('tenant','run',['buyer','missing'],'owner');assert.equal(result.items[0].status,'succeeded');assert.equal(result.items[1].status,'failed');
 await service.classify('tenant','run',['buyer'],'owner');assert.equal(calls,1);
});

test('missing relationship evidence cannot be frozen as a successful empty customer batch',async()=>{
 const f=memory();f.rows.workflow_runs=[{id:'run',tenant_id:'tenant',goal_id:'goal',status:'running'}];f.rows.weekly_goals=[{id:'goal',tenant_id:'tenant',starts_at:'2026-10-19',ends_at:'2026-10-25'}];f.rows.workflow_tasks=[{id:'seg',tenant_id:'tenant',run_id:'run',agent_role:'customer',task_key:'customer_segmentation'}];
 const service=createCustomerBatchService(f.store,{read:async()=>[{id:'buyer',tenantId:'tenant',accountId:'account',accountHash:'h',source:'messenger',timeline:[{id:'m1',actor:'buyer',body:'Hello',timestamp:Date.parse('2026-10-22T00:00:00Z')}]}]});
 const criteria={relationships:['new_inquiry' as const]};const p=await service.preview('tenant','run',criteria);assert.equal(p.counts.unknown,1);assert.equal(p.counts.included,0);
 await assert.rejects(service.freeze('tenant','owner','run',criteria,p.previewHash),/classification_required/);assert.equal((await f.store.list('customer_segments')).totalItems,0);
});
