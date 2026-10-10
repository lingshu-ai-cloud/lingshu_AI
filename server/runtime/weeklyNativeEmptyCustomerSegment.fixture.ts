import assert from 'node:assert/strict';
import type {DataStore} from '../storage/datastore.js';
import {store as globalStore} from '../storage/index.js';
import {createCustomerSegmentSnapshot} from '../digitalEmployees/customerWorkflow.js';

/** Calls the actual native reconciler against an isolated store. Run only in an
 * isolated test process: the legacy native runner owns a process-global store. */
export async function executeNativeEmptyCustomerSegmentation(store:DataStore,input:{tenantId:string;runId:string;userId:string}){
 const run=await store.getById<Record<string,any>>('workflow_runs',input.runId);assert.ok(run);assert.equal(run.tenant_id,input.tenantId);
 const rows=await store.list<Record<string,any>>('workflow_tasks',{where:{tenant_id:input.tenantId,run_id:input.runId},perPage:100});assert.equal(rows.totalItems,rows.items.length);
 const tasks=rows.items.filter(row=>row.task_key==='customer_segmentation'&&row.agent_role==='customer');assert.equal(tasks.length,1);const task=tasks[0]!;
 assert.ok(['observe','draft_executor'].includes(task.execution_mode),'segmentation must use native observed resource execution, not legacy internal completion');
 assert.ok(!['succeeded','skipped','failed','cancelled'].includes(task.status),'must execute an unfinished actual segmentation task');
 const result=await createCustomerSegmentSnapshot({tenantId:input.tenantId,goalId:run.goal_id,runId:input.runId,taskId:task.id,userId:input.userId,idempotent:true},()=>[],store);
 assert.equal(result.segment.status,'generated');assert.equal(result.segment.member_count,0);assert.equal(result.members.filter(member=>member.membership==='included').length,0);
 const keys=['list','getById','create','update','delete'] as const;const original=keys.map(key=>globalStore[key]);const originalAtomic=globalStore.supportsAtomicOperationLease;
 try{
  for(const key of keys)(globalStore as any)[key]=store[key].bind(store);
  globalStore.supportsAtomicOperationLease=store.supportsAtomicOperationLease?.bind(store)??(()=>false);
  const {reconcileDigitalEmployeeRun}=await import('../routes/digitalEmployees.js');
  await reconcileDigitalEmployeeRun(input.tenantId,input.runId);
 }finally{globalStore.supportsAtomicOperationLease=originalAtomic;for(const [index,key] of keys.entries())(globalStore as any)[key]=original[index];}
 const completed=await store.getById<Record<string,any>>('workflow_tasks',task.id);assert.ok(completed);assert.equal(completed.status,'skipped');assert.equal(completed.output.dataStatus,'no_data');
 return {segment:result.segment,task:completed};
}
