import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { buildWeeklyPlan, normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { withExecutionAdapters } from './executionAdapters.js';
import { reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';

const tenant = 'isolated-full-chain-mock';
const config = normalizeDigitalEmployeeConfig({companyName:'MOCK company',industry:'Clothing',primaryBusiness:'MOCK shirts',targetMarkets:'US',focusProducts:'MOCK cotton shirt',autonomyMode:'managed',approvalOwner:'fixture-reviewer',enabledWorkflows:['scheduled_social','viral_clone','product_content','material_content','content_publish','customer_segmentation','batch_followup'],publishingTargets:[{platform:'facebook',accountId:'mock-account',accountLabel:'MOCK page'}],allowRealPublishing:false,allowRealCustomerMessages:false,approvalPolicy:{contentPublish:true,batchFollowup:true,commercialCommitment:true}});
const goalInput = normalizeWeeklyGoal({title:'MOCK 16 node plan',objective:'Isolated simulation',businessLine:'full_funnel',metric:'published_posts',target:1,startsAt:'2026-09-01',endsAt:'2026-09-30',contentPlatforms:['facebook']},config);
const plan = buildWeeklyPlan(goalInput,config);
assert.equal(plan.tasks.length,16);
const run:any={id:'mock-run',tenant_id:tenant,goal_id:'mock-goal',plan_id:'mock-plan',status:'running',started_at:'2026-09-01T00:00:00.000Z'};
const tasks:any[]=plan.tasks.map(p=>({id:`mock-${p.key}`,tenant_id:tenant,run_id:run.id,task_key:p.key,title:p.title,status:'pending',depends_on:p.dependsOn,sequence:p.sequence,kind:p.kind,agent_role:p.agentRole,execution_mode:p.executionMode,external_effect:p.externalEffect,automatic_execution_allowed:p.automaticExecutionAllowed,requires_approval:p.requiresApproval,task_version:1,output:{},business_refs:[]}));
const records:Record<string,any[]>={workflow_runs:[run],workflow_tasks:tasks,weekly_goals:[{id:run.goal_id,tenant_id:tenant,title:goalInput.title,objective:goalInput.objective,metric:goalInput.metric,scope:{},content_platforms:['facebook'],starts_at:goalInput.startsAt,ends_at:goalInput.endsAt}],weekly_plans:[{id:run.plan_id,tenant_id:tenant,plan}],digital_employee_configs:[{id:'mock-config',tenant_id:tenant,config}],tenant_profiles:[{id:'mock-profile',tenant_id:tenant,profile:{company:{name:'MOCK company',industry:'Clothing'},products:{items:[{name:'MOCK cotton shirt',sku:'mock-sku',material:'cotton'}]}}}],social_accounts:[{id:'mock-account',tenantId:tenant,status:'connected',platform:'facebook',title:'MOCK page'}],content_batch_plans:[{id:'mock-orders',tenant_id:tenant,run_id:run.id,task_id:'mock-content_mode_routing',status:'planned',orders:[{id:'mock-order',route:'product',platform:'facebook',productId:'mock-product'}],routing:{eligibleRoutes:['product'],disabledRoutes:[]}}]};
const original = { ...store }; const originalFetch=globalThis.fetch;
let networkCalls=0; let serial=0;
const statusHistory:any[]=[];
const materials:Array<{id:string;tenantId:string;productId:string;url:string;synthetic?:boolean}>=[];
Object.assign(store,{
 list:async(collection:string,query:any={})=>{let items=(records[collection]||[]).filter(r=>Object.entries(query.where||{}).every(([k,v])=>r[k]===v));if(query.sort){const key=query.sort.replace(/^-/,'');items=[...items].sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(query.sort.startsWith('-')?-1:1));}const page=query.page||1,perPage=query.perPage||100;return {items:structuredClone(items.slice((page-1)*perPage,page*perPage)),totalItems:items.length,totalPages:Math.ceil(items.length/perPage),page,perPage};},
 getById:async(c:string,id:string)=>structuredClone((records[c]||[]).find(r=>r.id===id)||null),
 create:async(c:string,body:any)=>{const r={id:`mock-created-${++serial}`,...body};(records[c]||=[]).push(r);return structuredClone(r);},
 update:async(c:string,id:string,patch:any)=>{const r=(records[c]||[]).find(r=>r.id===id);if(!r)return false;if(c==='workflow_tasks'&&patch.status&&r.status!==patch.status)statusHistory.push({key:r.task_key,from:r.status,to:patch.status});Object.assign(r,structuredClone(patch));return true;},
 delete:async(c:string,id:string)=>{records[c]=(records[c]||[]).filter(r=>r.id!==id);return true;},
});
globalThis.fetch=(async()=>{networkCalls++;throw Error('NETWORK_FORBIDDEN_IN_MOCK');}) as typeof fetch;


records.content_batch_plans = [];
const review = tasks.find(t => t.task_key === 'weekly_review')!;
const collection = tasks.find(t => t.task_key === 'scheduled_source_collection')!;
const analysis = tasks.find(t => t.task_key === 'viral_analysis')!;
for (const task of tasks) task.status = 'succeeded';
review.status = 'pending'; review.depends_on = ['never-ready'];
const selectedVideo = { route: 'clone', referenceId: 'previously-collected', preproduction: { benchmark: { status: 'ready' } } };
records.weekly_plans[0].plan = { ...plan, businessPackage: { tasks: [{ templateId: 'production', videoPlans: [selectedVideo] }], authorization: { mode: 'each', accountIds: [], customerIds: [] } } };
records.trend_videos = [{ id: 'previously-collected', tenantId: tenant, aiAnalysis: { analysisMode: 'exact', analysisQuality: 'video', gemini: { theme: 'Confirmed reference' } } }];
try {
  await withExecutionAdapters({ materials: () => [] }, async () => {
    run.status = 'running'; collection.status = 'pending'; analysis.status = 'pending';
    await reconcileDigitalEmployeeRun(tenant, run.id);
    assert.equal(collection.status, 'skipped', 'an explicit tenant-owned exact reference does not require a recurring crawler');
    assert.equal(analysis.status, 'succeeded', 'the selected existing reference belongs to this run through its frozen plan');
    assert.equal(records.scheduled_tasks?.length || 0, 0);
    records.trend_videos[0].tenantId = 'other-tenant';
    run.status = 'running'; collection.status = 'pending'; analysis.status = 'pending'; collection.business_refs = []; analysis.business_refs = [];
    await reconcileDigitalEmployeeRun(tenant, run.id);
    assert.notEqual(collection.status, 'skipped', 'other tenant references cannot waive collection');
    assert.notEqual(analysis.status, 'succeeded');
    records.trend_videos[0].tenantId = tenant;
    records.trend_videos[0].aiAnalysis.analysisQuality = 'video_review_required';
    run.status = 'running'; collection.status = 'pending'; analysis.status = 'pending';
    await reconcileDigitalEmployeeRun(tenant, run.id);
    assert.notEqual(collection.status, 'skipped', 'review-required references cannot waive collection');
    assert.notEqual(analysis.status, 'succeeded');
  });
  console.log('Explicit reference reuse, tenant ownership and review gate tests passed');
} finally { Object.assign(store, original); globalThis.fetch = originalFetch; }
