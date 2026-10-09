import test from 'node:test';
import {withExecutionPackageGate} from '../socialPrograms/weeklyExecutionGate.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import assert from 'node:assert/strict';
import {prepareWeeklyControlledOriginalRunFixture} from './weeklyControlledOriginalRun.fixture.js';
import {freezeOriginalRunMaterialDemand,readVerifiedNoSharedMaterialDemand,type OriginalRunMaterialDemandScope} from './socialWeeklyOriginalRunMaterialDemand.js';
import {observeWeeklyContinuationProduction} from '../socialPrograms/weeklyContinuationProductionObserver.js';
import {verifiedNoSharedMaterialDemand} from './socialWeeklyMaterialDemand.js';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import type {SocialReplicationScriptVersion} from '../../shared/contracts/socialContentWorkflow.js';

test('original owned run with unsafe actual plan cannot freeze generated readiness',async t=>{
 const {f,pkg,created}=await prepareWeeklyControlledOriginalRunFixture(t);
 const scope:OriginalRunMaterialDemandScope={tenantId:'t',taskId:String(created.task_id),programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:'pub',accountId:'account',factRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs};
 assert.equal(await freezeOriginalRunMaterialDemand(f.store,scope),null);
 assert.equal(await freezeOriginalRunMaterialDemand(f.store,{...scope,tenantId:'foreign'}),null);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('actual server-resolved generated plan freezes only same original run and rejects source/plan drift',async t=>{
 const {f,pkg,created,actual}=await prepareWeeklyControlledOriginalRunFixture(t);
 const scope:OriginalRunMaterialDemandScope={tenantId:'t',taskId:String(created.task_id),programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:'pub',accountId:'account',factRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs};
 // Controlled producer record input, parsed by the actual task reader; no review/pass or provider evidence is invented.
 const plan=createSocialAssetSupplyPlan({creationMode:'material_processing',planVersion:'1',confirmedFactRefs:scope.factRefs.map(r=>`${r.type}:${r.id}@${r.version}`),shots:[{shotId:'decorative-transition',function:'transition',requestedDescription:'非证据装饰图形动画'}]});
 const script:SocialReplicationScriptVersion={version:'1',referenceAnalysisId:'decorative-analysis',status:'draft',primaryHookId:'hook',hookOptions:[0,1,2].map(i=>({hookId:`hook-${i}`,role:i===0?'primary':'alternative',status:'draft',firstFrame:'非证据图形',firstSecondAction:'装饰转场',spokenLine:null,caption:null,mechanism:'节奏示意',audiovisualPlan:'静音图形',sourceStrategy:'motion_graphics',truthBoundary:{subject:'none',syntheticVisualAllowed:true,customerEvidenceRequired:false,customerEvidenceRefs:[],confirmedFactRefs:[],mustNotImplyCustomerReality:true,prohibitedRepresentations:[]},referencePoints:[],mustDifferPoints:[]})),shots:[{shotId:'decorative-transition',referenceShotId:'decorative-transition',startSeconds:0,endSeconds:3,purpose:'transition',visualInstruction:'非证据装饰图形动画',spokenText:'',captionText:'',audioAndTransition:'静音',fidelityPoints:[],mustDifferPoints:[],materialPlan:plan.shots[0]!,lockedRegions:[],risks:[]}],structureFidelitySummary:'装饰转场',originalityDifferenceSummary:'不作为企业证据',createdAt:new Date().toISOString()};
 created.replication_script=script;created.material_requirements=[];
 const demand=await freezeOriginalRunMaterialDemand(f.store,scope);assert.ok(demand);assert.equal(demand.runProof?.runId,created.run_id);
 const brief=created.brief as Record<string,unknown>;
 const run=f.tables.workflow_runs!.find(r=>r.id===created.run_id)!;
 const runContext=run.starter_context as Record<string,unknown>;
 const {runProof:removedProof,recordHash:removedHash,...legacyBase}=demand;
 const legacyPayload={...legacyBase,version:Number(String(runContext.socialTaskVersion).replace(/^v/,''))};
 const legacy={...legacyPayload,recordHash:socialRequestHash(legacyPayload)};
 brief._weeklyMaterialDemand=legacy;await f.store.update('starter_social_content_tasks',String(created.id),{brief});
 assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),null,'running legacy is not paid authorization');
 const legacyRun=created.run_id,legacyCurrentVersion=created.version;
 created.run_id=null;
 assert.ok(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),'pre-start legacy is revalidated against actual current server plan');
 created.version=String(Number(String(legacyCurrentVersion).replace(/^v/,''))+1);
 assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),null,'changed task version cannot reuse pre-start declaration');
 created.version=legacyCurrentVersion;created.run_id=legacyRun;

 assert.equal(await freezeOriginalRunMaterialDemand(f.store,scope),null,'migration requires held actual package gate');
 const migrationScope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version};
 const oldVersion=legacy.version;legacy.version=oldVersion+1;const {recordHash:ignoredVersionHash,...versionPayload}=legacy;legacy.recordHash=socialRequestHash(versionPayload);
 await f.store.update('starter_social_content_tasks',String(created.id),{brief:{...brief,_weeklyMaterialDemand:legacy}});
 assert.equal(await withExecutionPackageGate(f.store,migrationScope,()=>freezeOriginalRunMaterialDemand(f.store,scope)),null,'wrong original start version cannot migrate');
 legacy.version=oldVersion;const {recordHash:ignoredReset,...resetPayload}=legacy;legacy.recordHash=socialRequestHash(resetPayload);
 const originalPlan=legacy.assetSupplyPlan;legacy.assetSupplyPlan={...originalPlan,planVersion:'different-frozen-version'};const {recordHash:ignoredPlan,...planPayload}=legacy;legacy.recordHash=socialRequestHash(planPayload);
 await f.store.update('starter_social_content_tasks',String(created.id),{brief:{...brief,_weeklyMaterialDemand:legacy}});
 assert.equal(await withExecutionPackageGate(f.store,migrationScope,()=>freezeOriginalRunMaterialDemand(f.store,scope)),null,'safe but changed plan cannot inherit an old declaration');
 legacy.assetSupplyPlan=originalPlan;const {recordHash:ignoredPlanReset,...planReset}=legacy;legacy.recordHash=socialRequestHash(planReset);
 await f.store.update('starter_social_content_tasks',String(created.id),{brief:{...brief,_weeklyMaterialDemand:legacy}});
 const migrated=await withExecutionPackageGate(f.store,migrationScope,()=>freezeOriginalRunMaterialDemand(f.store,scope));assert.ok(migrated?.runProof);
 assert.equal(migrated.recordHash,demand.recordHash);
 assert.equal(verifiedNoSharedMaterialDemand(created,scope),null,'self-declared run proof cannot use the legacy pure verifier');
 assert.equal((await readVerifiedNoSharedMaterialDemand(f.store,created,scope))?.recordHash,demand.recordHash);
 const before=f.tables.starter_social_content_tasks!.length;assert.equal((await freezeOriginalRunMaterialDemand(f.store,scope))?.recordHash,demand.recordHash);assert.equal(f.tables.starter_social_content_tasks!.length,before);assert.equal(f.tables.content_execution_jobs?.length??0,0);
 const storedPackage=f.tables.social_weekly_operating_packages!.find(row=>row.package_id===scope.packageId&&row.version===scope.packageVersion)!;
 const packagePayload=structuredClone(storedPackage.payload) as typeof pkg;storedPackage.payload=packagePayload;
 const originalStatus=packagePayload.status;
 for(const historicalStatus of ['superseded','retired'] as const){storedPackage.status=historicalStatus;packagePayload.status=historicalStatus;assert.equal((await readVerifiedNoSharedMaterialDemand(f.store,created,scope))?.recordHash,demand.recordHash,'historical read preserves original verified demand');assert.equal(await freezeOriginalRunMaterialDemand(f.store,scope),null,'history cannot authorize a fresh freeze');}
 created.status='producing';
 // Controlled continuation projection; actual content/run identities come from the real starter.
 // Controlled continuation projection from the actual owned content/run; not proof of dispatched progress.
 const observerTask={...actual,schedule:{...actual.schedule,actualStartedAt:'2026-10-09T01:00:00Z'},productionProgress:{contentTaskId:String(created.task_id),runId:String(created.run_id),step:actual.schedule.stepKind,activity:String(created.status),updatedAt:String(created.updated_at)}};
 const beforeObservation=JSON.stringify(f.tables);let validations=0;
 const observation=await observeWeeklyContinuationProduction(f.store,observerTask,'2026-10-09T03:00:00Z',async(task,refs)=>{validations++;assert.equal(task.taskId,actual.taskId);assert.deepEqual(refs,[{type:'starter_social_content_material_demand',id:String(created.task_id),version:demand.version}]);});
 assert.equal(observation.status,'ready');assert.equal(validations,1);assert.equal(JSON.stringify(f.tables),beforeObservation,'historical observer is read only');
 storedPackage.status=originalStatus;packagePayload.status=originalStatus;
 const originalRun=created.run_id;created.run_id='foreign-run';assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),null);created.run_id=originalRun;
 assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,{...scope,tenantId:'foreign'}),null);
 script.shots[0]!.visualInstruction='changed';assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),null);
 const driftBefore=JSON.stringify(f.tables);assert.equal((await observeWeeklyContinuationProduction(f.store,observerTask,'2026-10-09T03:00:00Z',async()=>{throw new Error('drift must not validate');})).code,'weekly_continuation_original_material_demand_unverified');assert.equal(JSON.stringify(f.tables),driftBefore);
});


test('actual scheduler freezes pre-start material plan across its own V to V+1 transition',async t=>{
 const {f,pkg,created}=await prepareWeeklyControlledOriginalRunFixture(t);
 const scope:OriginalRunMaterialDemandScope={tenantId:'t',taskId:String(created.task_id),programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:'pub',accountId:'account',factRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs};
 const plan=createSocialAssetSupplyPlan({creationMode:'material_processing',planVersion:'1',confirmedFactRefs:scope.factRefs.map(r=>`${r.type}:${r.id}@${r.version}`),shots:[{shotId:'decorative-transition',function:'transition',requestedDescription:'非证据装饰图形动画'}]});
 const script:SocialReplicationScriptVersion={version:'1',referenceAnalysisId:'decorative-analysis',status:'draft',primaryHookId:'hook',hookOptions:[0,1,2].map(i=>({hookId:`hook-${i}`,role:i===0?'primary':'alternative',status:'draft',firstFrame:'非证据图形',firstSecondAction:'装饰转场',spokenLine:null,caption:null,mechanism:'节奏示意',audiovisualPlan:'静音图形',sourceStrategy:'motion_graphics',truthBoundary:{subject:'none',syntheticVisualAllowed:true,customerEvidenceRequired:false,customerEvidenceRefs:[],confirmedFactRefs:[],mustNotImplyCustomerReality:true,prohibitedRepresentations:[]},referencePoints:[],mustDifferPoints:[]})),shots:[{shotId:'decorative-transition',referenceShotId:'decorative-transition',startSeconds:0,endSeconds:3,purpose:'transition',visualInstruction:'非证据装饰图形动画',spokenText:'',captionText:'',audioAndTransition:'静音',fidelityPoints:[],mustDifferPoints:[],materialPlan:plan.shots[0]!,lockedRegions:[],risks:[]}],structureFidelitySummary:'装饰转场',originalityDifferenceSummary:'不作为企业证据',createdAt:new Date().toISOString()};
 created.replication_script=script;created.material_requirements=[];

 const {readSocialTaskDetail}=await import('../starter198/socialContentRecords.js');
 const {buildNoSharedMaterialDemand}=await import('./socialWeeklyMaterialDemand.js');
 const {scheduleSocialContentWork}=await import('../starter198/socialContentScheduler.js');
 const {readWeeklySchedulerMaterialPlan}=await import('../starter198/socialWeeklySchedulerMaterialPlan.js');
 created.run_id=null;created.status='plan_review';
 const before=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:scope.taskId});assert.ok(before?.assetSupplyPlan);
 const {tenantId:omittedTenant,...preScope}=scope;const declaration=buildNoSharedMaterialDemand(created,before,preScope);assert.ok(declaration);
 const brief={...(created.brief as Record<string,unknown>),_weeklyMaterialDemand:declaration};await f.store.update('starter_social_content_tasks',String(created.id),{brief});
 const commandId='actual-scheduler-material-start',idempotencyKey='actual-scheduler-material-key';
 await f.repository.create('starter_social_content_operations','t',{operation_id:commandId,idempotency_key:idempotencyKey,operation:'start_social_content_task',target_id:scope.taskId,request_hash:socialRequestHash({expectedVersion:before.version}),created_by:'owner',status:'processing'});
 let callbacks=0;
 const scheduled=await scheduleSocialContentWork({repository:f.repository,now:new Date(),queue:{tenantId:'t',userId:'owner',commandId,idempotencyKey,input:'执行原排期',workflowScope:'social_content',subject:{type:'social_content_task',id:scope.taskId,admissionVersion:before.version,version:before.version,sourceRefs:before.sources.filter(x=>x.status==='active').map(x=>({id:x.sourceId,...(x.sourceVersion?{version:x.sourceVersion}:{})})),packageSelection:before.packageSelection,conversionObjective:Boolean(before.brief.callToAction)}},productionRunner:async()=>{callbacks++;}});
 assert.ok(scheduled.runId);assert.equal(callbacks,1);
 const after=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:scope.taskId});assert.ok(after);
 assert.equal(Number(after.version),Number(before.version)+1);
 const current=f.tables.starter_social_content_tasks!.find(r=>r.task_id===scope.taskId)!;
 const frozen=await readWeeklySchedulerMaterialPlan(f.repository,current,after);assert.deepEqual(frozen,before.assetSupplyPlan);
 assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,current,scope),null,'readonly legacy cannot become paid authorization');
 const migrated=await withExecutionPackageGate(f.store,{tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version},()=>freezeOriginalRunMaterialDemand(f.store,scope));assert.ok(migrated?.runProof);assert.deepEqual(migrated.assetSupplyPlan,before.assetSupplyPlan);
 const savedOperation=current.last_operation_id;current.last_operation_id='other-operation';assert.equal(await readWeeklySchedulerMaterialPlan(f.repository,current,after),null);current.last_operation_id=savedOperation;
 const savedVersion=current.version;current.version=String(Number(savedVersion)+1);assert.equal(await readWeeklySchedulerMaterialPlan(f.repository,current,{...after,version:String(current.version)}),null);current.version=savedVersion;
 const savedScript=current.replication_script;current.replication_script={...(savedScript as object),structureFidelitySummary:'changed business input'};assert.equal(await readWeeklySchedulerMaterialPlan(f.repository,current,after),null);current.replication_script=savedScript;
 assert.equal(await readWeeklySchedulerMaterialPlan(f.repository,current,{...after,sources:after.sources.map(x=>({...x,sourceVersion:'foreign-source-version'}))}),null);
 assert.equal(await readWeeklySchedulerMaterialPlan(f.repository,current,{...after,assetSupplyPlan:{...after.assetSupplyPlan!,shots:after.assetSupplyPlan!.shots.map(x=>({...x,truthBoundary:{...x.truthBoundary,customerEvidenceRequired:true}}))}}),null,'nested plan edits are not lifecycle mappings');
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
