import assert from 'node:assert/strict';
import { nextTaskFailure, taskRetryDue } from './taskRetry.js';
import { store } from '../storage/index.js';
import { reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';
const now=Date.now();
const first=nextTaskFailure(undefined,true,now);
assert.equal(taskRetryDue(first,now),false);
assert.equal(taskRetryDue(first,now+60_000),true);
const second=nextTaskFailure(first,true,now);
assert.equal(taskRetryDue(second,now+299_999),false);
assert.equal(nextTaskFailure(second,true,now).retryAt,null);
assert.equal(nextTaskFailure(undefined,false,now).retryAt,null,'uncertain writes must not be repeated automatically');
const tenant='retry-fixture';
const run={id:'run',tenant_id:tenant,status:'running',goal_id:'goal',plan_id:'plan'};
const makeTask=(id:string,key:string)=>({id,tenant_id:tenant,run_id:run.id,task_key:key,title:key,status:'pending',depends_on:[],sequence:id==='one'?1:2,kind:'planning',execution_mode:'internal',external_effect:'none',automatic_execution_allowed:true,output:{},blocked_reason:''});
const tasks=[makeTask('one','context_readiness'),makeTask('two','goal_decomposition')];
const records:Record<string,any[]>={
 workflow_runs:[run],workflow_tasks:tasks,
 weekly_goals:[{id:'goal',tenant_id:tenant,title:'Fixture',objective:'Isolated runtime',metric:'test',scope:{},content_platforms:['youtube'],starts_at:'2026-09-06',ends_at:'2026-09-12'}],
 weekly_plans:[{id:'plan',tenant_id:tenant,plan:{}}],digital_employee_configs:[{id:'config',tenant_id:tenant,config:{autonomyMode:'managed'}}],run_events:[],
};
const original={list:store.list,getById:store.getById,update:store.update,create:store.create};
let fail=true;
store.list=(async(collection:string,query:any={})=>{const items=(records[collection]||[]).filter(item=>Object.entries(query.where||{}).every(([k,v])=>item[k]===v));return {items:structuredClone(items),totalItems:items.length,totalPages:1,page:1,perPage:100};}) as typeof store.list;
store.getById=(async(collection:string,id:string)=>structuredClone((records[collection]||[]).find(item=>item.id===id)||null)) as typeof store.getById;
store.update=(async(collection:string,id:string,patch:any)=>{if(collection==='workflow_tasks'&&id==='one'&&patch.status==='succeeded'&&fail){fail=false;throw Error('fixture transient storage error');}const record=(records[collection]||[]).find(item=>item.id===id);if(!record)return false;Object.assign(record,patch);return true;}) as typeof store.update;
store.create=(async(collection:string,body:any)=>{const record={id:`created-${(records[collection]||[]).length}`, ...body};(records[collection]||=[]).push(record);return structuredClone(record);}) as typeof store.create;
try {
 await reconcileDigitalEmployeeRun(tenant,run.id);
 assert.equal(tasks[0].status,'failed');
 assert.equal((tasks[0].output as any).executionFailure.attempts,1);
 assert.equal(tasks[1].status,'succeeded','an exception must not prevent an independent task from executing');
 await reconcileDigitalEmployeeRun(tenant,run.id);
 assert.equal(tasks[0].status,'failed','retry interval must be honored');
 (tasks[0].output as any).executionFailure.retryAt=new Date(now-1).toISOString();
 // Keep another pending dependency so this test exercises task execution, not a real business review.
 records.workflow_tasks.push({...makeTask('later','weekly_review'),depends_on:['not-present']});
 await reconcileDigitalEmployeeRun(tenant,run.id);
 assert.equal(tasks[0].status,'succeeded');
 assert.equal((tasks[0].output as any).executionFailure,undefined,'successful retry clears its failure state');
} finally { Object.assign(store,original); }
console.log('Task exception isolation, bounded retries and recovery integration passed');
