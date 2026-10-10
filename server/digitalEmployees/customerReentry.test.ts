import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { reopenNoDataCustomerBranch } from './customerReentry.js';
const rows:Record<string,any[]>={};
const run:any={id:'run',tenant_id:'tenant',goal_id:'goal',status:'succeeded'};
const tasks=['customer_segmentation','followup_batch_draft','followup_batch_approval','followup_dispatch','weekly_review'].map(task_key=>({id:task_key,task_key,status:task_key==='weekly_review'?'succeeded':'skipped',output:{dataStatus:'no_data'}}));
rows.workflow_runs=[run];rows.workflow_tasks=tasks;rows.weekly_goals=[{id:'goal'}];
rows.customer_segments=[{id:'empty',tenant_id:'tenant',run_id:'run',member_count:0,status:'generated'}];
rows.approval_requests=[{id:'old',tenant_id:'tenant',run_id:'run',task_id:'followup_batch_approval',status:'pending'}];
const original={list:store.list,update:store.update};
store.list=(async(c:string,q:any={})=>{const items=(rows[c]||[]).filter(r=>Object.entries(q.where||{}).every(([k,v])=>r[k]===v));return{items,totalItems:items.length,totalPages:1,page:1,perPage:1000};}) as typeof store.list;
store.update=(async(c:string,id:string,p:any)=>{const r=(rows[c]||[]).find(r=>r.id===id);if(!r)return false;Object.assign(r,p);return true;}) as typeof store.update;
const input={tenantId:'tenant',run,tasks,startsAt:'2026-09-01',endsAt:'2026-09-07',now:new Date('2026-09-06T00:00:00Z'),customerIds:['new'],onReopened:async(customerIds:string[])=>{(rows.run_events||=[]).push({id:'event',tenant_id:'tenant',run_id:'run',type:'customer.no_data_reopened',payload:{customerIds}});}};
try{
 assert.equal(await reopenNoDataCustomerBranch({...input,customerIds:[]}),false);
 assert.equal(await reopenNoDataCustomerBranch({...input,now:new Date('2026-09-08')}),false);
 run.status='paused';assert.equal(await reopenNoDataCustomerBranch(input),false);run.status='succeeded';
 assert.equal(await reopenNoDataCustomerBranch(input),true);
 assert.equal(run.status,'running');assert.ok(tasks.every(t=>t.status==='pending'));
 assert.equal(rows.customer_segments[0].status,'superseded');assert.equal(rows.approval_requests[0].status,'superseded');
 assert.equal(await reopenNoDataCustomerBranch(input),false);
 tasks.forEach(t=>{t.status='skipped';t.output={dataStatus:'no_data'};});
 assert.equal(await reopenNoDataCustomerBranch(input),false,'same customer never causes repeated reentry');
 rows.followup_batches=[{id:'sent',tenant_id:'tenant',run_id:'run'}];rows.followup_batch_items=[{id:'sent-item',tenant_id:'tenant',batch_id:'sent',status:'sending',provider_receipt:{claim:'unknown'}}];
 assert.equal(await reopenNoDataCustomerBranch({...input,customerIds:['another']}),false,'never erase an uncertain or successful send');
 console.log('Customer reentry: new-data-only, cycle/paused guards, stale snapshot/approval invalidation, idempotence and send preservation passed');
}finally{Object.assign(store,original);}
