import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyPlanningProductionFixture} from './weeklyPlanningProduction.fixture.js';
import {freezeOriginalRunMaterialDemand,readVerifiedNoSharedMaterialDemand,type OriginalRunMaterialDemandScope} from './socialWeeklyOriginalRunMaterialDemand.js';
import {verifiedNoSharedMaterialDemand} from './socialWeeklyMaterialDemand.js';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import type {SocialReplicationScriptVersion} from '../../shared/contracts/socialContentWorkflow.js';

test('original owned run with unsafe actual plan cannot freeze generated readiness',async t=>{
 const {f,pkg,created}=await prepareWeeklyPlanningProductionFixture(t);
 const scope:OriginalRunMaterialDemandScope={tenantId:'t',taskId:String(created.task_id),programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:'pub',accountId:'account',factRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs};
 assert.equal(await freezeOriginalRunMaterialDemand(f.store,scope),null);
 assert.equal(await freezeOriginalRunMaterialDemand(f.store,{...scope,tenantId:'foreign'}),null);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('actual server-resolved generated plan freezes only same original run and rejects source/plan drift',async t=>{
 const {f,pkg,created}=await prepareWeeklyPlanningProductionFixture(t);
 const scope:OriginalRunMaterialDemandScope={tenantId:'t',taskId:String(created.task_id),programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,publicationTaskId:'pub',accountId:'account',factRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs};
 // Controlled producer record input, parsed by the actual task reader; no review/pass or provider evidence is invented.
 const plan=createSocialAssetSupplyPlan({creationMode:'material_processing',planVersion:'1',confirmedFactRefs:scope.factRefs.map(r=>`${r.type}:${r.id}@${r.version}`),shots:[{shotId:'decorative-transition',function:'transition',requestedDescription:'非证据装饰图形动画'}]});
 const script:SocialReplicationScriptVersion={version:'1',referenceAnalysisId:'decorative-analysis',status:'draft',primaryHookId:'hook',hookOptions:[0,1,2].map(i=>({hookId:`hook-${i}`,role:i===0?'primary':'alternative',firstFrame:'非证据图形',firstSecondAction:'装饰转场',spokenLine:null,caption:null,mechanism:'节奏示意',audiovisualPlan:'静音图形',sourceStrategy:'motion_graphics',truthBoundary:{subject:'none',syntheticVisualAllowed:true,customerEvidenceRequired:false,customerEvidenceRefs:[],confirmedFactRefs:[],mustNotImplyCustomerReality:true,prohibitedRepresentations:[]},referencePoints:[],mustDifferPoints:[]})),shots:[{shotId:'decorative-transition',referenceShotId:'decorative-transition',startSeconds:0,endSeconds:3,purpose:'transition',visualInstruction:'非证据装饰图形动画',spokenText:'',captionText:'',audioAndTransition:'静音',fidelityPoints:[],mustDifferPoints:[],materialPlan:plan.shots[0]!,lockedRegions:[],risks:[]}],structureFidelitySummary:'装饰转场',originalityDifferenceSummary:'不作为企业证据',createdAt:new Date().toISOString()};
 created.replication_script=script;created.material_requirements=[];
 const demand=await freezeOriginalRunMaterialDemand(f.store,scope);assert.ok(demand);assert.equal(demand.runProof?.runId,created.run_id);
 assert.equal(verifiedNoSharedMaterialDemand(created,scope),null,'self-declared run proof cannot use the legacy pure verifier');
 assert.equal((await readVerifiedNoSharedMaterialDemand(f.store,created,scope))?.recordHash,demand.recordHash);
 const before=f.tables.starter_social_content_tasks!.length;assert.equal((await freezeOriginalRunMaterialDemand(f.store,scope))?.recordHash,demand.recordHash);assert.equal(f.tables.starter_social_content_tasks!.length,before);assert.equal(f.tables.content_execution_jobs?.length??0,0);
 const originalRun=created.run_id;created.run_id='foreign-run';assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),null);created.run_id=originalRun;
 assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,{...scope,tenantId:'foreign'}),null);
 script.shots[0]!.visualInstruction='changed';assert.equal(await readVerifiedNoSharedMaterialDemand(f.store,created,scope),null);
});
