import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createWeeklyRequiredMaterialAdmission } from './weeklyRequiredMaterialAdmission.js';
import { createWeeklyMaterialRequestService, materialRequestAcceptedConsumers, materialRequestNotice, WEEKLY_MATERIAL_REQUESTS } from './weeklyMaterialRequests.js';
function fixture() {
 const rows=new Map<string,Record_[]>();let index=0;
 const store:DataStore={
  async getById<T>(collection:string,id:string){return structuredClone(rows.get(collection)?.find(row=>row.id===id)??null) as T|null;},
  async create<T>(collection:string,data:Record<string,unknown>){const row={id:`row${++index}`, ...structuredClone(data)} as Record_;rows.set(collection,[...(rows.get(collection)??[]),row]);return structuredClone(row) as T;},
  async update(collection,id,data){const row=rows.get(collection)?.find(row=>row.id===id);if(!row)return false;Object.assign(row,structuredClone(data));return true;},
  async delete(collection,id){const list=rows.get(collection)??[];rows.set(collection,list.filter(row=>row.id!==id));return true;},
  async list<T>(collection:string,query:ListQuery={}){const items=(rows.get(collection)??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));return {items:structuredClone(items.slice(0,query.perPage??30)) as T[],totalItems:items.length,totalPages:1,page:1,perPage:query.perPage??30};},
 };
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const hash=createHash('sha256').update(bytes).digest('hex');
 let instant='2026-10-09T09:00:00+08:00';
 const raw:Record<string,unknown>={id:'material0000001',tenantId:'tenant',scope:'own',type:'image',sha256:hash,sizeBytes:bytes.length,videoFile:'product.png',sourceType:'licensed_upload'};
 const fetched:string[]=[];
 const ports={isTenantUser:async(tenant:string,user:string)=>tenant==='tenant'&&['uploader','reviewer','issuer','third'].includes(user),getMaterial:async(tenant:string,id:string)=>tenant==='tenant'&&id===raw.id?structuredClone(raw):null,materialBytes:{fetch:async({tenantId,recordId}:{tenantId:string;recordId:string})=>{fetched.push(`${tenantId}/${recordId}`);return new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}});}},now:()=>instant};
 const service=createWeeklyMaterialRequestService(store,ports);
 const seed=async(id:string,packageId='week1',version=1)=>store.create('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:packageId,package_version:version,task_id:id,payload:{taskId:id,publicationTaskId:`pub-${id}`,scope:'content',schedule:{stepKind:'material_readiness'},tenantId:'tenant',programId:'program',packageId,packageVersion:version}});
 const input={tenantId:'tenant',programId:'program',requirementKey:'shared-product-evidence',requirements:'真实产品正面，清晰可辨，权利已核验',assigneeUserId:'uploader',reviewerUserId:'reviewer',dueAt:'2026-10-09T08:00:00+08:00',verificationDueAt:'2026-10-09T08:30:00+08:00',timeZone:'Asia/Shanghai',consumers:[{taskId:'one',packageId:'week1',packageVersion:1,requirement:'真实产品正面'}],actorUserId:'reviewer'};
 return {store,service,ports,seed,input,raw,fetched,hash,setNow:(value:string)=>{instant=value;}};
}
test('one shared task is reused, real submission awaits verification, partial review only unlocks matching consumers',async()=> {
 const f=fixture();await f.seed('one');await f.seed('two');f.input.consumers.push({taskId:'two',packageId:'week1',packageVersion:1,requirement:'产品标签可辨'});
 const request=await f.service.create(f.input);
 assert.equal((await f.service.create(f.input)).requestId,request.requestId);
 assert.equal((await f.store.list(WEEKLY_MATERIAL_REQUESTS)).totalItems,1);
 assert.equal(materialRequestNotice(request,'2026-10-09T09:00:00+08:00').uploadOverdue,true);
 const submitted=await f.service.submit({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});
 assert.equal(submitted.status,'pending_verification');assert.equal(submitted.submissions[0]!.materials[0]!.sha256,f.hash);
 assert.deepEqual(materialRequestAcceptedConsumers(submitted),[]);
 assert.equal(materialRequestNotice(submitted,'2026-10-09T09:00:00+08:00').uploadOverdue,false);
 assert.equal(materialRequestNotice(submitted,'2026-10-09T09:00:00+08:00').verificationDelayed,true);
 const reviewed=await f.service.review({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'one',accepted:true,factCheck:'与本产品一致',rightsCheck:'企业已授权',visualCheck:'正面清晰'},{taskId:'two',accepted:false,factCheck:'产品一致',rightsCheck:'企业已授权',visualCheck:'标签不可辨，需要补拍'}]});
 assert.equal(reviewed.status,'rejected');assert.deepEqual(materialRequestAcceptedConsumers(reviewed),['one']);
 assert.equal(materialRequestNotice(reviewed,'2026-10-09T09:00:00+08:00').uploadOverdue,true);
 assert.equal(f.fetched.length,2,'submit and review both verify actual canonical bytes');
 assert.equal((await f.service.acceptedForConsumer({tenantId:'tenant',programId:'program',requestId:request.requestId,consumerTaskId:'one'}))!.submissionVersion,1);
 assert.equal(await f.service.acceptedForConsumer({tenantId:'tenant',programId:'program',requestId:request.requestId,consumerTaskId:'two'}),null);
 f.raw.sha256='a'.repeat(64);
 await assert.rejects(f.service.acceptedForConsumer({tenantId:'tenant',programId:'program',requestId:request.requestId,consumerTaskId:'one'}),/已改变/);
});
test('cross-week consumer addition and deadline revision preserve identity and previous review evidence',async()=> {
 const f=fixture();await f.seed('one');await f.seed('next','week2',2);
 const request=await f.service.create(f.input);
 await f.service.submit({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});
 await f.service.review({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'one',accepted:true,factCheck:'产品一致',rightsCheck:'合法上传',visualCheck:'镜头合格'}]});
 const revised=await f.service.revise({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',reason:'下周新增消费者，独立核验镜头需求',dueAt:'2026-10-12T08:00:00+08:00',addConsumers:[{taskId:'next',packageId:'week2',packageVersion:2,requirement:'同一产品正面'}]});
 assert.equal(revised.requestId,request.requestId);assert.equal(revised.submissions.length,1);assert.equal(revised.status,'pending_verification');
 assert.deepEqual(materialRequestAcceptedConsumers(revised),['one'],'new consumer is not automatically accepted');
 assert.equal(revised.history.at(-1)!.previousDueAt,f.input.dueAt);assert.equal(revised.history.find(item=>item.action==='accepted')!.verification!.reviewedBy,'reviewer');
 assert.equal((await f.store.list(WEEKLY_MATERIAL_REQUESTS)).totalItems,1);
});
test('auth, exact consumer versions, stale submissions and material changes fail closed',async()=> {
 const f=fixture();await f.seed('one');
 await assert.rejects(f.service.create({...f.input,assigneeUserId:'foreign'}),/当前租户/);
 await assert.rejects(createWeeklyMaterialRequestService(f.store,{...f.ports,allowSelfReview:false}).create({...f.input,assigneeUserId:'reviewer'}),/不同真人/);
 await assert.rejects(f.service.create({...f.input,consumers:[{...f.input.consumers[0]!,packageVersion:2}]}),/准确任务版本/);
 await assert.rejects(f.service.create({...f.input,dueAt:'2026-10-09T08:00:00'}),/时区/);
 const request=await f.service.create(f.input);
 const submit={tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0};
 await assert.rejects(f.service.submit({...submit,actorUserId:'reviewer'}),/指定真人/);
 await f.service.submit(submit);await assert.rejects(f.service.submit(submit),/版本已变化/);
 await assert.rejects(f.service.get('foreign','program',request.requestId,'reviewer'),/当前租户/);
 f.raw.sha256='a'.repeat(64);
 await assert.rejects(f.service.review({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'one',accepted:true,factCheck:'一致',rightsCheck:'合法',visualCheck:'清晰'}]}),/已改变/);
 assert.equal((await f.service.get('tenant','program',request.requestId,'reviewer')).status,'pending_verification');
});
test('default membership reader rejects global foreign users and unknown roles',async()=> {
 const f=fixture();await f.seed('one');await f.store.create('users',{id:'reviewer',tenantId:'foreign',role:'admin'});
 const service=createWeeklyMaterialRequestService(f.store);
 await assert.rejects(service.create(f.input),/当前租户/);
 await f.store.update('users','reviewer',{tenantId:'tenant',role:'unknown'});
 await assert.rejects(service.create(f.input),/当前租户/);
});

test('invalid calendar instants and nonproduction consumers cannot enter material ledger',async()=> {const f=fixture();await f.seed('one');for(const dueAt of ['2026-02-30T08:00:00+08:00','2026-10-09T24:00:00+08:00'])await assert.rejects(f.service.create({...f.input,dueAt}),/有效具体时间/);const rows=await f.store.list<Record_>('social_weekly_execution_tasks');await f.store.update('social_weekly_execution_tasks',rows.items[0]!.id,{payload:{...(rows.items[0]!.payload as object),schedule:{stepKind:'publishing'}}});await assert.rejects(f.service.create(f.input),/具体生产步骤/);});

test('malformed persisted payload produces an explicit identity error',async()=> {
 const f=fixture();await f.seed('one');const request=await f.service.create(f.input);
 await f.store.update(WEEKLY_MATERIAL_REQUESTS,request.requestId,{payload:'{malformed'});
 await assert.rejects(f.service.get('tenant','program',request.requestId,'reviewer'),(error:unknown)=>(error as {code?:string}).code==='weekly_material_identity_invalid');
});

test('single-person business can perform explicit human checks unless a separation policy is configured',async()=> {
 const f=fixture();await f.seed('one');const request=await f.service.create({...f.input,assigneeUserId:'reviewer'});
 const submitted=await f.service.submit({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});
 assert.equal(submitted.status,'pending_verification','upload never means checked');
 const checked=await f.service.review({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'one',accepted:true,factCheck:'产品事实逐项核对',rightsCheck:'企业自有版权，肖像授权已确认',visualCheck:'人工检查镜头符合要求'}]});
 assert.equal(checked.status,'accepted');
 assert.equal(checked.submissions[0]!.verification!.reviewedBy,'reviewer','human evidence is attributed to its actual human reviewer');
});

test('pending upload without a verification deadline cannot be labelled verification-overdue',async()=>{const f=fixture();await f.seed('one');const {verificationDueAt:_,...input}=f.input;const request=await f.service.create(input);const submitted=await f.service.submit({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});const notice=materialRequestNotice(submitted,'2026-10-10T09:00:00+08:00');assert.equal(notice.uploadOverdue,false);assert.equal(notice.verificationDelayed,false);assert.equal(notice.verificationDeadlineMissing,true);});

test('original issuer can explicitly adjust scheduling while unrelated tenant members cannot',async()=> {
 const f=fixture();await f.seed('one');await f.seed('next','week2',2);
 const request=await f.service.create({...f.input,actorUserId:'issuer'});
 await assert.rejects(f.service.revise({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'third',reason:'无关用户调整',dueAt:'2026-10-12T08:00:00+08:00'}),/原发起人/);
 const revised=await f.service.revise({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'issuer',reason:'经营明确追加下周消费者',dueAt:'2026-10-12T08:00:00+08:00',verificationDueAt:'2026-10-12T08:30:00+08:00',addConsumers:[{taskId:'next',packageId:'week2',packageVersion:2,requirement:'产品正面'}]});
 assert.equal(revised.consumers.length,2);assert.equal(revised.requestId,request.requestId);assert.equal(revised.history.at(-1)!.actor,'issuer');
});

test('production admission uses persisted manual checks and revalidates actual material bytes, including cancellation',async()=> {
 const f=fixture();await f.seed('one');const request=await f.service.create(f.input);
 await f.service.submit({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});
 await f.service.review({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'one',accepted:true,factCheck:'真实产品事实一致',rightsCheck:'企业自有授权',visualCheck:'实际镜头合格'}]});
 const admit=createWeeklyRequiredMaterialAdmission(f.store,f.ports);
 const scope={tenantId:'tenant',programId:'program',consumerTaskId:'one',requirement:{required:true,requestIds:[request.requestId]}};
 const ready=await admit(scope);assert.equal(ready.status,'ready');assert.equal(ready.materials[0]!.sha256,f.hash);assert.equal(f.fetched.length,3,'admission performs a third real-byte read');
 f.raw.sha256='a'.repeat(64);const changed=await admit(scope);assert.equal(changed.status,'blocked');assert.deepEqual(changed.materials,[]);
 f.raw.sha256=f.hash;await f.service.cancel({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',reason:'明确取消，但不豁免生产必要输入'});
 assert.equal((await admit(scope)).status,'blocked');
});

test('human evidence deadlines follow the real first script admission, not the later material review consumer',async()=>{
 const f=fixture();await f.seed('one');const row=(await f.store.list<Record_>('social_weekly_execution_tasks')).items[0]!;await f.store.update('social_weekly_execution_tasks',row.id,{payload:{...(row.payload as any),schedule:{stepKind:'material_readiness',estimatedStartAt:'2026-10-09T10:00:00+08:00'}}});
 await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:'week1',package_version:1,task_id:'script-one',payload:{taskId:'script-one',publicationTaskId:'pub-one',scope:'content',tenantId:'tenant',programId:'program',packageId:'week1',packageVersion:1,schedule:{stepKind:'script',estimatedStartAt:'2026-10-09T07:00:00+08:00'}}});
 await assert.rejects(f.service.create(f.input),{code:'weekly_material_deadline_after_first_production'});
 const request=await f.service.create({...f.input,dueAt:'2026-10-09T06:00:00+08:00',verificationDueAt:'2026-10-09T06:30:00+08:00'});
 assert.equal(request.preparation?.earliestRequiredAt,'2026-10-08T23:00:00.000Z');assert.deepEqual(request.preparation?.productionTaskIds,['script-one']);assert.deepEqual(request.consumers.map(c=>c.taskId),['one'],'review remains bound to the original material consumer, without a dependency cycle');
 await assert.rejects(f.service.revise({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',reason:'过晚核验',verificationDueAt:'2026-10-09T09:00:00+08:00'}),{code:'weekly_material_deadline_after_first_production'});
});
test('a downstream estimate without a real script timetable is an explicit gap and never fabricates a preparation time',async()=>{
 const f=fixture();await f.seed('one');const request=await f.service.create(f.input);assert.equal(request.preparation?.earliestRequiredAt,null);assert.deepEqual(request.preparation?.missingScheduleConsumerIds,['one']);
});
test('shared new-week consumer uses its first script while accepted old-week consumers retain their review identity and evidence',async()=>{
 const f=fixture();await f.seed('one');await f.seed('next','week2',2);
 const seedScript=(id:string,packageId:string,version:number,pub:string,time:string)=>f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:packageId,package_version:version,task_id:id,payload:{taskId:id,publicationTaskId:pub,scope:'content',tenantId:'tenant',programId:'program',packageId,packageVersion:version,schedule:{stepKind:'script',estimatedStartAt:time}}});
 await seedScript('old-script','week1',1,'pub-one','2026-10-09T10:00:00+08:00');await seedScript('next-script','week2',2,'pub-next','2026-10-12T10:00:00+08:00');
 const request=await f.service.create(f.input);await f.service.submit({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});await f.service.review({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'one',accepted:true,factCheck:'真实产品一致',rightsCheck:'企业自有合法',visualCheck:'完整镜头可用'}]});
 const next=await f.service.revise({tenantId:'tenant',programId:'program',requestId:request.requestId,actorUserId:'reviewer',reason:'下周真实消费者重新核验',dueAt:'2026-10-12T08:00:00+08:00',verificationDueAt:'2026-10-12T09:00:00+08:00',addConsumers:[{taskId:'next',packageId:'week2',packageVersion:2,requirement:'真实产品正面'}]});
 assert.equal(next.preparation?.earliestRequiredAt,'2026-10-12T02:00:00.000Z');assert.deepEqual(next.preparation?.excludedAcceptedConsumerIds,['one']);assert.deepEqual(next.preparation?.productionTaskIds,['next-script']);assert.deepEqual(materialRequestAcceptedConsumers(next),['one']);assert.deepEqual(next.consumers.map(c=>c.taskId),['one','next']);
});

test('read and list recompute earlier real script preparation after stored schedule changes without rewriting user deadlines',async()=>{
 const f=fixture();await f.seed('one');const script=await f.store.create<Record_>('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:'week1',package_version:1,task_id:'script-one',payload:{taskId:'script-one',publicationTaskId:'pub-one',scope:'content',tenantId:'tenant',programId:'program',packageId:'week1',packageVersion:1,schedule:{stepKind:'script',estimatedStartAt:'2026-10-09T10:00:00+08:00'}}});
 const request=await f.service.create(f.input);assert.equal(request.preparation?.uploadDeadlineAfterRequiredStart,false);
 await f.store.update('social_weekly_execution_tasks',script!.id,{payload:{...(script!.payload as any),schedule:{stepKind:'script',estimatedStartAt:'2026-10-09T07:00:00+08:00',actualStartedAt:'2026-10-09T09:00:00+08:00'}}});
 const actual=await f.service.get('tenant','program',request.requestId,'reviewer'),listed=(await f.service.list('tenant','program','reviewer'))[0]!;
 assert.equal(actual.preparation?.earliestRequiredAt,'2026-10-08T23:00:00.000Z','late actual start never relaxes the frozen earlier preparation need');assert.equal(actual.preparation?.uploadDeadlineAfterRequiredStart,true);assert.equal(actual.preparation?.verificationDeadlineAfterRequiredStart,true);assert.deepEqual(listed.preparation,actual.preparation);assert.equal(actual.dueAt,f.input.dueAt);assert.equal(actual.verificationDueAt,f.input.verificationDueAt);
 const persisted=(await f.store.getById<Record_>(WEEKLY_MATERIAL_REQUESTS,request.requestId))!.payload as any;assert.equal(persisted.preparation.earliestRequiredAt,'2026-10-09T02:00:00.000Z','readonly assessment does not silently mutate historical payload');
});

test('actual factory task graph requires shared human preparation before script even though review consumer depends on its storyboard',async()=>{
 const f=fixture();const {createSocialProgramService}=await import('./service.js'),{createWeeklyOperatingPackageService}=await import('./weeklyOperatingPackages.js'),{listWeeklyExecutionTasks}=await import('./executionTasks.js');
 const programs=createSocialProgramService(f.store),packages=createWeeklyOperatingPackageService(f.store);const program=await programs.createProgram('tenant','issuer',{brandName:'Actual factory',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'cold_start'});const account=await programs.createAccount('tenant','issuer',program.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'real facts'});
 const pkg=await packages.create('tenant','issuer',program.programId,{weekStart:'2026-11-09',objective:'Produce one weekly video',successCriteria:['One finished video'],accountPlans:[{accountId:account.accountId,publicationCount:1}],originalContentTarget:1});
 const tasks=await listWeeklyExecutionTasks(f.store,'tenant',program.programId,pkg.packageId,pkg.version),consumer=tasks.find(t=>t.schedule.stepKind==='material_readiness')!,script=tasks.find(t=>t.schedule.stepKind==='script'&&t.publicationTaskId===consumer.publicationTaskId)!,storyboard=tasks.find(t=>t.schedule.stepKind==='storyboard'&&t.publicationTaskId===consumer.publicationTaskId)!;
 assert(consumer.dependsOnTaskIds.includes(storyboard.taskId));assert(storyboard.dependsOnTaskIds.includes(script.taskId));const start=Date.parse(script.schedule.estimatedStartAt),later=Date.parse(consumer.schedule.estimatedStartAt);assert(later>start);
 const input={...f.input,programId:program.programId,consumers:[{taskId:consumer.taskId,packageId:pkg.packageId,packageVersion:pkg.version,requirement:'真实产品事实镜头'}],timeZone:'UTC'};
 await assert.rejects(f.service.create({...input,dueAt:new Date(start+60000).toISOString(),verificationDueAt:new Date(start+120000).toISOString()}),{code:'weekly_material_deadline_after_first_production'});
 const request=await f.service.create({...input,dueAt:new Date(start-3600000).toISOString(),verificationDueAt:new Date(start-1800000).toISOString()});assert.equal(request.preparation?.earliestRequiredAt,script.schedule.estimatedStartAt);assert.deepEqual(request.consumers.map(c=>c.taskId),[consumer.taskId]);const after=await listWeeklyExecutionTasks(f.store,'tenant',program.programId,pkg.packageId,pkg.version);assert.deepEqual(after,tasks,'human preparation must not rewrite dependencies, statuses or completion evidence');
});
