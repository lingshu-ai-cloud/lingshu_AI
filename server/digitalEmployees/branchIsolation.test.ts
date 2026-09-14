import assert from 'node:assert/strict';
import { nextTaskFailure, taskRetryDue } from './taskRetry.js';
import { store } from '../storage/index.js';
import { reconcileDigitalEmployeeRun, runReviewSummary } from '../routes/digitalEmployees.js';
const now=Date.now();
const first=nextTaskFailure(undefined,true,now);
assert.equal(taskRetryDue(first,now),false);
assert.equal(taskRetryDue(first,now+60_000),true);
const second=nextTaskFailure(first,true,now);
assert.equal(taskRetryDue(second,now+299_999),false);
assert.equal(nextTaskFailure(second,true,now).retryAt,null);
assert.equal(nextTaskFailure(undefined,false,now).retryAt,null,'uncertain writes must not be repeated automatically');
const tenant='retry-fixture';
const run={id:'run',tenant_id:tenant,status:'running',goal_id:'goal',plan_id:'plan',current_controller:'agent',pause_reason:''};
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
 // A rejected approval lets already queued independent work finish, then hands control to a human.
 tasks[0].task_key='content_release_approval'; tasks[0].status='failed';
 fail=false;
 await reconcileDigitalEmployeeRun(tenant,run.id);
 assert.equal(tasks[1].status,'succeeded');
 assert.equal(run.status,'waiting_human');
 assert.equal(run.current_controller,'human');
 const later=makeTask('later','context_readiness');
 records.workflow_tasks.push(later);
 await reconcileDigitalEmployeeRun(tenant,run.id);
 assert.equal(later.status,'pending','waiting_human must not execute newly queued work without an explicit resume');
 assert.equal(run.status,'waiting_human');
 // Member readiness must not require a publication account for preparatory work.
 Object.assign(run,{status:'running',current_controller:'agent',pause_reason:''});
 records.workflow_tasks=[{...makeTask('member','context_readiness'),owner_id:'member-1'}, {...makeTask('hold','weekly_review'),depends_on:['missing']}];
 records.digital_employee_configs[0].config={autonomyMode:'managed',enabledWorkflows:['content_publish']};
 records.tenant_profiles=[{id:'profile',tenant_id:tenant,profile:{company:{name:'Fixture',industry:'Clothing'},products:{items:[]}}}];
 await reconcileDigitalEmployeeRun(tenant,run.id);
 assert.equal(records.workflow_tasks[0].status,'succeeded','member can complete company readiness without a publishing account');
 const metricTasks=Array.from({length:16},(_,i)=>({...makeTask(String(i),'task'+i),status:i<4?'succeeded':i<9?'skipped':'pending'}));
 const review=runReviewSummary(run as any,metricTasks as any,{generatedAt:'fixture',dataGaps:[]} as any);
 assert.equal(review.completionRate,25);
 assert.equal(review.skippedTasks,5);
} finally { Object.assign(store,original); }
console.log('Approval branch isolation, member preparation and honest completion-rate integration passed');
