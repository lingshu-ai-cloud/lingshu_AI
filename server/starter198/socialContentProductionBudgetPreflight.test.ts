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
import { prepareSocialContentProductionBudget, productRetryReservationShotIds } from './socialContentProductionBudgetPreflight.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';
import {adoptWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from '../socialPrograms/weeklyIndependentAdmission.js';
import {prepareWeeklyCandidateExactProductionEscrow} from '../runtime/weeklyCandidateExactProductionEscrow.js';
import {WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS,WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS} from '../runtime/weeklyCandidateExactAnalysisOperation.js';
import type {WeeklyPreproductionJob} from '../runtime/weeklyPreproductionProducer.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {readWeeklyReferenceSources} from '../runtime/socialWeeklyReferenceSource.js';

test('product budget bounds are bound to the reviewed supply plan', () => {
  const source=fs.readFileSync(new URL('./socialContentProductionBudgetPreflight.ts',import.meta.url),'utf8');
  assert.match(source,/readProductReplacementRequestBounds[\s\S]*?frozenSupplyPlan:input\.supplyPlan![\s\S]*?planVersion:String\(input\.supplyPlan!\.planVersion\)[\s\S]*?planHash:socialRequestHash\(input\.supplyPlan\)/);
  const carry=source.indexOf('carryForwardWeeklyExactCost??carryForwardWeeklyCandidateExactProductionCost');
  const recovery=source.indexOf('if (input.recoveryOnly || prior)');
  const productionReserve=source.indexOf('const reserved = await authority.prepareAndReserve(scope)');
  assert.ok(carry>0&&carry<recovery&&recovery<productionReserve,'settled exact cost is recovered before the original production reservation');
  assert.match(source,/mode:input\.quoteOnly\?'read':'carry'/,'quote-only uses the pure read adapter mode');
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

async function installSettledWeeklyExactCost(f:Awaited<ReturnType<typeof fixture>>,root:string){
 const taskRow=await requireSocialTask(f),order=socialObject(socialJson(taskRow.content_order)),programId=String(order?.programId??'');assert.ok(programId);
 const packageScope={tenantId:f.tenantId,programId,packageId:'weekly-package',packageVersion:7},publication={publicationTaskId:'weekly-publication',accountId:'weekly-account',platform:'tiktok',motherContentId:'weekly-mother',factRefs:[]};
 const slotId='weekly-slot',candidateId='weekly-candidate',operationId='weekly-operation',mediaSha256='1'.repeat(64),sourceUrl='https://www.tiktok.com/@fixture/video/1',accountUrl='https://www.tiktok.com/@oem_factory';
 const handoff={inspirationId:candidateId,analysisId:'weekly-analysis-source',version:'1',analysisVersion:'1',readiness:'production_reference',source:{platform:'tiktok',sourceUrl},taskContext:{taskId:'weekly-consumer',market:'US',audience:'brand buyer'},whySelected:['verified structure'],referenceRole:'primary_structure',reusableLogic:{hookTypes:[],revealOrder:[],proofPlacement:[],pacing:'fast',emotionalProgression:'steady',ctaPosition:'end'},rights:{mayAnalyze:true,mayUseOriginalMedia:false,mayAdapt:true},productionImplications:{requiredEvidence:[],likelyAssetNeeds:[],risks:[]},adaptationBoundary:{reusable:['structure'],mustReplace:['identity'],prohibited:['unsupported claims']},evidenceRefs:[{description:'verified',confidence:1,needsReview:false}]};
 const handoffRef={inspirationId:candidateId,version:'1',recordHash:socialRequestHash(handoff)},analysis={analysisId:'weekly-analysis',packageId:packageScope.packageId,packageVersion:packageScope.packageVersion,slotId,benchmarkAccountRefs:[{type:'social_benchmark_account',id:accountUrl,version:1}],benchmarkVideoRefs:[{type:'candidate',id:candidateId,version:1}],benchmarkEvidenceRefs:[],frozenHandoffRefs:[handoffRef]};
 const scheduleItem={scheduleItemId:'weekly-item',slotId,publicationTaskId:publication.publicationTaskId,accountId:publication.accountId,directorAnalysisRef:{type:'weekly_director_analysis',id:analysis.analysisId,version:1}};
 const workflowTask={taskId:'weekly-consumer',taskRef:{type:'weekly_workflow_task',id:'weekly-consumer',version:1},kind:'content',subjectRefs:[{type:'weekly_publication_task',id:publication.publicationTaskId,version:packageScope.packageVersion}]};
 const pkg={packageId:packageScope.packageId,programId:packageScope.programId,version:packageScope.packageVersion,status:'active',weekStart:'2026-10-12',weekEnd:'2026-10-18',businessContentGoalRef:{id:'weekly-goal',version:1},enterpriseProfileRef:{id:'weekly-profile',version:1},workflowTasks:[workflowTask],socialContentPackage:{weeklyBudgetCny:50,perItemBudgetCny:10,publicationTasks:[publication]},agentPlanning:{status:'dispatched',skeleton:{slots:[{slotId,motherContentId:publication.motherContentId,publicationTaskIds:[publication.publicationTaskId],accountIds:[publication.accountId],platforms:[publication.platform],plannedPublishWindows:[],objective:'test',quantity:1}]},directorAnalyses:[analysis],dispatch:{scheduleItems:[scheduleItem]}}} as any;
 await f.store.create('users',{id:'weekly-owner',tenantId:f.tenantId,role:'social_operator',active:true});
 await f.store.create('social_weekly_operating_packages',{tenant_id:f.tenantId,program_id:packageScope.programId,package_id:packageScope.packageId,version:packageScope.packageVersion,status:'active',payload:pkg});
 const programs=await f.store.list<any>('social_programs',{where:{tenant_id:f.tenantId,program_id:programId},perPage:2});assert.equal(programs.totalItems,1);await f.store.update('social_programs',programs.items[0]!.id,{payload:{programId,version:1}});
 await f.store.create('trend_videos',{id:candidateId,tenantId:f.tenantId,platform:'tiktok',title:'OEM factory capability proof',sourceUrl});
 await f.store.create('social_tracked_accounts',{tenant_id:f.tenantId,accountId:accountUrl,decision:'track',status:'tracked',accountRole:'brand_factory',reasons:['OEM factory wholesale supplier'],evidenceVideoIds:[candidateId,'evidence-2','evidence-3'],relatedSceneIds:[],missingEvidence:[],confidence:.95,businessConfirmation:{status:'confirmed',confirmedBy:'business_agent',decisionRef:'decision',reason:null,confirmedAt:'2026-10-01T00:00:00Z'}});
 await f.store.create('starter_social_inspiration_handoff_versions',{tenant_id:f.tenantId,handoff_version:'1',record_hash:handoffRef.recordHash,payload:handoff});
 await adoptWeeklyAutomationTemplate(f.store,packageScope,'weekly-owner');
 const independent={...packageScope,actorUserId:'weekly-owner',admittedAt:new Date().toISOString(),mode:'independent_branches' as const,authorizePublishing:false as const,authorizeMessaging:false as const};
 await f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(packageScope),tenant_id:f.tenantId,program_id:packageScope.programId,package_id:packageScope.packageId,package_version:packageScope.packageVersion,payload:independent});
 const job:WeeklyPreproductionJob={jobId:'weekly-job',...packageScope,consumerTaskId:'weekly-consumer',consumerInputHash:'input',kind:'discovery',status:'running',originalRunKey:'weekly-preproduction:weekly-job',actorUserId:'weekly-owner',dueAt:'2026-10-12T00:00:00.000Z',boundAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',sourceHash:'a'.repeat(64),authority:{scopeId:'weekly-scope',scopeVersion:1,scopeHash:'b'.repeat(64),requestedModes:['account']},code:null,resultRefs:[],recordHash:'c'.repeat(64)};
 const run:SocialInspirationCollectionRun={runId:'weekly-run',planId:'plan',keywordSetId:'keywords',keywordSetVersion:1,discoveryScopeId:'weekly-scope',discoveryScopeVersion:1,status:'stopped',triggerType:'manual',scopeSnapshot:{weeklyProducer:{key:job.originalRunKey}} as any,modeStats:{},platformStats:{},keywordTierStats:{},evidenceOutcomes:{},sourceRunRefs:[],queryBasis:{},market:'US',language:'en',stopReason:'no_valid_results',startedAt:'2026-10-11T00:00:00.000Z',finishedAt:'2026-10-11T01:00:00.000Z',error:null,failureDetails:[]};
 await f.store.create('social_weekly_preproduction_jobs',{id:job.jobId,tenant_id:f.tenantId,program_id:packageScope.programId,package_id:packageScope.packageId,package_version:packageScope.packageVersion,record_hash:job.recordHash,payload:job});
 await f.store.create('social_discovery_runs',{id:'weekly-run-row',tenant_id:f.tenantId,...run});
 const candidates=Array.from({length:5},(_,index)=>({candidateId:index?`unused-${index}`:candidateId,mediaSha256:String(index+1).repeat(64),operationId:index?`unused-operation-${index}`:operationId}));
 const handle=await prepareWeeklyCandidateExactProductionEscrow({store:f.store,job,run,root,provider:{endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'d'.repeat(64),model:'qwen3-vl-plus',tariffEvidenceHash:'e'.repeat(64),auditApiKeyId:'official-key-id'},candidates});
 await handle.reserve(candidateId,mediaSha256,operationId);
 const operation={schema:'weekly-candidate-exact-analysis-operation.v1',operationId,tenantId:f.tenantId,programId:packageScope.programId,packageId:packageScope.packageId,packageVersion:packageScope.packageVersion,jobId:job.jobId,runId:run.runId,runHash:handle.escrow.runHash,candidateId,sourceUrl:'https://www.tiktok.com/video/1',mediaSha256,authorizationId:handle.escrow.escrowId,authorizationHash:handle.escrow.recordHash,state:'submitted_or_unknown' as const,recordHash:''};operation.recordHash=socialRequestHash({...operation,recordHash:''});
 await f.store.create(WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS,{id:operationId,tenant_id:f.tenantId,record_hash:operation.recordHash,payload:operation});
 const receipt={schema:'weekly-candidate-exact-analysis-receipt.v1' as const,operationId,tenantId:f.tenantId,jobId:job.jobId,runId:run.runId,candidateId,mediaSha256,authorizationHash:handle.escrow.recordHash,providerRequestHash:'2'.repeat(64),providerReceiptRef:`qwen-audit-upper-bound:${operationId}:receipt`,ledgerOutcomeHash:'3'.repeat(64),analysisRunId:operationId,recordSnapshotHash:'4'.repeat(64),settlementBasis:'conservative_upper_bound' as const,recordedUpperBoundCny:2};
 await f.store.create(WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS,{id:operationId,tenant_id:f.tenantId,record_hash:socialRequestHash(receipt),payload:receipt});
 const authority={weeklyPackage:structuredClone(pkg),publicationTask:structuredClone(publication),weeklyWorkflowTask:workflowTask,programRef:{type:'social_program',id:programId,version:1},enterpriseProfileRef:{type:'enterprise_profile',id:'weekly-profile',version:1},businessGoal:{programId,goalId:'weekly-goal',version:1,objective:'test',products:[],audiences:[],markets:['US'],languages:['en'],publicFactRefs:[]},selectedHandoffs:[handoff],referenceSelection:{selectionId:'selection',version:1,status:'selected',upstreamTaskRef:'weekly-consumer',selected:[{candidateId,readiness:'production_reference',evidenceId:'weekly-evidence',evidenceVersion:1}],evidenceVersionRefs:['weekly-evidence@1']}};
 const references=await readWeeklyReferenceSources(f.store,f.tenantId,authority,analysis as any);assert.equal(references.length,1);
 await f.store.create(STARTER_COLLECTIONS.socialTaskSources,{tenant_id:f.tenantId,task_id:f.taskId,source_id:'weekly-reference',source_kind:'reference_link',source_ref:references[0]!.sourceRef,source_version:references[0]!.sourceVersion,status:'active',created_at:'2026-10-11T00:00:00.000Z',label:'weekly reference'});
 const brief=socialObject(socialJson(taskRow.brief));
 await f.store.update(STARTER_COLLECTIONS.socialContentTasks,taskRow.id,{brief:{...brief,_weeklyAuthority:authority},create_idempotency_key:`weekly-production:${packageScope.packageId}:${packageScope.packageVersion}:${publication.publicationTaskId}`,source_count:1});
 return{handle,operationId};
}
test('historical admission remains read only and does not suddenly provision a new budget', async () => { const f = await fixture(); try {
    const result = await prepareSocialContentProductionBudget({ ...f, assets: [] });
    assert.equal(result.status, 'legacy');
    assert.equal(fs.existsSync(path.join(f.root, 'task-budget')), false);
}
finally {
    f.clean();
} });
test('default preflight carries settled exact cost from the production task-budget root when the legacy root is absent',async()=>{
 const f=await fixture(),oldLegacy=process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT,oldProduction=process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR,productionRoot=path.join(f.root,'production-task-budget');
 try{
  await f.enable();delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR=productionRoot;
  const exact=await installSettledWeeklyExactCost(f,productionRoot);
  await prepareSocialContentProductionBudget({...f,assets:[]}).catch(()=>undefined);
  const source=(await exact.handle.status()).entries[exact.operationId];
  assert.equal(source?.state,'carried_forward');
  assert.match(source?.contentLedgerRef??'',/^social-task-budget:[a-f0-9]{64}$/);
 }finally{
  if(oldLegacy===undefined)delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;else process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT=oldLegacy;
  if(oldProduction===undefined)delete process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR;else process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR=oldProduction;
  f.clean();
 }
});
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
 const f=await fixture(); const originalFetch=globalThis.fetch, oldKey=process.env.HEYGEN_API_KEY, oldDash=process.env.DASHSCOPE_API_KEY,oldBase=process.env.DASHSCOPE_BASE_URL,oldAsrBase=process.env.QWEN_ASR_BASE_URL,oldSeedream=process.env.SEEDREAM_API_KEY;
 const gets:string[]=[];
 try {
  await f.enable();
  f.baseline.language='en';f.baseline.scenes=f.baseline.scenes.map(scene=>({...scene,voiceover:'Welcome to our company.',narration:'Welcome to our company.'}));
  await f.store.update(STARTER_COLLECTIONS.socialContentTasks,(await requireSocialTask(f)).id,{script_baseline:f.baseline});
  await f.store.create('studio_production_defaults',{tenant_id:f.tenantId,payload:{presenters:[{id:'enterprise-person',authorized:true,assetVersion:4,avatarId:'original-look',voiceId:'original-voice',rightsEvidence:{authorizationRef:'rights://original',consentRef:'consent://original',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}}]}});
  process.env.HEYGEN_API_KEY='controlled-key';process.env.DASHSCOPE_API_KEY='controlled-native';process.env.DASHSCOPE_BASE_URL='https://maas.qianwenaiapi.com/compatible-mode/v1';process.env.QWEN_ASR_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1';process.env.SEEDREAM_API_KEY='controlled-seedream';
  const row=(...cells:string[])=>({cells:cells.map(text=>({content:[{text}]}))});
  const price='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{articleContent:{articleId:'10060327',blocks:[{rows:[row('Video Generation with Avatar IV engine','Price per 1 minute, charged by actual seconds generated','Credits per min'),row('Photo Avatar','$2.31','46'),row('Digital Twin','$4.83','97'),row('Studio Avatar','$4.83','97'),row('Video Generation with Avatar III engine','Price per 1 minute, charged by actual seconds generated','Credits per min'),row('Digital Twin','$0.60','12')]}]}}}})+'</script>';
  globalThis.fetch=async (url,init)=>{ const u=String(url);assert.ok(!init?.method||init.method==='GET');gets.push(u);let body:string;
   if(u.includes('/avatars/looks/'))body=JSON.stringify({data:{id:'original-look',avatar_type:'digital_twin',supported_api_engines:['avatar_iv'],status:'completed'}});
   else if(u.endsWith('/users/me'))body=JSON.stringify({data:{billing_type:'wallet',wallet:{currency:'usd',remaining_balance:20}}});
   else if(u==='https://maas.qianwenaiapi.com/compatible-mode/v1/models')body=JSON.stringify({object:'list',data:[{id:'qwen3-vl-plus',capabilities:['vision']}]});
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
 } finally {globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.HEYGEN_API_KEY;else process.env.HEYGEN_API_KEY=oldKey;if(oldDash===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=oldDash;if(oldBase===undefined)delete process.env.DASHSCOPE_BASE_URL;else process.env.DASHSCOPE_BASE_URL=oldBase;if(oldAsrBase===undefined)delete process.env.QWEN_ASR_BASE_URL;else process.env.QWEN_ASR_BASE_URL=oldAsrBase;if(oldSeedream===undefined)delete process.env.SEEDREAM_API_KEY;else process.env.SEEDREAM_API_KEY=oldSeedream;f.clean();}
});
