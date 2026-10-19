import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyNonPresenterPlanningFixture} from '../runtime/weeklyNonPresenterProduction.fixture.js';
import {createLegacyWeeklyContentActions,legacyWeeklyPlanHash,type LegacyWeeklyCreateInput} from './legacyWeeklyContentActions.js';
import {normalizeDigitalEmployeeConfig} from '../digitalEmployees/domain.js';
import {resolveKnowledgeBinding} from '../digitalEmployees/configuration.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {legacyIncrementalCostBlocker,LEGACY_INCREMENTAL_COST_BLOCKER} from '../digitalEmployees/legacyIncrementalCostGuard.js';
import {readLegacyManualCompletion} from '../digitalEmployees/legacyIncrementalCostGuard.js';
import {studioProjectQualityFingerprint} from '../lib/studioProjectQuality.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {withDigitalEmployeeRunLock} from '../digitalEmployees/runControl.js';
async function fixture(t:Parameters<typeof prepareWeeklyNonPresenterPlanningFixture>[0],overrides:{invalidatePublishing?:(tenantId:string,runId:string)=>Promise<unknown>}={}){
 const {f}=await prepareWeeklyNonPresenterPlanningFixture(t);
 const config=normalizeDigitalEmployeeConfig({enabledWorkflows:['product_content','content_publish'],videoLanguages:['en'],videoDefaults:{language:'en',duration:15},companyName:'企业',customerProfile:'采购商',primaryGoal:'leads'});
 const profile={company:{name:'企业'},products:{items:[{id:'product',name:'企业产品'}]}};
 const body={configSnapshot:config,knowledgeBinding:resolveKnowledgeBinding(profile,config,'2026-10-16T00:00:00Z'),businessPackage:{revision:1,tasks:[{templateId:'production',videoPlans:[{contentId:'old-content',estimatedCost:1}]}],authorization:{mode:'bounded',allowRealPublishing:true},directorPlan:{productionBudget:10,productionSpent:1,productionReserved:1,originalTarget:1}}};
 f.tables.weekly_goals=[{id:'legacy-goal',tenant_id:'t',title:'本周内容',objective:'解释产品',metric:'内容',starts_at:'2026-10-12T00:00:00Z',ends_at:'2026-10-18T23:59:59Z',status:'active'}];
 f.tables.weekly_plans=[{id:'legacy-plan',tenant_id:'t',goal_id:'legacy-goal',status:'approved',plan:body}];
 f.tables.workflow_runs=[{id:'legacy-run',tenant_id:'t',goal_id:'legacy-goal',plan_id:'legacy-plan',status:'waiting_external'}];
 f.tables.workflow_tasks=['content_production','content_quality_gate','content_release_approval','publishing_calendar','platform_publish'].map((key,index)=>({id:`task-${key}`,tenant_id:'t',run_id:'legacy-run',task_key:key,status:index?'succeeded':'waiting_external',output:{preserve:'old-receipt'},business_refs:[{type:'studio_project',id:'old-project'}]}));
 const oldOrder={id:'old-order',productId:'product',status:'planned',untouched:true};
 f.tables.content_batch_plans=[{id:'legacy-batch',tenant_id:'t',run_id:'legacy-run',status:'planned',orders:[oldOrder],config_version:1,policy_version:'policy1',facts_version:'facts1'}];
 f.tables.studio_projects=[{id:'old-project',tenant_id:'t',status:'ready_for_approval',spec:{workflowRunId:'legacy-run',contentOrderId:'old-order',preserve:true}}];
 let reconciled=0,revoked=0;
 const service=createLegacyWeeklyContentActions(f.store,{reconcile:async()=>{reconciled++;},invalidatePublishing:overrides.invalidatePublishing??(async()=>{revoked++;}),materialize:async input=>{for(const order of input.contentOrders??[]){if(!(order as any).assistantAdmission)continue;if(f.tables.studio_projects!.some(p=>(p.spec as any).contentOrderId===order.id))continue;await f.store.create('studio_projects',{tenant_id:'t',status:'draft',spec:{workflowRunId:input.runId,workflowTaskId:input.taskId,contentOrderId:order.id,contentOrder:order,automation:{managedBy:'digital_employee',stage:'script',status:'blocked',blocker:LEGACY_INCREMENTAL_COST_BLOCKER}}});}}});
 const input:LegacyWeeklyCreateInput={requestId:'legacy-add-one',goalId:'legacy-goal',planId:'legacy-plan',runId:'legacy-run',expectedPlanHash:legacyWeeklyPlanHash(body),productId:'product',goal:'解释产品适合哪些使用场景',platform:'tiktok',dueAt:'2026-10-17T10:00:00Z',maximumAdditionalCostCny:5,confirmAdditionalBudget:true,acknowledgePublishingRevocation:true,publishMode:'draft_only'};
 return {f,service,input,oldOrder,counters:()=>({reconciled,revoked})};
}
test('visible week appends one real order, preserves old projects and requires fresh release review',async t=>{
 const {f,service,input,oldOrder,counters}=await fixture(t),oldProjects=socialRequestHash(f.tables.studio_projects![0]);
 const result=await service.create({tenantId:'t',userId:'owner'},input);
 assert.equal(result.model,'legacy');assert.equal(result.batchPlanId,'legacy-batch');assert.equal(result.taskId,'task-content_production');
 const orders=f.tables.content_batch_plans![0]!.orders as any[];assert.equal(orders.length,2);assert.deepEqual(orders[0],oldOrder);assert.equal(orders[1].id,result.orderId);assert.equal(orders[1].accountId,'');assert.equal(orders[1].deliveryVariants.length,0);
 assert.equal(socialRequestHash(f.tables.studio_projects![0]),oldProjects);assert(f.tables.workflow_tasks!.every(task=>task.status==='pending'));assert(f.tables.workflow_tasks!.every(task=>(task.output as any).preserve==='old-receipt'));
 assert.equal(result.state,'awaiting_cost_review');assert(result.projectId);assert.equal(result.navigation.page,'smartAssets');assert(result.navigation.href.includes(result.projectId));assert.equal(legacyIncrementalCostBlocker(orders[1]),LEGACY_INCREMENTAL_COST_BLOCKER);
 assert.equal(f.tables.workflow_tasks!.find(task=>task.task_key==='content_release_approval')!.requires_approval,true);assert.equal(counters().revoked,1);
 const replay=await service.create({tenantId:'t',userId:'owner'},input);assert.equal(replay.repeated,true);assert.equal((f.tables.content_batch_plans![0]!.orders as any[]).length,2);assert.equal(replay.orderId,result.orderId);
});
test('stale plan or missing explicit budget refuses admission and provider execution',async t=>{
 const {f,service,input,counters}=await fixture(t);
 await assert.rejects(service.create({tenantId:'t',userId:'owner'},{...input,acknowledgePublishingRevocation:false}),{code:'assistant_weekly_publishing_revocation_acknowledgment_required'});
 await assert.rejects(service.create({tenantId:'t',userId:'owner'},{...input,confirmAdditionalBudget:false}),{code:'assistant_weekly_create_input_invalid'});
 await assert.rejects(service.create({tenantId:'t',userId:'owner'},{...input,expectedPlanHash:'f'.repeat(64)}),{code:'assistant_weekly_plan_changed'});
 Object.assign(f.tables.weekly_goals![0]!,{metric:'approved_social_content_artifacts',scope:{socialTaskId:'canonical-bridge'}});
 await assert.rejects(service.create({tenantId:'t',userId:'owner'},{...input,requestId:'bridge-cannot-be-current-week'}),{code:'assistant_operating_week_required'});
 assert.equal((f.tables.content_batch_plans![0]!.orders as any[]).length,1);assert.equal(counters().reconciled,0);
});

test('failure after plan receipt resumes one order without adding budget twice',async t=>{
 const {f,service,input}=await fixture(t),update=f.store.update.bind(f.store);let failed=false;
 f.store.update=async(collection,id,data)=>{if(collection==='content_batch_plans'&&!failed){failed=true;return false;}return update(collection,id,data);};
 await assert.rejects(service.create({tenantId:'t',userId:'owner'},input),{code:'assistant_weekly_batch_write_failed'});
 const afterFailure=f.tables.weekly_plans![0]!.plan as any;assert.equal(afterFailure.businessPackage.directorPlan.productionBudget,15);
 const result=await service.create({tenantId:'t',userId:'owner'},input);
 assert.equal((f.tables.content_batch_plans![0]!.orders as any[]).filter(order=>order.id===result.orderId).length,1);
 assert.equal((f.tables.weekly_plans![0]!.plan as any).businessPackage.directorPlan.productionBudget,15);
});

test('legacy automatic runner cannot bypass missing all-provider cost authority',async()=>{
 const {advanceOneProject}=await import('../digitalEmployees/contentProduction.js');
 const input:any={tenantId:'t',record:{id:'cost-blocked-project',spec:{contentOrder:{assistantAdmission:true,publishMode:'draft_only',maximumAdditionalCostCny:1},automation:{stage:'script',status:'queued'}}},config:{},goal:{},profile:{},assets:[],analyses:[],allProjects:[]};
 const before=socialRequestHash(input.record),result=await advanceOneProject(input);
 assert.equal(result.changed,false);assert.equal(result.blocker,LEGACY_INCREMENTAL_COST_BLOCKER);assert.equal(socialRequestHash(input.record),before);
});

test('same-run revocation lock re-enters without deadlock and completes before production materialization',{timeout:10000},async t=>{
 let revoked=false;
 const {f,service,input}=await fixture(t,{invalidatePublishing:async(tenantId,runId)=>withDigitalEmployeeRunLock(tenantId,runId,async()=>{revoked=true;})});
 const create=f.store.create.bind(f.store);f.store.create=async(collection,data)=>{if(collection==='studio_projects'&&(data.spec as any)?.contentOrder?.assistantAdmission)assert.equal(revoked,true);return create(collection,data);};
 const result=await service.create({tenantId:'t',userId:'owner'},input);assert(result.projectId);assert.equal(revoked,true);assert.equal((f.tables.content_batch_plans![0]!.orders as any[]).length,2);
});

test('revocation failure cannot start production and retry resumes one durable admission',{timeout:10000},async t=>{
 let failRevocation=true;
 const {f,service,input,counters}=await fixture(t,{invalidatePublishing:async(tenantId,runId)=>withDigitalEmployeeRunLock(tenantId,runId,async()=>{if(failRevocation)throw Error('controlled_revocation_failure');})});
 await assert.rejects(service.create({tenantId:'t',userId:'owner'},input),/controlled_revocation_failure/);
 assert.equal(f.tables.studio_projects!.length,1);assert.equal(counters().reconciled,0);assert.equal(f.tables.workflow_tasks!.find(task=>task.task_key==='content_quality_gate')!.status,'succeeded');
 failRevocation=false;const result=await service.create({tenantId:'t',userId:'owner'},input);assert(result.projectId);assert.equal((f.tables.content_batch_plans![0]!.orders as any[]).filter(order=>order.id===result.orderId).length,1);assert.equal((f.tables.weekly_plans![0]!.plan as any).businessPackage.directorPlan.productionBudget,15);
});

test('real manual render receipt and current workbench quality recover weekly delivery without paid stages',async t=>{
 const {f}=await prepareWeeklyNonPresenterPlanningFixture(t);
 const parent=path.resolve(process.cwd(),'data/publishing-uploads');await fs.mkdir(parent,{recursive:true});
 const directory=await fs.mkdtemp(path.join(parent,'manual-proof-')),tenantId=path.basename(directory),file=path.join(directory,'actual-render.mp4');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const rendered=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=160x160:r=10','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p',file],false);assert.equal(rendered.ok,true,rendered.stderr);
 const order:any={id:'manual-order',productId:'product',productName:'企业产品',route:'product',platform:'tiktok',languages:['en'],status:'planned',theme:{key:'selected',label:'产品介绍'},evidenceRefs:[],readinessBlockers:[LEGACY_INCREMENTAL_COST_BLOCKER],assistantAdmission:true,publishMode:'draft_only',videoPlan:{route:'product',productId:'product',productName:'企业产品',theme:'产品介绍',platform:'tiktok',language:'en',duration:15,presenter:'material'}};
 const spec:any={contentMode:'video',creationPath:'free',script:'已审核脚本',storyboardAssignments:{scene:'material'},voiceoverMode:'none',subtitlesOn:false,lang:'en',workflowRunId:'manual-run',workflowTaskId:'manual-task',workflowTaskKey:'content_production',contentOrderId:'manual-order::en',contentOrder:order,renderAcceptance:{accepted:true,renderPath:file},languageRenderOutputs:{en:{status:'done',path:file,inputSignature:'actual-render-signature'}},manualRenderJob:{id:'actual-render-job',status:'completed',outputPath:file,inputSignature:'actual-render-signature'},automation:{managedBy:'digital_employee',stage:'script',status:'blocked',route:'product'}};
 const quality={id:'actual-quality-review',inputFingerprint:studioProjectQualityFingerprint(spec),generationProvenance:'ai',qualityStatus:'passed',publishable:true,renderPath:file,report:{gateVersion:'studio-project-quality-v1',checks:['storyboard_materials','voice_subtitles','render_acceptance','input_fingerprint'].map(id=>({id,passed:true,detail:'existing verified manual review'}))}};spec.projectQualityRecords=[quality];spec.activeProjectQualityRecordId=quality.id;
 const project:any={id:'manual-project',tenant_id:tenantId,status:'draft',spec};f.tables.studio_projects=[project];f.tables.studio_render_jobs=[{id:'actual-render-job',tenant_id:tenantId,project_id:project.id,status:'completed',output_path:file,output_key:'en',input_signature:'actual-render-signature'}];
 const proof=await readLegacyManualCompletion(f.store,tenantId,project);assert(proof);assert.equal(proof.jobId,'actual-render-job');assert(proof.outputBytes>32);
 const {recoverIndependentContentTask}=await import('./independentWeeklyContent.js');
 const independentTask:any={id:'manual-task',tenant_id:tenantId,run_id:'manual-run',status:'waiting_external',output:{assistantIndependent:{orderId:'manual-order',order,dueAt:'2026-10-17T04:00:00Z'}}};
 f.tables.workflow_tasks=[independentTask];
 await recoverIndependentContentTask(f.store,tenantId,independentTask,project);
 assert.equal(independentTask.output.delivery.jobId,'actual-render-job');
 assert.equal(independentTask.status,'waiting_external','a real file is not user acceptance');
 const {store}=await import('../storage/index.js'),originals={getById:store.getById,list:store.list,create:store.create,update:store.update};
 Object.assign(store,{getById:f.store.getById.bind(f.store),list:f.store.list.bind(f.store),create:f.store.create.bind(f.store),update:f.store.update.bind(f.store)});t.after(()=>Object.assign(store,originals));
 const {advanceAutomatedContentProduction}=await import('../digitalEmployees/contentProduction.js');
 const config=normalizeDigitalEmployeeConfig({enabledWorkflows:['product_content'],videoLanguages:['en'],focusProducts:'企业产品'}),profile:any={products:{items:[{id:'product',name:'企业产品'}]}};
 const result=await advanceAutomatedContentProduction({tenantId,runId:'manual-run',taskId:'manual-task',config,goal:{title:'本周内容',contentPlatforms:['tiktok']} as any,enterpriseProfile:profile,contentOrders:[order]});
 assert.equal(result.ready,true,result.blocker);const recovered=f.tables.studio_projects![0]!;assert.equal(recovered.status,'ready_for_approval');assert.equal((recovered.spec as any).automation.stage,'completed');assert.equal((recovered.spec as any).contentOrder.assistantAdmission,true,'cost authority is never cleared');
 const changed={...project,spec:{...spec,script:'质检后修改的脚本'}};assert.equal(await readLegacyManualCompletion(f.store,tenantId,changed),null);
 await recoverIndependentContentTask(f.store,tenantId,independentTask,changed);
 assert.equal(independentTask.output.delivery,null,'stale deliverable is removed from the same card');
});
