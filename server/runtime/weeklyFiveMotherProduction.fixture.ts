import {controlledMessengerAccount} from '../messenger/controlledCapability.fixture.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {TestContext} from 'node:test';
import {prepareWeeklyNonPresenterPlanningFixture} from './weeklyNonPresenterProduction.fixture.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {createSocialOperatingDecisionService} from '../socialOperating/service.js';
import {planCapacity} from '../socialOperating/capacityPlanner.js';
import {resolveAutomationPolicy} from '../socialOperating/automationPolicyResolver.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {applyBusinessDispatchToExecutionTasks,listWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import {createWeeklyMaterialRequestService} from '../socialPrograms/weeklyMaterialRequests.js';
import {setContentExecutionLimit} from '../contentExecution/durableQueue.js';
import {createWeeklyInitialScheduleService} from '../socialPrograms/weeklyInitialSchedule.js';
/** One tenant, one package and five mother slots. This prepares real planning
 * services only; it never represents production or approval as completed. */
export async function prepareFiveMotherProductionFixture(t:TestContext,seed?:Awaited<ReturnType<typeof prepareWeeklyNonPresenterPlanningFixture>>,fixtureOptions:{accounts?:Array<{accountId:string;version:number;weeklyPublicationCapacity:number}>;costPerMotherCny?:number;controlledReception?:boolean;consumerRequirement?:(input:{setup:Awaited<ReturnType<typeof prepareWeeklyNonPresenterPlanningFixture>>;tasks:import('../../shared/contracts/socialProgram.js').WeeklyExecutionTask[];pkg:import('../../shared/contracts/socialProgram.js').WeeklyOperatingPackage})=>Promise<string|Record<string,string>>}={}){
 const setup=seed??await prepareWeeklyNonPresenterPlanningFixture(t,{ownedReferenceBytes:true,productInventory:false,primaryStructure:true,metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5']});
 const costPerMotherCny=fixtureOptions.costPerMotherCny??1;const {f}=setup,clock='2026-10-10T01:00:00Z';
 const decisions=createSocialOperatingDecisionService(f.store,()=>clock);
 if(fixtureOptions.controlledReception){const programs=await f.store.list<Record<string,unknown>>('social_programs',{where:{tenant_id:'t',program_id:'p'},perPage:2});assert.equal(programs.totalItems,1);const program=programs.items[0]!;await f.store.update('social_programs',String(program.id),{payload:{...(program.payload as Record<string,unknown>),route:setup.pkg.referenceSourcePolicy?.profile==='b2b_established'?'account_repair':'cold_start'}});}
 const goalRef=setup.pkg.businessContentGoalRef!;
 const goal=await decisions.getGoal('t','p',goalRef.id,goalRef.version);
 const options={operator:{type:'user' as const,id:'owner'},decidedAt:clock};
 const capacity=planCapacity({goal,desiredOriginalContents:5,desiredAdaptations:0,costPerOriginalCny:costPerMotherCny,costPerAdaptationCny:1,readyMaterialUnits:5,materialUnitsPerOriginal:1,productionItemsPerDay:1,daysUntilDeadline:7,accounts:(fixtureOptions.accounts??[{accountId:'account',version:2,weeklyPublicationCapacity:5}]).map(account=>({ref:{type:'owned_social_account',id:account.accountId,version:account.version},accountId:account.accountId,status:'active',weeklyPublicationCapacity:account.weeklyPublicationCapacity})),interactionItemsPerWeek:10,salesLeadsPerWeek:10,expectedInteractionsPerPublication:1,expectedLeadsPerPublication:1,capabilities:{'studio.production':'available','publishing.calendar':'available','customer.attribution':'available'}},options);
 assert.equal(capacity.plan.status,'ready');await decisions.saveOperatingDecision('t','p',capacity.decision);
 const policy=resolveAutomationPolicy({goal,mode:'managed',action:'draft',capability:{key:'studio.production',availability:'available'},factsVerified:true,withinBudget:true,rightsSufficient:true},options);
 await decisions.saveOperatingDecision('t','p',policy.decision);
 const requirementKey='five-mother-shared-product',requestId=createHash('sha256').update(JSON.stringify(['t','p',requirementKey])).digest('hex').slice(0,15);
 const original=setup.pkg.socialContentPackage.publicationTasks[0]!;
 const publications=Array.from({length:5},(_,i)=>({...structuredClone(seed?.pkg.socialContentPackage.publicationTasks[i]??original),publicationTaskId:`five-pub-${i+1}`,motherContentId:`five-mother-${i+1}`,adaptationOfPublicationTaskId:null,publishWindow:`2026-10-${14+i}T10:00:00Z`,topic:`企业产品证明角度 ${i+1}`,materialRequirement:{required:true as const,requestIds:[requestId]}}));
 const packages=createWeeklyOperatingPackageService(f.store);
 let pkg=await packages.create('t','owner','p',{weekStart:'2026-10-12',objective:goal.objective,perItemBudgetCny:costPerMotherCny,successCriteria:['本周五条独立母版发布'],enterpriseProfileRef:{type:'enterprise_profile',id:'profile',version:1},businessContentGoalRef:goalRef,capacityPlanRef:{type:'capacity_plan',id:capacity.decision.decisionId,version:1},automationPolicyRef:{type:'automation_policy',id:policy.decision.decisionId,version:1},referenceSourcePolicy:setup.pkg.referenceSourcePolicy,publicationTasks:publications});
 if(fixtureOptions.controlledReception){
  const {sealAccountCredential}=await import('../lib/accountCredentials.js');
  const {savePublicationReceptionBinding}=await import('../socialPrograms/publicationReceptionService.js');
  const {refreshPlatformCapabilityEvidence}=await import('../publishing/platformCapabilities.js');
  f.tables.social_accounts=[{id:'account',tenantId:'t',platform:'tiktok',status:'connected',providerAccountId:'five-controlled-account',scope:'video.publish',accessToken:sealAccountCredential('five-controlled-token')},controlledMessengerAccount({accountId:'five-sales',tenantId:'t',pageId:'five-controlled-sales'})];
  const owner=await f.store.getById<Record<string,unknown>>('users','owner');assert.ok(owner);await f.store.update('users','owner',{role:'admin',active:true,disabled:false});
  const bindings=new Map<string,string>();
  for(const publication of pkg.socialContentPackage.publicationTasks){
   assert.ok(publication.cta);
   const binding=await savePublicationReceptionBinding(f.store,{tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version+2,publicationId:publication.publicationTaskId,cta:publication.cta,enterpriseFactHash:f.profile.factVersion!.contentHash,targets:[{id:'five-sales',required:true,ownerId:'owner',destination:{kind:'messaging',channel:'messenger',receptionMode:'human'},requiredDocumentUrls:[]}]},'owner');
   bindings.set(publication.publicationTaskId,binding.bindingId);
  }
  pkg=await packages.revise('t','owner','p',pkg.packageId,{expectedVersion:pkg.version,publicationTasks:pkg.socialContentPackage.publicationTasks.map(publication=>({...publication,receptionRequirement:{required:true,bindingId:bindings.get(publication.publicationTaskId)!}}))});
  await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:'account',platform:'tiktok',capability:'publishing.official',dataStore:f.store,providers:{async tiktok(){return{openId:'five-controlled-account',publishGranted:true};},async youtube(){throw Error('unused');},async instagram(){throw Error('unused');},async facebook(){throw Error('unused');},async tiktokReceipt(){throw Error('unused');}}});
 }
 const planning=createWeeklyPlanningAuthority(f.store);
 const initial=await planning.initialize('t',pkg);
 const analyzed=await planning.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 if(analyzed.directorGaps?.length)console.log('FIVE_DIRECTOR_GAPS',JSON.stringify(analyzed.directorGaps));
 const detailed=await planning.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analyzed.version,actor:'business_agent'});
 const confirmed=await planning.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:detailed.version,userId:'owner'});
 const dispatched=await planning.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmed.version,actor:'business_agent'});
 assert.ok(dispatched.dispatch);await applyBusinessDispatchToExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version,dispatched.dispatch,clock);
 const tasks=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version);
 const consumerRequirement=fixtureOptions.consumerRequirement?await fixtureOptions.consumerRequirement({setup,tasks,pkg}):'同一已授权企业产品身份图';
 const consumers=tasks.filter(task=>task.schedule.stepKind==='material_readiness').map(task=>({taskId:task.taskId,packageId:pkg.packageId,packageVersion:pkg.version,requirement:typeof consumerRequirement==='string'?consumerRequirement:consumerRequirement[task.publicationTaskId!]!}));
 assert.equal(consumers.length,5);
 const request=await createWeeklyMaterialRequestService(f.store).create({tenantId:'t',programId:'p',requirementKey,requirements:'五条视频共用的企业产品身份图，须先上传核验',assigneeUserId:'owner',reviewerUserId:'owner',dueAt:'2026-10-09T00:00:00Z',verificationDueAt:'2026-10-09T01:00:00Z',timeZone:'Asia/Shanghai',consumers,actorUserId:'owner'});
 assert.equal(request.requestId,requestId);
 for(const [scope,scopeKey] of [['tenant','*'],['account','account'],['task_type','social_content_weekly']] as const)await setContentExecutionLimit({dataStore:f.store,tenantId:'t',scope,scopeKey,maxRunning:1,updatedBy:'owner',now:new Date(clock)});
 const schedule=createWeeklyInitialScheduleService(f.store,{now:()=>clock});
 const authority={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,actorUserId:'owner'};
 const proposal=await schedule.propose(authority,{constraints:Object.fromEntries(tasks.map(task=>[task.taskId,{resourceKey:task.schedule.responsibleActor,remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:1,bufferMinutes:0,availableAt:clock}])),resources:Object.fromEntries([...new Set(tasks.map(task=>task.schedule.responsibleActor))].map(actor=>[actor,{concurrency:1,workingWindows:[{startAt:clock,finishAt:'2026-10-26T20:00:00Z'}]}])),remainingBudgetCny:1000,operationalDeadlines:Object.fromEntries(tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-10-26T18:00:00Z']))});
 assert.equal(proposal.plan.publicationGap,0,JSON.stringify(proposal.plan.assignments.filter(a=>a.mode!=='planned').map(a=>({id:a.taskId,why:a.reasons}))));
 const confirmation=await schedule.confirm(authority,{proposalId:proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:proposal.inputEvidenceHash});
 assert.equal(confirmation.activated,false);
 const scheduledPkg=await packages.get('t','p',pkg.packageId);
 const fresh=await planning.initialize('t',scheduledPkg);
 const freshAnalysis=await planning.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:scheduledPkg.packageId,packageVersion:scheduledPkg.version,expectedPlanningVersion:fresh.version,actor:'director_agent'});
 const freshDetail=await planning.mergeDetailedSchedule({tenantId:'t',programId:'p',package:scheduledPkg,expectedPlanningVersion:freshAnalysis.version,actor:'business_agent'});
 const freshConfirmation=await planning.confirm({tenantId:'t',programId:'p',packageId:scheduledPkg.packageId,packageVersion:scheduledPkg.version,expectedPlanningVersion:freshDetail.version,userId:'owner'});
 const freshDispatch=await planning.dispatch({tenantId:'t',programId:'p',packageId:scheduledPkg.packageId,packageVersion:scheduledPkg.version,expectedPlanningVersion:freshConfirmation.version,actor:'business_agent'});
 assert.ok(freshDispatch.dispatch);await applyBusinessDispatchToExecutionTasks(f.store,'t','p',scheduledPkg.packageId,scheduledPkg.version,freshDispatch.dispatch,clock);
 const configured=f.tables.starter_198_access.filter(row=>row.tenant_id==='t');assert.equal(configured.length,1);
 await f.store.update('starter_198_access',configured[0]!.id,{cycle_started_at:'2026-10-09T00:00:00Z',cycle_ends_at:'2026-10-27T00:00:00Z'});
 const activated=await packages.activate('t','owner','p',scheduledPkg.packageId,{expectedVersion:scheduledPkg.version,expectedProgramVersion:1,authorizePublishing:true});
 const actualTasks=await listWeeklyExecutionTasks(f.store,'t','p',activated.packageId,activated.version);
 const actualRequest=await createWeeklyMaterialRequestService(f.store).get('t','p',request.requestId,'owner');
 return{...setup,pkg:activated,originalPkg:pkg,dispatched:freshDispatch,tasks:actualTasks,request:actualRequest,packages,clock,capacity,proposal,confirmation};
}
