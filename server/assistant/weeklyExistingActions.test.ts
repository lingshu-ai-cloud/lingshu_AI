import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_} from '../storage/datastore.js';
import {createWeeklyExistingActions,type WeeklyExistingActionScope} from './weeklyExistingActions.js';
import {PUBLICATION_ASSIGNMENTS} from '../publishing/weeklyLineage.js';
import {planWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyQualityRecoveryFixture} from '../socialPrograms/weeklyContentQualityRecovery.fixture.js';

function fixture(){
 const scope:WeeklyExistingActionScope={tenantId:'tenant',userId:'user',programId:'program',packageId:'week',packageVersion:1,publicationTaskId:'pub',taskId:'content',artifactId:'artifact',expectedArtifactVersion:'v1'};
 const tables:Record<string,Record_[]>={users:[{id:'user',tenantId:'tenant',role:'social_operator'}],social_weekly_operating_packages:[{id:'week-row',tenant_id:'tenant',program_id:'program',package_id:'week',version:1,payload:{status:'active',version:1,packageId:'week',socialContentPackage:{publicationTasks:[{publicationTaskId:'pub'}]}}}],starter_social_content_tasks:[{id:'content-row',tenant_id:'tenant',task_id:'content',weekly_plan_id:'week',brief:{_weeklyAuthority:{weeklyPackage:{programId:'program',packageId:'week',version:1},publicationTask:{publicationTaskId:'pub'}}}}],starter_social_content_artifacts:[{id:'artifact-row',tenant_id:'tenant',task_id:'content',artifact_id:'artifact',version:'v1',status:'approved',content:{productionResult:{productionResultId:'production'}}}],social_weekly_execution_tasks:[{id:'publish-row',tenant_id:'tenant',program_id:'program',package_id:'week',package_version:1,payload:{taskId:'publish',publicationTaskId:'pub',status:'queued',schedule:{stepKind:'publish'}}}]};
 const store={async getById(c:string,id:string){return tables[c]?.find(r=>r.id===id)??null;},async list(c:string,q:any){const items=(tables[c]??[]).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return{items,totalItems:items.length,totalPages:1,page:1,perPage:q.perPage};}} as unknown as DataStore;
 let calls=0;
 const scan=async(input?:{tenantId?:string;taskId?:string;artifactId?:string})=>{if(input){assert.equal(input.tenantId,'tenant');assert.equal(input.taskId,'content');assert.equal(input.artifactId,'artifact');}calls++;tables[PUBLICATION_ASSIGNMENTS]=[{id:'assignment-row',tenant_id:'tenant',operating_package_id:'week',operating_package_version:1,publication_task_id:'pub',production_result_id:'production',assignment_id:'assignment',status:'package_ready'}];return{scanned:1,createdAssignments:1,createdPackages:1,skipped:0,errors:[]};};
 const pkg=tables.social_weekly_operating_packages![0]!.payload as WeeklyOperatingPackage;
 pkg.programId='program';pkg.weekStart='2026-10-14';pkg.weekEnd='2026-10-20';pkg.planningBlockers=[];pkg.discoveryBudgetCny=null;pkg.workflowTasks=[{taskId:'workflow-publishing',kind:'publishing',taskRef:{type:'weekly_workflow_task',id:'workflow-publishing',version:1},dependsOnTaskIds:[],subjectRefs:[],status:'planned',ownBlockingReasons:[],inheritedBlockingTaskIds:[],carriedFromTaskId:null}];
 Object.assign(pkg.socialContentPackage.publicationTasks[0]!,{publishWindow:'2026-10-19T10:00:00Z',motherContentId:'mother',accountId:'account',platform:'youtube',adaptationOfPublicationTaskId:null,status:'ready',factRefs:[],metricTargets:[]});
 const canonical=planWeeklyExecutionTasks('tenant',pkg).find(t=>t.schedule.stepKind==='publishing');assert.ok(canonical);
 canonical.status='queued';tables.social_weekly_execution_tasks![0]!.payload=canonical;
 return{scope,tables,store,scan,calls:()=>calls,canonical};
}
test('specified approved artifact binds existing weekly publish card, never reports actual publication',async()=>{
 const f=fixture(),result=await createWeeklyExistingActions(f.store,{packageScan:f.scan}).preparePublish(f.scope);
 assert.equal(result.executionTaskId,f.canonical.taskId);assert.equal(result.assignmentId,'assignment');assert.equal(result.state,'queued');assert.equal(f.calls(),1);assert.doesNotMatch(result.message,/发布成功|已经发布/);
});
test('cross-tenant, stale artifact and wrong publication never reach package worker',async()=>{
 for(const patch of [{tenantId:'other'},{expectedArtifactVersion:'v2'},{publicationTaskId:'other'}]){const f=fixture();await assert.rejects(()=>createWeeklyExistingActions(f.store,{packageScan:f.scan}).preparePublish({...f.scope,...patch}));assert.equal(f.calls(),0);}
});
test('unapproved video cannot bypass final approval',async()=>{
 const f=fixture();f.tables.starter_social_content_artifacts![0]!.status='pending';await assert.rejects(()=>createWeeklyExistingActions(f.store,{packageScan:f.scan}).preparePublish(f.scope));assert.equal(f.calls(),0);
});
test('worker error or absent receipt cannot produce success',async()=>{
 const f=fixture();await assert.rejects(()=>createWeeklyExistingActions(f.store,{packageScan:async()=>({scanned:1,createdAssignments:0,createdPackages:0,skipped:0,errors:[{tenantId:'tenant',artifactId:'artifact',code:'approval_missing'}]})}).preparePublish(f.scope));
 await assert.rejects(()=>createWeeklyExistingActions(f.store,{packageScan:async()=>({scanned:1,createdAssignments:0,createdPackages:0,skipped:1,errors:[]})}).preparePublish(f.scope));
});
test('revoked authorization is not overridden by assistant',async()=>{
 const f=fixture();await assert.rejects(()=>createWeeklyExistingActions(f.store,{packageScan:async()=>{const out=await f.scan();f.tables[PUBLICATION_ASSIGNMENTS]![0]!.authorization_revoked_at=new Date().toISOString();return out;}}).preparePublish(f.scope));
});
test('revision facade records a real canonical repair case and replays without a duplicate',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);
 f.pkg.executionGraphVersion=3;f.pkg.status='active';f.pkg.socialContentPackage.publicationTasks[0]!.publishWindow='2026-10-05T10:00:00Z';
 const quality=f.current();quality.status='succeeded';quality.ownBlockingReasons=[];quality.lastError=null;
 const approval={...quality,taskId:'approval-assistant',subjectId:'pub:user-approval',status:'queued',dependsOnTaskIds:[quality.taskId],inheritedBlockingTaskIds:[],ownBlockingReasons:[],idempotencyKey:'approval-assistant',schedule:{...quality.schedule,stepKind:'user_approval',responsibleActor:'user'}};
 f.tables.social_weekly_execution_tasks!.push({id:'approval-assistant-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:approval.taskId,idempotency_key:approval.idempotencyKey,payload:approval});
 const source=f.tables.starter_social_content_tasks![0]!,artifact=f.tables.starter_social_content_artifacts![0]!;source.weekly_plan_id='week1';artifact.status='review_required';artifact.version='1';
 const scope:WeeklyExistingActionScope={tenantId:'t',userId:'owner',programId:'p',packageId:'week1',packageVersion:1,publicationTaskId:String(f.pkg.socialContentPackage.publicationTasks[0]!.publicationTaskId),taskId:'content',artifactId:'artifact',expectedArtifactVersion:'1'};
 const service=createWeeklyExistingActions(f.store,{clock:()=>new Date('2026-10-01T01:00:00Z')}),input={requestId:'assistant-revision-0001',note:'仅修改结尾行动引导，保留产品事实'};
 const first=await service.requestRevision(scope,input),again=await service.requestRevision(scope,input);
 assert.equal(first.state,'awaiting_configuration');assert.equal(first.case.parent.taskId,'content');assert.equal(first.case.parent.artifactRef.id,'artifact');assert.equal(again.case.caseId,first.case.caseId);assert.equal(f.tables.social_weekly_production_repair_cases!.length,1);assert.equal(first.case.execution,null);
});
