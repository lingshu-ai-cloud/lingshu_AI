import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyNonPresenterPlanningFixture} from '../runtime/weeklyNonPresenterProduction.fixture.js';
import {createWeeklyContentActions} from './weeklyContentActions.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';
import {listWeeklyExecutionTasks,materializeWeeklyExecutionTasks,applyBusinessDispatchToExecutionTasks} from '../socialPrograms/executionTasks.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {createSocialOperatingDecisionService} from '../socialOperating/service.js';
import {planCapacity} from '../socialOperating/capacityPlanner.js';
import {resolveAutomationPolicy} from '../socialOperating/automationPolicyResolver.js';
import {setContentExecutionLimit} from '../contentExecution/durableQueue.js';
import {createSocialOperatingOrchestrationService} from '../socialOperating/orchestration.js';
import {createWeeklyInitialScheduleService} from '../socialPrograms/weeklyInitialSchedule.js';
async function dispatchPlanning(store:Parameters<typeof createWeeklyPlanningAuthority>[0],pkg:Parameters<ReturnType<typeof createWeeklyPlanningAuthority>['initialize']>[1],clock:string){
 const planning=createWeeklyPlanningAuthority(store),initial=await planning.initialize('t',pkg);
 const director=await planning.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 const detailed=await planning.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:director.version,actor:'business_agent'});
 const confirmed=await planning.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:detailed.version,userId:'owner'});
 const dispatched=await planning.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmed.version,actor:'business_agent'});
 await applyBusinessDispatchToExecutionTasks(store,'t','p',pkg.packageId,pkg.version,dispatched.dispatch!,clock);
}
async function fixture(t:Parameters<typeof prepareWeeklyNonPresenterPlanningFixture>[0]){
 const setup=await prepareWeeklyNonPresenterPlanningFixture(t,{ownedReferenceBytes:true,primaryStructure:true,metricTargets:['播放量']});
 const {f}=setup,decisions=createSocialOperatingDecisionService(f.store),ref=setup.pkg.businessContentGoalRef!;
 const goal=await decisions.getGoal('t','p',ref.id,ref.version),options={operator:{type:'user' as const,id:'owner'},decidedAt:'2026-10-01T00:00:00Z'};
 const capacity=planCapacity({goal,desiredOriginalContents:1,desiredAdaptations:0,costPerOriginalCny:1,costPerAdaptationCny:1,readyMaterialUnits:2,materialUnitsPerOriginal:1,productionItemsPerDay:2,daysUntilDeadline:7,accounts:[{ref:{type:'owned_social_account',id:'account',version:2},accountId:'account',status:'active',weeklyPublicationCapacity:2}],interactionItemsPerWeek:10,salesLeadsPerWeek:10,expectedInteractionsPerPublication:1,expectedLeadsPerPublication:1,capabilities:{'studio.production':'available','publishing.calendar':'available','customer.attribution':'available'}},options);
 await decisions.saveOperatingDecision('t','p',capacity.decision);
 const policy=resolveAutomationPolicy({goal,mode:'managed',action:'draft',capability:{key:'studio.production',availability:'available'},factsVerified:true,withinBudget:true,rightsSufficient:true},options);await decisions.saveOperatingDecision('t','p',policy.decision);
 const pkg=await createWeeklyOperatingPackageService(f.store).create('t','owner','p',{weekStart:'2026-10-05',objective:goal.objective,successCriteria:['完成内容'],enterpriseProfileRef:{type:'enterprise_profile',id:'profile',version:1},businessContentGoalRef:ref,capacityPlanRef:{type:'capacity_plan',id:capacity.decision.decisionId,version:1},automationPolicyRef:{type:'automation_policy',id:policy.decision.decisionId,version:1},referenceSourcePolicy:setup.pkg.referenceSourcePolicy,publicationTasks:structuredClone(setup.pkg.socialContentPackage.publicationTasks)});
 const expanded=planCapacity({goal,desiredOriginalContents:2,desiredAdaptations:0,costPerOriginalCny:1,costPerAdaptationCny:1,readyMaterialUnits:3,materialUnitsPerOriginal:1,productionItemsPerDay:3,daysUntilDeadline:7,accounts:[{ref:{type:'owned_social_account',id:'account',version:2},accountId:'account',status:'active',weeklyPublicationCapacity:3}],interactionItemsPerWeek:10,salesLeadsPerWeek:10,expectedInteractionsPerPublication:1,expectedLeadsPerPublication:1,capabilities:{'studio.production':'available','publishing.calendar':'available','customer.attribution':'available'}},options);
 await decisions.saveOperatingDecision('t','p',expanded.decision);
 return {f,pkg,expandedRef:{type:'capacity_plan' as const,id:expanded.decision.decisionId,version:1}};
}

test('new content rejects mismatched product without changing active week or starting production',async t=>{
 const {f,pkg}=await fixture(t);
 const publication=pkg.socialContentPackage.publicationTasks[0]!;
 await materializeWeeklyExecutionTasks(f.store,'t',pkg);
 const before=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version);
 const input={requestId:'new-content-mismatched-product',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:'not-the-confirmed-product',goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!};
 await assert.rejects(createWeeklyContentActions(f.store).graph({tenantId:'t',userId:'owner'},input),{code:'assistant_weekly_product_goal_mismatch'});
 assert.equal(socialRequestHash(await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version)),socialRequestHash(before));
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('persisted expanded capacity admits distinct new script nodes without changing original tasks',async t=>{
 const {f,pkg,expandedRef}=await fixture(t);
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version),publication=pkg.socialContentPackage.publicationTasks[0]!;
 const before=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version);
 const input={requestId:'new-content-expanded-capacity',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:goal!.products[0]!,goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!,capacityPlanRef:expandedRef};
 const graph=await createWeeklyContentActions(f.store).graph({tenantId:'t',userId:'owner'},input);
 assert(graph.bindings.some(b=>b.origin==='new_planned'));
 assert(graph.tasks.some(task=>task.schedule.stepKind==='script'&&graph.bindings.some(b=>b.origin==='new_planned'&&b.planningTaskId===task.taskId)));
 assert.equal(socialRequestHash(await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version)),socialRequestHash(before));
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('new content cannot confirm incomplete planning despite supplied capacity; no provider execution',async t=>{
 const {f,pkg,expandedRef}=await fixture(t),clock='2026-10-01T00:00:00Z';
 for(const [scope,scopeKey]of [['tenant','*'],['account','account'],['task_type','social_content_weekly']] as const)await setContentExecutionLimit({dataStore:f.store,tenantId:'t',scope,scopeKey,maxRunning:4,updatedBy:'owner',now:new Date(clock)});
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version),publication=pkg.socialContentPackage.publicationTasks[0]!;
 const input={requestId:'new-content-confirm-capacity',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:goal!.products[0]!,goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!,capacityPlanRef:expandedRef};
 const service=createWeeklyContentActions(f.store,{now:()=>clock}),scope={tenantId:'t',userId:'owner'},graph=await service.graph(scope,input);
 const capacity={constraints:Object.fromEntries(graph.tasks.map(task=>[task.taskId,{resourceKey:'production',remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:0,bufferMinutes:0,availableAt:clock}])),resources:{production:{concurrency:4,workingWindows:[{startAt:clock,finishAt:'2026-10-15T20:00:00Z'}]}},remainingBudgetCny:100,operationalDeadlines:Object.fromEntries(graph.tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-10-15T18:00:00Z']))};
 const preview=await service.preview(scope,input,capacity);
 assert(preview.proposal.plan.publicationGap>0);
 await assert.rejects(service.confirm(scope,input,{proposalId:preview.proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:preview.proposal.inputEvidenceHash}),{code:'weekly_schedule_fresh_capacity_not_feasible'});
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('complete source planning supports confirmed new content schedule',async t=>{
 const {f,pkg,expandedRef}=await fixture(t),clock='2026-10-01T00:00:00Z';
 const planning=createWeeklyPlanningAuthority(f.store),initial=await planning.initialize('t',pkg);
 const director=await planning.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 const detailed=await planning.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:director.version,actor:'business_agent'});
 const confirmed=await planning.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:detailed.version,userId:'owner'});
 const dispatched=await planning.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmed.version,actor:'business_agent'});
 await applyBusinessDispatchToExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version,dispatched.dispatch!,clock);
 for(const [scope,scopeKey]of [['tenant','*'],['account','account'],['task_type','social_content_weekly']] as const)await setContentExecutionLimit({dataStore:f.store,tenantId:'t',scope,scopeKey,maxRunning:4,updatedBy:'owner',now:new Date(clock)});
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version),publication=pkg.socialContentPackage.publicationTasks[0]!;
 const input={requestId:'new-content-complete-source',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:goal!.products[0]!,goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!,capacityPlanRef:expandedRef};
 const service=createWeeklyContentActions(f.store,{now:()=>clock}),scope={tenantId:'t',userId:'owner'},graph=await service.graph(scope,input);
 const capacity={constraints:Object.fromEntries(graph.tasks.map(task=>[task.taskId,{resourceKey:'production',remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:0,bufferMinutes:0,availableAt:clock}])),resources:{production:{concurrency:4,workingWindows:[{startAt:clock,finishAt:'2026-10-15T20:00:00Z'}]}},remainingBudgetCny:100,operationalDeadlines:Object.fromEntries(graph.tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-10-15T18:00:00Z']))};
 const preview=await service.preview(scope,input,capacity);
 await assert.rejects(service.preview(scope,input,{...capacity,conditionalPlanningGateTaskIds:graph.tasks.map(t=>t.taskId)} as any),{code:'weekly_schedule_capacity_field_invalid'});
 assert.equal(preview.proposal.plan.publicationGap,0,JSON.stringify(preview.proposal.plan.assignments.filter(a=>a.reasons.length).map(a=>({...a,task:graph.tasks.find(t=>t.taskId===a.taskId),binding:graph.bindings.find(b=>b.planningTaskId===a.taskId)}))));
 const result=await service.confirm(scope,input,{proposalId:preview.proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:preview.proposal.inputEvidenceHash});
 assert.equal(result.packageVersion,pkg.version+1);assert(result.executionTaskIds.length>0);assert.equal(f.tables.content_execution_jobs?.length??0,0);
 const target=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,result.packageVersion);
 const newGate=target.find(task=>task.publicationTaskId===result.publicationTaskId&&task.schedule.stepKind==='material_readiness')!;
 assert(newGate.ownBlockingReasons.includes('business_dispatch_required'));assert.notEqual(newGate.status,'succeeded');
 const snapshots=await f.store.list<any>('social_weekly_schedule_snapshots',{where:{tenant_id:'t',package_id:pkg.packageId},perPage:10});
 assert(snapshots.items.some(row=>row.payload.publicationTimes.some((p:any)=>p.publicationTaskId===result.publicationTaskId)));
});

test('draft admission persists real weekly tasks and repeats without duplicate publication',async t=>{
 const {f,pkg,expandedRef}=await fixture(t);
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version),publication=pkg.socialContentPackage.publicationTasks[0]!;
 const input={requestId:'new-content-draft-admission',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:goal!.products[0]!,goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!,capacityPlanRef:expandedRef};
 const service=createWeeklyContentActions(f.store),scope={tenantId:'t',userId:'owner'};
 const result=await service.create(scope,input);assert.equal(result.state,'awaiting_review');assert(result.executionTaskIds.length>0);
 const replay=await service.create(scope,input);assert.equal(replay.repeated,true);assert.equal(replay.publicationTaskId,result.publicationTaskId);assert.equal(replay.packageVersion,result.packageVersion);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('stable knowledge product ID resolves only through the exact owned product record',async t=>{
 const {f,pkg,expandedRef}=await fixture(t),publication=pkg.socialContentPackage.publicationTasks[0]!;
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);
 f.tables.tenant_profiles=[{id:'owned-profile',tenant_id:'t',profile:{products:{items:[{id:'knowledge-product-stable',name:goal!.products[0]}]}}}];
 const input={requestId:'stable-kb-product',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:'knowledge-product-stable',goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!,capacityPlanRef:expandedRef};
 const service=createWeeklyContentActions(f.store),scope={tenantId:'t',userId:'owner'};
 const graph=await service.graph(scope,input);assert(graph.bindings.some(b=>b.origin==='new_planned'));
 await assert.rejects(service.graph(scope,{...input,productId:'knowledge-product'}),{code:'assistant_weekly_product_goal_mismatch'});
 await assert.rejects(service.scheduleInput(scope,input),{code:'assistant_weekly_capacity_authorization_required'});
});

test('canonical capacity preview and explicit budget confirmation issue a durable bounded receipt',async t=>{
 let {f,pkg}=await fixture(t);const publication=pkg.socialContentPackage.publicationTasks[0]!,clock='2026-10-01T00:00:00Z';
 await dispatchPlanning(f.store,pkg,clock);
 for(const [scope,scopeKey]of [['tenant','*'],['account','account'],['task_type','social_content_weekly']] as const)await setContentExecutionLimit({dataStore:f.store,tenantId:'t',scope,scopeKey,maxRunning:4,updatedBy:'owner',now:new Date(clock)});
 const initialSchedule=createWeeklyInitialScheduleService(f.store,{now:()=>clock}),initialScope={tenantId:'t',actorUserId:'owner',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version};
 const initialGraph=(await initialSchedule.preview(initialScope)).graph;
 const initialCapacity={constraints:Object.fromEntries(initialGraph.tasks.map(task=>[task.taskId,{resourceKey:'production',remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:0,bufferMinutes:0,availableAt:clock}])),resources:{production:{concurrency:4,workingWindows:[{startAt:clock,finishAt:'2026-10-15T20:00:00Z'}]}},remainingBudgetCny:10,operationalDeadlines:Object.fromEntries(initialGraph.tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-10-15T18:00:00Z']))};
 const initialProposal=await initialSchedule.propose(initialScope,initialCapacity),initialReceipt=await initialSchedule.confirm(initialScope,{proposalId:initialProposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:initialProposal.inputEvidenceHash});
 pkg=initialReceipt.item;await dispatchPlanning(f.store,pkg,clock);
 const program=f.tables.social_programs!.find(row=>row.program_id==='p')!.payload as any;
 pkg=await createWeeklyOperatingPackageService(f.store).activate('t','owner','p',pkg.packageId,{expectedVersion:pkg.version,expectedProgramVersion:program.version});assert.equal(pkg.status,'active');
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);
 f.tables.tenant_profiles=[{id:'owned-profile',tenant_id:'t',version:1,profile:{company:{description:'企业产品工厂',mainMarkets:'US',primaryLanguages:'en'},products:{items:[{id:'owned-product',name:goal!.products[0],images:[{id:'asset1'},{id:'asset2'},{id:'asset3'}]}]},customers:{targetProfiles:'企业采购'}}}];
 const latest=f.tables.social_owned_accounts!.sort((a,b)=>Number(b.version)-Number(a.version))[0]!;
 const payload=structuredClone(latest.payload) as any;payload.conversionRoute={routeId:'owned-route',entryType:'form',entryRef:'https://example.test/form',callToAction:'Contact sales',qualificationFields:[],handoffTarget:'owner',verifiedAt:clock};
 f.tables.social_owned_accounts=[{...latest,payload}];
 f.tables.digital_employee_configs=[{id:'config',tenant_id:'t',status:'active',activated_at:clock,config_version:1,config:{autonomyMode:'managed',approvalOwner:'owner',enabledWorkflows:['product_content','content_publish','customer_segmentation'],publishingTargets:[{platform:'tiktok',accountId:'account',accountLabel:'TikTok'}]}}];
 f.tables.studio_production_defaults=[{id:'studio',tenant_id:'t',version:1,payload:{presenters:[{id:'p',authorized:true}]}}];
 await createSocialOperatingOrchestrationService(f.store,()=>clock).saveConstraints('t','owner','p',{expectedVersion:0,weeklyBudgetCny:10,costPerOriginalCny:1,costPerAdaptationCny:1,materialUnitsPerOriginal:1,productionItemsPerDay:3,interactionItemsPerWeek:10,salesLeadsPerWeek:10,expectedInteractionsPerPublication:1,expectedLeadsPerPublication:1,accountWeeklyPublicationCapacity:{account:3}});
 const input={requestId:'confirmed-capacity-budget',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:'owned-product',goal:'制作一条产品口播',platform:publication.platform,dueAt:'2026-10-09T10:00:00Z'};
 const service=createWeeklyContentActions(f.store,{now:()=>clock}),scope={tenantId:'t',userId:'owner'},proposal=await service.proposeCapacity(scope,input);
 assert.equal(proposal.canAdd,true,JSON.stringify(proposal));
 const confirmed=await service.confirmCapacity(scope,input,{snapshotRef:proposal.snapshotRef,proposalHash:proposal.proposalHash,approvedPublicationQuota:proposal.publicationQuota,approvedMaximumCostCny:proposal.estimatedCostCny,confirmed:true});
 assert(confirmed.capacityAuthorization.operationId);
 const admitted={...input,capacityPlanRef:confirmed.capacityPlanRef as any,operatingDecisionSnapshotRef:confirmed.operatingDecisionSnapshotRef,capacityAuthorization:confirmed.capacityAuthorization};
 await assert.rejects(service.scheduleInput(scope,{...admitted,capacityAuthorization:{...confirmed.capacityAuthorization,approvedMaximumCostCny:10}}),{code:'assistant_weekly_capacity_authorization_changed'});
 const schedule=await service.scheduleInput(scope,admitted);assert.equal(schedule.capacity.remainingBudgetCny,proposal.estimatedCostCny);
 const graph=await service.graph(scope,admitted);
 assert(Object.keys(schedule.capacity.operationalDeadlines).every(id=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(graph.tasks.find(task=>task.taskId===id)!.schedule.stepKind)));
 assert(!graph.tasks.filter(task=>task.schedule.stepKind==='publishing').some(task=>task.taskId in schedule.capacity.operationalDeadlines));
 assert(schedule.summary.some(line=>line.includes('待确认的排期假设')&&line.includes('原发布时间不变')));
 const originalTasks=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version),beforeHash=socialRequestHash(originalTasks);
 const preview=await service.preview(scope,admitted,schedule.capacity);
 assert.equal(preview.proposal.plan.publicationGap,0,JSON.stringify(preview.proposal.plan.assignments.filter(a=>a.reasons.length).map(a=>({...a,step:graph.tasks.find(t=>t.taskId===a.taskId)?.schedule.stepKind,duration:graph.tasks.find(t=>t.taskId===a.taskId)?.schedule.estimatedDurationMinutes}))));
 const receipt=await service.confirm(scope,admitted,{proposalId:preview.proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:preview.proposal.inputEvidenceHash});
 assert.equal(receipt.packageVersion,pkg.version+1);assert.equal(receipt.state,'awaiting_review');assert(receipt.executionTaskIds.length>0);
 assert.equal(socialRequestHash(await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version)),beforeHash);
 const newTasks=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,receipt.packageVersion);
 assert(newTasks.find(task=>task.publicationTaskId===receipt.publicationTaskId&&task.schedule.stepKind==='material_readiness')!.ownBlockingReasons.includes('business_dispatch_required'));
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('new content refuses quota overflow instead of silently omitting the requested task',async t=>{
 const {f,pkg}=await fixture(t);
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);
 const publication=pkg.socialContentPackage.publicationTasks[0]!;
 await materializeWeeklyExecutionTasks(f.store,'t',pkg);
 const before=await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version);
 const input={requestId:'new-content-real-graph',programId:'p',packageId:pkg.packageId,expectedVersion:pkg.version,accountId:publication.accountId,productId:goal!.products[0]!,goal:'制作一条产品口播',platform:publication.platform,dueAt:publication.publishWindow!};
 await assert.rejects(createWeeklyContentActions(f.store).graph({tenantId:'t',userId:'owner'},input),{code:'assistant_weekly_incremental_capacity_required'});
 assert.equal(socialRequestHash(await listWeeklyExecutionTasks(f.store,'t','p',pkg.packageId,pkg.version)),socialRequestHash(before));
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
});
