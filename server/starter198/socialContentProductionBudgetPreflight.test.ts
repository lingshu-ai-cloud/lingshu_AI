import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore as SequentialDiskStore } from '../../scripts/langgraphTestStore.js';
// This suite runs each isolated disk store in one process; its synchronous
// compare-and-write is atomic within this controlled fixture only. Do not
// advertise the sequential subprocess helper as a production CAS backend.
class LangGraphTestStore extends SequentialDiskStore {
  supportsAtomicCompareAndSwap(){return true;}
  override async create<T = import('../storage/datastore.js').Record_>(collection:string,data:Record<string,unknown>):Promise<T|null>{
    if(collection===STARTER_COLLECTIONS.access)await super.create('social_programs',{id:`program-${data.tenant_id}`,tenant_id:data.tenant_id,program_id:`program-${data.tenant_id}`});
    return super.create<T>(collection,data);
  }
}
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import { createSocialContentTask, startSocialContentTask } from './socialContentTasks.js';
import { parseCreateSocialTask, socialJson, socialObject, socialRequestHash } from './socialContentValidation.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { parseStoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { admitContentExecutionJob } from '../contentExecution/durableQueue.js';
import {createProductionBudgetRuntimeReaders} from './socialContentProductionBudgetRuntimeReaders.js';
import { formalPaidRouteExceedsInternalBudget, prepareSocialContentProductionBudget, productRetryReservationShotIds } from './socialContentProductionBudgetPreflight.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';

test('product budget bounds are bound to the reviewed supply plan', () => {
  const source=fs.readFileSync(new URL('./socialContentProductionBudgetPreflight.ts',import.meta.url),'utf8');
  assert.match(source,/readProductReplacementRequestBounds[\s\S]*?frozenSupplyPlan:input\.supplyPlan![\s\S]*?planVersion:String\(input\.supplyPlan!\.planVersion\)[\s\S]*?planHash:socialRequestHash\(input\.supplyPlan\)/);
});

test('formal paid route amount admission is exempt only for the exact configured tenant', () => {
  const configured = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  try {
    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'local_tenant_customer_aurelia_beauty';
    assert.equal(formalPaidRouteExceedsInternalBudget('local_tenant_customer_aurelia_beauty', 12, 10), false);
    assert.equal(formalPaidRouteExceedsInternalBudget('another-tenant', 12, 10), true);
    assert.equal(formalPaidRouteExceedsInternalBudget('local_tenant_customer_aurelia_beauty-suffix', 12, 10), true);
  } finally {
    if (configured === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = configured;
  }
});

test('whole-film preflight reserves one retry only for retry-enabled generated product shots', () => {
  const shots = [
    {shotId:'product-retry',sourceStrategy:'aigc_product_scene_replication',productSceneReplication:{validation:{singleShotRetryOnFailure:true}}},
    {shotId:'product-no-retry',sourceStrategy:'aigc_product_scene_replication',productSceneReplication:{validation:{singleShotRetryOnFailure:false}}},
    {shotId:'local',sourceStrategy:'owned_exact_local_video',productSceneReplication:{validation:{singleShotRetryOnFailure:true}}},
  ] as never;
  assert.deepEqual(productRetryReservationShotIds(shots, []), ['product-retry']);
  assert.deepEqual(productRetryReservationShotIds(shots, ['product-retry', 'local', 'unknown']), ['product-retry']);
});
async function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'real-budget-preflight-')), store = new LangGraphTestStore(path.join(root, 'business.json')), repository = createStarter198Repository(store), tenantId = 'budget-tenant', userId = 'owner', now = new Date(); await store.create(STARTER_COLLECTIONS.access, { tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1', entitlement_snapshot_id: 'test', feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })), resource_limits: STARTER_198_DEFAULT_LIMITS, status: 'active', cycle_started_at: new Date(now.getTime() - 86400000).toISOString(), cycle_ends_at: new Date(now.getTime() + 86400000).toISOString() }); const value = parseCreateSocialTask({ title: 'Budget entry contract', objective: 'Actual production preflight', mode: 'instant', themeId: 'customization_process', productionApproach: 'material_polish', perItemBudgetCny: 10 }); delete value.materialRoutingPolicyVersion; const task = await createSocialContentTask({ repository, tenantId, userId, idempotencyKey: 'create-budget-test', value }); const started = await startSocialContentTask({ repository, tenantId, userId, taskId: task.taskId, expectedVersion: task.version, idempotencyKey: 'start-budget-test', orchestratorQueue: { enqueue: async () => ({ queueItemId: 'queue-test', runId: 'run-test' }) } }); assert.ok(started.runId); const runId = started.runId!; const job = await admitContentExecutionJob({ dataStore: store, tenantId, userId, taskId: task.taskId, runId, taskType: 'social_content_test' }); const row = await requireSocialTask({ repository, tenantId, taskId: task.taskId }); const baseline = parseStoredSocialScriptBaseline(row!.script_baseline)!; assert.ok(baseline); const detail = await readSocialTaskDetail({ repository, tenantId, taskId: task.taskId }); return { root, store, repository, tenantId, taskId: task.taskId, runId, job, baseline, supplyPlan: detail!.assetSupplyPlan!, clean: () => fs.rmSync(root, { recursive: true, force: true }), enable: async () => { const fresh = await requireSocialTask({ repository, tenantId, taskId: task.taskId }); await store.update(STARTER_COLLECTIONS.socialContentTasks, fresh.id, { brief: { ...socialObject(socialJson(fresh!.brief)), materialRoutingPolicyVersion: 'type-aware.v1' } }); } }; }
test('historical admission remains read only and does not suddenly provision a new budget', async () => { const f = await fixture(); try {
    const result = await prepareSocialContentProductionBudget({ ...f, assets: [] });
    assert.equal(result.status, 'legacy');
    assert.equal(fs.existsSync(path.join(f.root, 'task-budget')), false);
}
finally {
    f.clean();
} });
test('normal marked task stops before paid analysis when actual voice or supplier route data is missing', async () => { const f = await fixture(); try {
    await f.enable();
    let quotes = 0;
    await assert.rejects(prepareSocialContentProductionBudget({ ...f, assets: [], ports: { ledgerRoot: path.join(f.root, 'task-budget'), readTariff: async () => { quotes++; return null; } } }), /selected_voice_runtime_route_missing/);
    assert.equal(quotes, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'task-budget')), false);
    const job = await f.store.getById<Record<string, any>>('content_execution_jobs', f.job.id);
    assert.equal(Boolean(job!.checkpoints?.['social.whole_film_budget']), false);
}
finally {
    f.clean();
} });
test('recovery cannot reset costs or freshly quote without original same-job whole film reservation', async () => { const f = await fixture(); try {
    await f.enable();
    let quote = 0;
    await assert.rejects(prepareSocialContentProductionBudget({ ...f, assets: [], recoveryOnly: true, ports: { readTariff: async () => { quote++; return null; }, ledgerRoot: path.join(f.root, 'task-budget') } }), /existing_whole_film_reservation_missing/);
    assert.equal(quote, 0);
}
finally {
    f.clean();
} });
test('superseded task run is rejected before any provider or quote', async () => { const f = await fixture(); try {
    await f.enable();
    await f.store.update(STARTER_COLLECTIONS.socialContentTasks, (await requireSocialTask(f)).id, { run_id: 'different-run' });
    await assert.rejects(prepareSocialContentProductionBudget({ ...f, assets: [] }), /run_superseded/);
}
finally {
    f.clean();
} });

// Presenter selection, native voice planning and pricing use production
// defaults; only official GET responses and the isolated business store are controlled.
test('default presenter route prices static review work before preparation and reads official IV pricing', async () => {
 const f=await fixture(); const originalFetch=globalThis.fetch, oldKey=process.env.HEYGEN_API_KEY, oldDash=process.env.DASHSCOPE_API_KEY,oldSeedream=process.env.SEEDREAM_API_KEY;
 const gets:string[]=[];
 try {
  await f.enable();
  f.baseline.language='en';f.baseline.scenes=f.baseline.scenes.map(scene=>({...scene,voiceover:'Welcome to our company.',narration:'Welcome to our company.'}));
  await f.store.update(STARTER_COLLECTIONS.socialContentTasks,(await requireSocialTask(f)).id,{script_baseline:f.baseline});
  await f.store.create('studio_production_defaults',{tenant_id:f.tenantId,payload:{presenters:[{id:'enterprise-person',authorized:true,assetVersion:4,avatarId:'original-look',voiceId:'original-voice',rightsEvidence:{authorizationRef:'rights://original',consentRef:'consent://original',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}}]}});
  process.env.HEYGEN_API_KEY='controlled-key';process.env.DASHSCOPE_API_KEY='controlled-native';process.env.SEEDREAM_API_KEY='controlled-seedream';
  const row=(...cells:string[])=>({cells:cells.map(text=>({content:[{text}]}))});
  const price='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{articleContent:{articleId:'10060327',blocks:[{rows:[row('Video Generation with Avatar IV engine','Price per 1 minute, charged by actual seconds generated','Credits per min'),row('Photo Avatar','$2.31','46'),row('Digital Twin','$4.83','97'),row('Studio Avatar','$4.83','97'),row('Video Generation with Avatar III engine','Price per 1 minute, charged by actual seconds generated','Credits per min'),row('Digital Twin','$0.60','12')]}]}}}})+'</script>';
  globalThis.fetch=async (url,init)=>{ const u=String(url);assert.ok(!init?.method||init.method==='GET');gets.push(u);let body:string;
   if(u.includes('/avatars/looks/'))body=JSON.stringify({data:{id:'original-look',avatar_type:'digital_twin',supported_api_engines:['avatar_iv'],status:'completed'}});
   else if(u.endsWith('/users/me'))body=JSON.stringify({data:{billing_type:'wallet',wallet:{currency:'usd',remaining_balance:20}}});
   else if(u.includes('ecb.europa.eu'))body=`<Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time='${new Date().toISOString().slice(0,10)}'><Cube currency='USD' rate='1.12'/><Cube currency='CNY' rate='7.49'/></Cube></Cube></Envelope>`;
   else if(u.includes('heygen'))body=price;
   else if(u.includes('help.aliyun.com'))body='window.__ICE_PAGE_PROPS__='+JSON.stringify({docDetailData:{storeData:{data:{alias:'/model-studio/model-pricing',website:'cn',language:'zh',content:'<h4 id="千问3-tts-flash">千问3-TTS-Flash</h4>输入单价（每万字符）<table><tr><td>qwen3-tts-flash</td><td>0.8元</td><td>不计费</td></tr></table><h4 id="新加坡">新加坡</h4><h3 id="千问asr">千问ASR</h3>按输入音频的秒数计费<table><tr><td>qwen3-asr-flash-filetrans</td><td rowspan="2">0.00022元/秒</td><td>不计费</td></tr><tr><td>qwen3-asr-flash</td><td>试用36,000秒</td></tr></table><h4 id="新加坡">新加坡</h4>'}}}})+';';
   else throw Error('Unexpected controlled GET '+u);
   const r=new Response(body,{status:200});Object.defineProperty(r,'url',{value:u});return r;
  };
  const supplyPlan={...f.supplyPlan,shots:f.supplyPlan.shots.map(shot=>({...shot,sourceStrategy:'authorized_digital_presenter' as const,sourceRefs:[],fallbackStrategies:[],digitalHumanPlan:{workflow:'material_processing' as const,method:'talking' as const,presenterAssetIds:['enterprise-person'],referenceMaterialIds:[],referenceRequired:false,candidateTools:['heygen'],executionState:'ready_for_capability_check' as const}}))};
  const readers=createProductionBudgetRuntimeReaders({tenantId:f.tenantId,requiresMeasuredAlignment:true,env:{...process.env,MINIMAX_API_KEY:'',MINIMAX_API_TOKEN:''}});
  const admissionOrder:string[]=[];
  const staticTariff=async(intent:any)=>['first_frame','first_frame_qa'].includes(intent.stage)?{provider:intent.provider,model:intent.model,accountRef:intent.accountRef,stage:intent.stage,currency:'CNY' as const,verifiedAccountPrice:true,pricingBasis:'negotiated_verified_account' as const,evidenceRef:`controlled:${intent.operationId}`,checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),meters:Object.fromEntries(Object.keys(intent.maximumUnits).map(key=>[key,{priceCny:key==='outputImages'?.12:.000001,unitsPerPrice:1,minimumUnits:0,increment:1}]))}:null;
  const quoteRoot=path.join(f.root,'readonly-task-budget');
  const quoted=await prepareSocialContentProductionBudget({...f,supplyPlan,assets:[],quoteOnly:true,ports:{...readers,ledgerRoot:quoteRoot,readTariff:staticTariff,
    preparePresenterFirstFrameReviews:async()=>{throw Error('readonly_quote_must_not_generate');},readConfirmedPresenterFirstFrame:async()=>{throw Error('readonly_quote_must_not_confirm');}}});
  assert.equal(quoted.status,'quoted');assert.ok(quoted.status==='quoted');
  assert.ok(quoted.items.length>0&&quoted.items.every(item=>item.quoteRef));
  assert.ok(quoted.wholeTaskUpperBoundCny>0);assert.equal(quoted.maximumCny,10);
  assert.equal(fs.existsSync(quoteRoot),false);
  const quoteJob=await f.store.getById<any>('content_execution_jobs',f.job.id);
  assert.equal(Boolean(quoteJob?.checkpoints?.['social.whole_film_budget']),false);
  await assert.rejects(prepareSocialContentProductionBudget({...f,supplyPlan,assets:[],ports:{...readers,ledgerRoot:path.join(f.root,'unapproved-task-budget'),
    preparePresenterFirstFrameReviews:async({groups})=>{admissionOrder.push(`prepare:${groups.length}`);},
    readConfirmedPresenterFirstFrame:async()=>{admissionOrder.push('confirm');return null;},
    readTariff:async intent=>{admissionOrder.push('tariff');return staticTariff(intent);},
  }}),/presenter_first_frame_confirmation_missing/);
  assert.ok(admissionOrder.indexOf('tariff')>=0&&admissionOrder.indexOf('tariff')<admissionOrder.indexOf('prepare:1'));
  assert.deepEqual(admissionOrder.slice(-2),['prepare:1','confirm']);
  const result=await prepareSocialContentProductionBudget({...f,supplyPlan,assets:[],ports:{...readers,ledgerRoot:path.join(f.root,'task-budget'),readTariff:staticTariff,preparePresenterFirstFrameReviews:async()=>{},readConfirmedPresenterFirstFrame:async()=>({approval:{},decision:{}} as never)}});
  assert.equal(result.status,'reserved');assert.ok(result.status==='reserved');
  const frozenPlan={scope:result.scope,authorizationRef:'frozen-task-budget',maximumCny:10,paidOperations:result.reserved.intents};
  const frozenCheckpoint={version:'1',inputHash:result.scope.planHash,updatedAt:new Date().toISOString(),payload:{scopeHash:paidProductionHash(result.scope),baselineHash:socialRequestHash(f.baseline),operationIds:result.reserved.operations.map(operation=>operation.operationId),requirements:result.requirements,routeBindings:result.routeBindings,quotes:result.reserved.quotes,plan:frozenPlan}};
  const rawJob=await f.store.getById<any>('content_execution_jobs',f.job.id);await f.store.update('content_execution_jobs',f.job.id,{checkpoints:{...(rawJob?.checkpoints||{}),'social.whole_film_budget':frozenCheckpoint}});
  let requotes=0;const recovered=await prepareSocialContentProductionBudget({...f,supplyPlan,assets:[],ports:{ledgerRoot:path.join(f.root,'task-budget'),readTariff:async()=>{requotes++;return null;},preparePresenterFirstFrameReviews:async()=>{},readConfirmedPresenterFirstFrame:async()=>({approval:{},decision:{}} as never)}});
  assert.equal(recovered.status,'reserved');assert.equal(requotes,0);
  const presenterRequirements=result.requirements.filter(r=>r.stage==='presenter_video');
  assert.equal(presenterRequirements.length,1);assert.ok(presenterRequirements.every(r=>r.sourceRef===null));
  assert.deepEqual(presenterRequirements[0]!.presenterGroupShotIds,supplyPlan.shots.map(shot=>shot.shotId));assert.equal(presenterRequirements[0]!.shotId,null);assert.equal(presenterRequirements[0]!.presenterAssetId,'enterprise-person');
  for(const requirement of presenterRequirements){const boundRoute:{provider:string;model:string;routeEvidenceRef:string}|undefined=result.routeBindings[requirement.key];assert.ok(boundRoute);assert.equal(boundRoute.provider,'heygen');assert.equal(boundRoute.model,'avatar_iv');assert.match(boundRoute.routeEvidenceRef,/^heygen-approved-person:/);}
  const quotes=Object.values(result.reserved.quotes);const ivQuotes=quotes.filter(q=>q.nativePricing?.currency==='USD');assert.equal(ivQuotes.length,1);assert.ok(ivQuotes.every(q=>q.nativePricing?.usdPerMinute===4.83));assert.ok(quotes.reduce((n,q)=>n+q.upperBoundCny,0)<=10);
  assert.ok(gets.some(u=>u.endsWith('/avatars/looks/original-look')));
  assert.ok(gets.some(u=>u.endsWith('/users/me')));
  assert.ok(gets.some(u=>u.includes('10060327')));
  assert.ok(gets.some(u=>u.includes('ecb.europa.eu')));
 } finally {globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.HEYGEN_API_KEY;else process.env.HEYGEN_API_KEY=oldKey;if(oldDash===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=oldDash;if(oldSeedream===undefined)delete process.env.SEEDREAM_API_KEY;else process.env.SEEDREAM_API_KEY=oldSeedream;f.clean();}
});
