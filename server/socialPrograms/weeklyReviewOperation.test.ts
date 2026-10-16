import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,ListQuery} from '../storage/datastore.js';
import {executeWeeklyReviewOperation} from './weeklyReviewOperation.js';

function fixture(){
 const updatedAt='2026-10-15T00:00:00Z';
 const pkg={programId:'p',packageId:'w',version:1,status:'active',weekStart:'2026-10-12',weekEnd:'2026-10-18',objective:'真实目标',successCriteria:['真实询盘'],workflowTasks:[{taskId:'workflow-review',kind:'review',status:'planned'}],appliedWorkflowEvents:[],socialContentPackage:{publicationTasks:[]}};
 const task={tenantId:'t',programId:'p',packageId:'w',packageVersion:1,taskId:'review',workflowKind:'review',status:'queued',updatedAt,dependsOnTaskIds:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],lease:null,lastError:null,schedule:{stepKind:'weekly_review',estimatedFinishAt:'2026-10-18T12:00:00Z'}};
 const data:Record<string,any[]>={users:[{id:'owner',tenantId:'t',role:'social_operator'}],social_weekly_operating_packages:[{id:'pkg',tenant_id:'t',program_id:'p',package_id:'w',version:1,status:'active',payload:pkg}],social_weekly_execution_tasks:[{id:'review',tenant_id:'t',program_id:'p',package_id:'w',package_version:1,task_id:'review',payload:task}]};
 const writes:string[]=[];
 const collection=(name:string)=>data[name]??(data[name]=[]);
 let sequence=0;
 const store:DataStore={
  async getById<T>(name:string,id:string){return structuredClone(collection(name).find(r=>r.id===id)??null) as T|null;},
  async list<T>(name:string,q:ListQuery={}){let values=collection(name).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));if(q.sort){const desc=q.sort.startsWith('-'),key=desc?q.sort.slice(1):q.sort;values=[...values].sort((a,b)=>String(a[key]).localeCompare(String(b[key]),undefined,{numeric:true})*(desc?-1:1));}const page=q.page??1,perPage=q.perPage??30;return {items:structuredClone(values.slice((page-1)*perPage,page*perPage)) as T[],page,perPage,totalItems:values.length,totalPages:Math.max(1,Math.ceil(values.length/perPage))};},
  async create<T>(name:string,value:Record<string,unknown>){writes.push(name);const item={id:`row-${++sequence}`,...structuredClone(value)};collection(name).push(item);return structuredClone(item) as T;},
  async update(name:string,id:string,value:Record<string,unknown>){writes.push(name);const row=collection(name).find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(value));return true;},
  async delete(name:string,id:string){const index=collection(name).findIndex(r=>r.id===id);if(index<0)return false;collection(name).splice(index,1);return true;},
 };
 const scope={tenantId:'t',actorUserId:'owner',programId:'p',packageId:'w',packageVersion:1,taskId:'review',expectedTaskUpdatedAt:updatedAt,now:new Date('2026-10-18T13:00:00Z')};
 return {store,pkg,task,data,writes,scope};
}
test('explicit review reuses durable producer, freezes once and never fabricates task completion',async()=>{
 const f=fixture();const first=await executeWeeklyReviewOperation(f.store,f.scope);
 assert.equal(first.state,'report_frozen');assert.equal(first.report?.operatingPackageRef?.version,1);assert.equal(first.report?.sampleSufficiency.status,'insufficient');
 const second=await executeWeeklyReviewOperation(f.store,f.scope);assert.equal(second.report?.snapshotId,first.report?.snapshotId);
 assert.equal(f.data.social_weekly_review_snapshots!.length,1);assert.equal(f.task.status,'queued');assert.equal(f.task.resultRefs.length,0);
 assert(!f.writes.includes('social_weekly_execution_tasks'));assert(!f.writes.includes('weekly_publication_attempts'));
});
test('draft, stale, leased, blocked, incomplete dependencies and open window cannot freeze',async()=>{
 for(const mutate of [
  (f:ReturnType<typeof fixture>)=>{f.pkg.status='draft';},
  (f:ReturnType<typeof fixture>)=>{f.task.updatedAt='2026-10-16T00:00:00Z';},
  (f:ReturnType<typeof fixture>)=>{f.task.status='leased';},
  (f:ReturnType<typeof fixture>)=>{f.task.ownBlockingReasons.push('real_gap' as never);},
  (f:ReturnType<typeof fixture>)=>{f.task.dependsOnTaskIds.push('missing' as never);},
  (f:ReturnType<typeof fixture>)=>{f.scope.now=new Date('2026-10-15T00:00:00Z');},
  (f:ReturnType<typeof fixture>)=>{f.data.users![0]!.role='customer_service';},
  (f:ReturnType<typeof fixture>)=>{f.scope.tenantId='foreign';},
 ]){const f=fixture();mutate(f);await assert.rejects(executeWeeklyReviewOperation(f.store,f.scope));assert.equal(f.data.social_weekly_review_snapshots?.length??0,0);assert(!f.writes.includes('social_weekly_execution_tasks'));}
});
