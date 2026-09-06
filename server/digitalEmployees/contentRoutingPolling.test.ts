import assert from 'node:assert/strict';
import { agentBrowserSessions } from './browserSessions.js';
import { store } from '../storage/index.js';
import { buildWeeklyPlan, normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';

const tenant = 'isolated-full-chain-mock';
const config = normalizeDigitalEmployeeConfig({companyName:'MOCK company',industry:'Clothing',primaryBusiness:'MOCK shirts',targetMarkets:'US',focusProducts:'MOCK cotton shirt',autonomyMode:'managed',approvalOwner:'fixture-reviewer',enabledWorkflows:['scheduled_social','viral_clone','product_content','material_content','content_publish','customer_segmentation','batch_followup'],publishingTargets:[{platform:'facebook',accountId:'mock-account',accountLabel:'MOCK page'}],allowRealPublishing:false,allowRealCustomerMessages:false,approvalPolicy:{contentPublish:true,batchFollowup:true,commercialCommitment:true}});
const goalInput = normalizeWeeklyGoal({title:'MOCK 16 node plan',objective:'Isolated simulation',businessLine:'full_funnel',metric:'published_posts',target:1,startsAt:'2026-09-01',endsAt:'2026-09-30',contentPlatforms:['facebook']},config);
const plan = buildWeeklyPlan(goalInput,config);
assert.equal(plan.tasks.length,16);
const run:any={id:'mock-run',tenant_id:tenant,goal_id:'mock-goal',plan_id:'mock-plan',status:'running',started_at:'2026-09-01T00:00:00.000Z'};
const tasks:any[]=plan.tasks.map(p=>({id:`mock-${p.key}`,tenant_id:tenant,run_id:run.id,task_key:p.key,title:p.title,status:'pending',depends_on:p.dependsOn,sequence:p.sequence,kind:p.kind,agent_role:p.agentRole,execution_mode:p.executionMode,external_effect:p.externalEffect,automatic_execution_allowed:p.automaticExecutionAllowed,requires_approval:p.requiresApproval,task_version:1,output:{},business_refs:[]}));
const records:Record<string,any[]>={workflow_runs:[run],workflow_tasks:tasks,weekly_goals:[{id:run.goal_id,tenant_id:tenant,title:goalInput.title,objective:goalInput.objective,metric:goalInput.metric,scope:{},content_platforms:['facebook'],starts_at:goalInput.startsAt,ends_at:goalInput.endsAt}],weekly_plans:[{id:run.plan_id,tenant_id:tenant,plan}],digital_employee_configs:[{id:'mock-config',tenant_id:tenant,config}],tenant_profiles:[{id:'mock-profile',tenant_id:tenant,profile:{company:{name:'MOCK company',industry:'Clothing'},products:{items:[{name:'MOCK cotton shirt'}]}}}],social_accounts:[{id:'mock-account',tenantId:tenant,status:'connected',platform:'facebook',title:'MOCK page'}],content_batch_plans:[{id:'mock-orders',tenant_id:tenant,run_id:run.id,task_id:'mock-content_mode_routing',status:'planned',orders:[{id:'mock-order',route:'product',platform:'facebook',productId:'mock-product'}],routing:{eligibleRoutes:['product'],disabledRoutes:[]}}]};
const original = { ...store }; const originalFetch=globalThis.fetch;
let networkCalls=0; let serial=0;
const statusHistory:any[]=[];
Object.assign(store,{
 list:async(collection:string,query:any={})=>{let items=(records[collection]||[]).filter(r=>Object.entries(query.where||{}).every(([k,v])=>r[k]===v));if(query.sort){const key=query.sort.replace(/^-/,'');items=[...items].sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(query.sort.startsWith('-')?-1:1));}const page=query.page||1,perPage=query.perPage||100;return {items:structuredClone(items.slice((page-1)*perPage,page*perPage)),totalItems:items.length,totalPages:Math.ceil(items.length/perPage),page,perPage};},
 getById:async(c:string,id:string)=>structuredClone((records[c]||[]).find(r=>r.id===id)||null),
 create:async(c:string,body:any)=>{const r={id:`mock-created-${++serial}`,...body};(records[c]||=[]).push(r);return structuredClone(r);},
 update:async(c:string,id:string,patch:any)=>{const r=(records[c]||[]).find(r=>r.id===id);if(!r)return false;if(c==='workflow_tasks'&&patch.status&&r.status!==patch.status)statusHistory.push({key:r.task_key,from:r.status,to:patch.status});Object.assign(r,structuredClone(patch));return true;},
 delete:async(c:string,id:string)=>{records[c]=(records[c]||[]).filter(r=>r.id!==id);return true;},
});
globalThis.fetch=(async()=>{networkCalls++;throw Error('NETWORK_FORBIDDEN_IN_MOCK');}) as typeof fetch;

const routing = tasks.find(t => t.task_key === 'content_mode_routing')!;
for (const task of tasks) task.status = 'succeeded';
routing.status = 'pending';
const downstream = tasks.find(t => t.task_key === 'content_production')!;
downstream.status = 'pending'; downstream.depends_on = ['never-ready'];
records.content_batch_plans = [];
records.tenant_profiles[0].profile.products.items = [];
const priorBrowser = process.env.DIGITAL_EMPLOYEE_BROWSER_EXECUTION;
process.env.DIGITAL_EMPLOYEE_BROWSER_EXECUTION = 'true';
const originalPerform = agentBrowserSessions.perform;
let clicks = 0;
agentBrowserSessions.perform = async (_scope, _read, _label, execute) => { clicks++; return execute(); };
try {
  for (let i = 0; i < 4; i++) await reconcileDigitalEmployeeRun(tenant, run.id);
  assert.equal(clicks, 0, 'blocked polling must never click the generation button');
  assert.equal(records.content_batch_plans.length, 0, 'readiness checks must not create blocked orders');
  assert.equal(routing.output.routingCheck.count, 4);
  const waitingEvents = () => Object.values(records).flat().filter(e => e.type === 'task.routing_waiting');
  assert.equal(waitingEvents().length, 1, 'unchanged blocker emits one event');
  records.tenant_profiles[0].profile.products.items = [{name:'MOCK cotton shirt'}];
  await reconcileDigitalEmployeeRun(tenant, run.id);
  assert.equal(clicks, 0, 'a changed but still blocked condition stays read-only');
  assert.equal(waitingEvents().length, 2, 'changed blocker is recorded');
  records.materials = [{ id: 'material-1', tenantId: tenant, productId: 'enterprise-product-1', url: 'https://assets.example.com/shirt.jpg' }];
  await reconcileDigitalEmployeeRun(tenant, run.id);
  assert.equal(clicks, 1, 'newly satisfied conditions execute once');
  assert.equal(routing.status, 'succeeded');
  assert.equal(records.content_batch_plans.length, 1);
  await reconcileDigitalEmployeeRun(tenant, run.id);
  assert.equal(clicks, 1, 'completed routing is not replayed');
  routing.status = 'pending';
  await reconcileDigitalEmployeeRun(tenant, run.id);
  assert.equal(clicks, 1, 'existing planned batch is reused without a browser action');
  assert.equal(records.content_batch_plans.length, 1);
  assert.equal(networkCalls, 0);
  console.log('Content routing polling regression passed');
} finally {
  Object.assign(store, original); globalThis.fetch = originalFetch;
  agentBrowserSessions.perform = originalPerform;
  if (priorBrowser === undefined) delete process.env.DIGITAL_EMPLOYEE_BROWSER_EXECUTION;
  else process.env.DIGITAL_EMPLOYEE_BROWSER_EXECUTION = priorBrowser;
}
