import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createWeeklyRequiredMaterialAdmission } from './weeklyRequiredMaterialAdmission.js';
import { createWeeklyMaterialRequestService } from './weeklyMaterialRequests.js';
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
test('accepted bytes do not automatically admit a new frozen consumer after append', async () => {
 const f=fixture(); await f.seed('one'); await f.seed('next','week1',2);
 const record=await f.service.create(f.input);
 await f.service.submit({tenantId:'tenant',programId:'program',requestId:record.requestId,actorUserId:'uploader',materialRecordIds:['material0000001'],expectedSubmissionVersion:0});
 const first={taskId:'one',accepted:true,factCheck:'真实产品一致',rightsCheck:'企业授权',visualCheck:'原镜头满足要求'};
 const approved=await f.service.review({tenantId:'tenant',programId:'program',requestId:record.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[first]});
 assert.equal(approved.status,'accepted');
 const appended=await f.service.revise({tenantId:'tenant',programId:'program',requestId:record.requestId,actorUserId:'reviewer',reason:'明确新增v2镜头消费者',addConsumers:[{taskId:'next',packageId:'week1',packageVersion:2,requirement:'新视频的近景标签必须可辨'}]});
 assert.equal(appended.status,'pending_verification'); assert.equal(appended.submissions.length,1);
 assert.equal(appended.submissions[0]!.verification!.consumerDecisions.length,1);
 const admission=createWeeklyRequiredMaterialAdmission(f.store,f.ports);
 const scope={tenantId:'tenant',programId:'program',consumerTaskId:'next',requirement:{required:true as const,requestIds:[record.requestId]}};
 assert.equal((await admission(scope)).status,'blocked');
 assert.equal(await f.service.acceptedForConsumer({tenantId:'tenant',programId:'program',requestId:record.requestId,consumerTaskId:'next'}),null);
 await f.service.review({tenantId:'tenant',programId:'program',requestId:record.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[first,{taskId:'next',accepted:true,factCheck:'再次核对真实产品一致',rightsCheck:'再次确认此视频使用授权',visualCheck:'近景标签实际可辨'}]});
 assert.equal((await admission(scope)).status,'ready');
});
