import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyNonPresenterPlanningFixture} from './weeklyNonPresenterProduction.fixture.js';
import {adoptWeeklyAutomationTemplate,readWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {verifiedWeeklyPlanningTemplateAdoption} from '../socialPrograms/weeklyPlanningTemplateAdoption.js';
import {materializeWeeklyExecutionTasks,listWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import {prepareWeeklyAutomaticProductionPlanning,readWeeklyAutomaticProductionIntent,readWeeklyAutomaticProductionCapacity} from '../socialPrograms/weeklyAutomaticProductionPlanning.js';
import {WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId} from '../socialPrograms/weeklyIndependentAdmission.js';
import {bindWeeklyPreproductionAuthority,runWeeklyPreproductionProducerScan} from './weeklyPreproductionProducer.js';
import {supplementConsumerHash} from '../socialPrograms/weeklySupplementRequests.js';
import {createSocialWeeklyExecutionWorker} from './socialWeeklyExecutionWorker.js';
import {createSocialWeeklyPlanningAdapter} from './socialWeeklyExecutionRuntime.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {setContentExecutionLimit} from '../contentExecution/durableQueue.js';
import {g5FixtureScope} from '../starter198/socialDirectorG5ReviewService.fixture.js';
import {advanceWeeklyAutomaticG5,readWeeklyG5AutomaticAuthority} from './weeklyG5AutomaticAuthority.js';

test('current-week controlled source reaches product-issued v3 planning adoption without a human schedule confirmation',async t=>{
 const f=await prepareWeeklyNonPresenterPlanningFixture(t,{confirmedTemplate:true,automaticTemplate:true,ownedReferenceBytes:true,primaryStructure:true,targetCta:'Contact sales'});
 const scope={tenantId:'t',programId:'p',packageId:f.pkg.packageId,packageVersion:f.pkg.version};
 assert.equal(f.dispatched.userConfirmation,null);
 assert.ok(verifiedWeeklyPlanningTemplateAdoption(f.dispatched));
 assert.equal((await readWeeklyAutomationTemplate(f.f.store,scope))?.template.version,'weekly-automation.v3');
 assert.equal(f.pkg.weekStart,'2026-10-19');
 assert.equal(f.pkg.weekEnd,'2026-10-25');
});

test('current-week v3 producer completes real outline, then signs and rereads ten-yuan quality capacity',async t=>{
 const f=await prepareWeeklyNonPresenterPlanningFixture(t,{confirmedTemplate:true,deferAutomaticPlanning:true,formalActivation:true,ownedReferenceBytes:true,primaryStructure:true,targetCta:'Contact sales',metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5'],successCriteria:['实际制作一条待审核视频']});
 const scope={tenantId:'t',programId:'p',packageId:f.pkg.packageId,packageVersion:f.pkg.version};
 const tasks=await materializeWeeklyExecutionTasks(f.f.store,'t',f.pkg);
 assert.ok(tasks.some(task=>task.schedule.stepKind==='quality_check'));
 await f.f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(scope),tenant_id:'t',program_id:'p',package_id:f.pkg.packageId,package_version:f.pkg.version,payload:{...scope,actorUserId:'owner',admittedAt:new Date().toISOString(),mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
 await adoptWeeklyAutomationTemplate(f.f.store,scope,'owner');
 const prepared=await prepareWeeklyAutomaticProductionPlanning(f.f.store,scope,new Date().toISOString());
 assert.deepEqual(prepared,{status:'not_ready',code:'weekly_real_outline_required'});
 await createWeeklyOperatingPackageService(f.f.store).activate('t','owner','p',f.pkg.packageId,{expectedVersion:f.pkg.version,expectedProgramVersion:1,authorizePublishing:false});
 const outline=tasks.find(task=>task.schedule.stepKind==='business_outline')!;
 await bindWeeklyPreproductionAuthority({store:f.f.store,...scope,taskId:outline.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(outline),now:new Date()});
 const scan=await runWeeklyPreproductionProducerScan({store:f.f.store,now:new Date()});
 assert.equal(scan.succeeded,1);
 const worker=createSocialWeeklyExecutionWorker(f.f.store);
 const claimed=await worker.claimNext({tenantId:'t',workerId:'isolated-g5-outline-worker',now:new Date(),scope});
 assert.equal(claimed?.task.taskId,outline.taskId,JSON.stringify({outline,scan,current:f.f.tables.social_weekly_execution_tasks?.find(row=>row.task_id===outline.taskId)?.payload}));
 const result=await createSocialWeeklyPlanningAdapter(f.f.store).execute(claimed!.task);
 assert.equal(result.status,'succeeded',JSON.stringify(result));
 if(result.status==='succeeded')await worker.complete(claimed!,result.resultRefs,new Date());
 for(const [limitScope,scopeKey]of [['tenant','*'],['task_type','social_content_weekly']] as const)await setContentExecutionLimit({dataStore:f.f.store,tenantId:'t',scope:limitScope,scopeKey,maxRunning:2,updatedBy:'owner',now:new Date()});
 const after=await prepareWeeklyAutomaticProductionPlanning(f.f.store,scope,new Date().toISOString());
 assert.equal(after.status,'prepared',JSON.stringify(after));
 if(after.status==='prepared'){
  assert.ok(after.intent.capacityProofId);
  const current=(await f.f.store.list<{payload:typeof f.pkg}>('social_weekly_operating_packages',{where:{tenant_id:'t',package_id:f.pkg.packageId,version:f.pkg.version},perPage:2})).items[0]!.payload;
  const authority=await readWeeklyAutomaticProductionIntent(f.f.store,scope,current,current.socialContentPackage.publicationTasks[0]!.publicationTaskId);
  assert.ok(authority);
  assert.equal(authority.planning.userConfirmation,null);
  const currentTasks=await listWeeklyExecutionTasks(f.f.store,'t','p',f.pkg.packageId,f.pkg.version);
  const quality=currentTasks.find(task=>task.schedule.stepKind==='quality_check')!;
  const assignment=(await f.f.store.getById<{payload:{assignments:Array<{taskId:string;startAt:string}>}}>('social_weekly_production_scope_capacities',after.intent.capacityProofId))!.payload.assignments.find(item=>item.taskId===quality.taskId)!;
  const capacity=await readWeeklyAutomaticProductionCapacity(f.f.store,{intent:after.intent,pkg:current,planning:authority!.planning,task:quality,now:assignment.startAt});
  assert.equal(capacity?.eligible,true);
  assert.equal(capacity?.proof.perFilmIncludingRevisionsMaxCny,10);
  // The old local MP4/G4 seed is a different content order. A formal current
  // week intent never retroactively turns it into this package's original run.
  const priorReviewCount=f.f.tables.starter_social_director_g5_reviews?.length??0;
  await assert.rejects(readWeeklyG5AutomaticAuthority(f.f.store,g5FixtureScope,quality.taskId,assignment.startAt),/content_binding_changed/);
  // Exercise the actual worker command too: this fixture artifact has no
  // current-week immutable media binding, so it cannot become paid G5 work.
  await assert.rejects(advanceWeeklyAutomaticG5(f.f.store,quality,{...f.f.ref,type:'starter_social_content_artifact'},'owner'),{code:'weekly_quality_audit_artifact_changed'});
  assert.equal(f.f.tables.starter_social_director_g5_reviews?.length??0,priorReviewCount);
  assert.equal(f.f.tables.starter_usage_ledger?.length??0,0);
 }
});
