import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { followupItemContentHash } from './customerWorkflow.js';
import { store } from '../storage/index.js';
import { buildWeeklyPlan, normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { buildBusinessSnapshot } from './businessSnapshot.js';
import { withExecutionAdapters, currentExecutionAdapters } from './executionAdapters.js';
import { digitalEmployeesRouter, reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';

const tenant = 'isolated-full-chain-mock';
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-full-chain-'));
const fixtureVideo = path.join(fixtureDirectory, 'final.mp4');
fs.writeFileSync(fixtureVideo, 'synthetic test video');
const config = normalizeDigitalEmployeeConfig({companyName:'MOCK company',industry:'Clothing',primaryBusiness:'MOCK shirts',targetMarkets:'US',focusProducts:'MOCK cotton shirt',autonomyMode:'managed',approvalOwner:'fixture-reviewer',enabledWorkflows:['scheduled_social','viral_clone','product_content','material_content','content_publish','customer_segmentation','batch_followup'],publishingTargets:[{platform:'facebook',accountId:'mock-account',accountLabel:'MOCK page'}],allowRealPublishing:false,allowRealCustomerMessages:false,approvalPolicy:{contentPublish:true,batchFollowup:true,commercialCommitment:true}});
const goalInput = normalizeWeeklyGoal({title:'MOCK 16 node plan',objective:'Isolated simulation',businessLine:'full_funnel',metric:'published_posts',target:1,startsAt:'2026-09-01',endsAt:'2026-09-30',contentPlatforms:['facebook']},config);
const plan = buildWeeklyPlan(goalInput,config);
assert.equal(plan.tasks.length,16);
const run:any={id:'mock-run',tenant_id:tenant,goal_id:'mock-goal',plan_id:'mock-plan',status:'running',started_at:'2026-09-01T00:00:00.000Z'};
const tasks:any[]=plan.tasks.map(p=>({id:`mock-${p.key}`,tenant_id:tenant,run_id:run.id,task_key:p.key,title:p.title,status:'pending',depends_on:p.dependsOn,sequence:p.sequence,kind:p.kind,agent_role:p.agentRole,execution_mode:p.executionMode,external_effect:p.externalEffect,automatic_execution_allowed:p.automaticExecutionAllowed,requires_approval:p.requiresApproval,task_version:1,output:{},business_refs:[]}));
assert.equal(tasks.find(task => task.task_key === 'content_release_approval')?.agent_role, 'business');
assert.equal(tasks.find(task => task.task_key === 'content_production')?.agent_role, 'content');
assert.equal(tasks.find(task => task.task_key === 'content_quality_gate')?.agent_role, 'content');
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
const task=(key:string)=>tasks.find(t=>t.task_key===key)!;
const scope=(key:string)=>({workflowRunId:run.id,workflowTaskId:task(key).id,synthetic:true});
let permitAnalysis=false,permitQuality=false,permitPublish=false,permitSend=false;
const steps:any[]=[];
const saveStep=(name:string)=>steps.push({name,status:run.status,nodes:tasks.map(t=>({key:t.task_key,status:t.status,proof:t.output?.proof||null}))});
const customer={id:'mock-customer',tenantId:tenant,sourcePostId:'',name:'MOCK buyer',waNumber:'12025550123'};
const prepare=async({task:t}:any)=>{
 const c=t.task_key;
 if(c==='scheduled_source_collection')records.scheduled_tasks=[{id:'mock-schedule',tenant_id:tenant,enabled:true,task_id:'mock-schedule',config:{workflowTaskId:t.id,synthetic:true}}];
 if(c==='viral_analysis'&&permitAnalysis)records.trend_videos=[{id:'mock-reference',tenantId:tenant,...scope(c),aiAnalysis:{analysisMode:'exact',analysisQuality:'video',gemini:{synthetic:true,shots:[{text:'MOCK shot'}]}}}];
 if(c==='content_production')records.studio_projects=[{id:'mock-project',tenant_id:tenant,...scope(c),status:'ready_for_approval',spec:{caption:'MOCK content - simulation only',automation:{managedBy:'digital_employee',stage:'completed',renderOutputPath:fixtureVideo,quality:{passed:permitQuality,ruleVersion:9,synthetic:true}}}}];
 if(c==='content_quality_gate'&&permitQuality)records.studio_projects[0].spec.automation.quality.passed=true;
 if(c==='platform_publish'&&permitPublish){for(const post of records.posts||[]){post.platform_post_id='MOCK-platform-receipt';post.stats={...post.stats,status:'published',publishResults:{'mock-account':{accountId:'mock-account',platform:'facebook',status:'published',platformPostId:'MOCK-platform-receipt'}},synthetic:true};customer.sourcePostId=post.id;}}
 if(c==='customer_segmentation')records.customer_segments=[{id:'mock-segment',tenant_id:tenant,run_id:run.id,task_id:t.id,status:'ready',version:1,member_count:1,synthetic:true}];
 if(c==='followup_batch_draft'){
 records.followup_batches=[{id:'mock-batch',tenant_id:tenant,run_id:run.id,task_id:t.id,segment_id:'mock-segment',status:'draft',version:1,content_hash:'mock-hash',counts:{draft:1},synthetic:true}];
 records.followup_batch_items=[{id:'mock-item',tenant_id:tenant,batch_id:'mock-batch',customer_id:customer.id,status:'draft',content_hash:'mock-item-hash',body:'MOCK followup',draft:'MOCK followup',draft_body:'MOCK followup',send_mode:'freeform',time_zone:'UTC',exclusion_reason:'',synthetic:true}];
 records.followup_batch_items[0].content_hash=followupItemContentHash(records.followup_batch_items[0]);
 }
 if(c==='followup_dispatch'&&permitSend){Object.assign(records.followup_batch_items[0],{status:'sent',provider_message_id:'MOCK-message-receipt',provider_receipt:{id:'MOCK-message-receipt',synthetic:true},sent_at:new Date().toISOString()});}
 return true;
};
const handler=(digitalEmployeesRouter as any).stack.find((s:any)=>s.route?.path==='/approvals/:approvalId/decide').route.stack.at(-1).handle;
const decide=async(key:string,decision='approved')=>{const approval=records.approval_requests.find(a=>a.task_id===task(key).id&&a.status==='pending');assert.ok(approval,`approval exists ${key}`);let code=200,body:any;const res:any={locals:{tenantId:tenant,userId:'mock-reviewer'},status(n:number){code=n;return this;},json(x:any){body=x;return this;}};await handler({params:{approvalId:approval.id},body:{decision,note:'MOCK-only simulated human decision'}},res);assert.equal(code,200,JSON.stringify(body));};
try {
 await Promise.all(['scope-a','scope-b'].map(label=>withExecutionAdapters({customers:()=>[{label}]},async()=>{await new Promise(resolve=>setTimeout(resolve,2));assert.equal(currentExecutionAdapters()?.customers?.()[0].label,label,'parallel adapter scope isolation');})));
 assert.equal(currentExecutionAdapters(),undefined);
 const snapshot = await buildBusinessSnapshot(tenant,{startsAt:'2026-09-01',endsAt:'2026-09-30'});
 for(const metric of Object.values(snapshot.customer))Object.assign(metric,{value:1,status:'available'});
 snapshot.readiness.find(r=>r.key==='social_accounts')!.status='ready';
 await withExecutionAdapters({prepare,customers:()=>[customer],snapshot:async()=>structuredClone(snapshot)},async()=>{
  await reconcileDigitalEmployeeRun(tenant,run.id);saveStep('missing_analysis');
  assert.equal(task('viral_analysis').status,'waiting_external');assert.notEqual(task('content_release_approval').status,'succeeded');
  permitAnalysis=true;await reconcileDigitalEmployeeRun(tenant,run.id);saveStep('quality_failed');
  assert.equal(task('content_production').status,'waiting_external');assert.equal(task('content_release_approval').status,'pending');
  permitQuality=true;await reconcileDigitalEmployeeRun(tenant,run.id);saveStep('publishing_approval');
  assert.equal(task('content_release_approval').status,'waiting_approval');assert.equal(task('platform_publish').status,'pending');assert.equal((records.posts||[]).length,0);
  assert.equal(records.approval_requests.find(approval=>approval.task_id===task('content_release_approval').id)?.requested_by_agent,'business');
  const approvalsBefore=records.approval_requests.length;await reconcileDigitalEmployeeRun(tenant,run.id);assert.equal(records.approval_requests.length,approvalsBefore,'pending approval deduplicated');
  await decide('content_release_approval');saveStep('awaiting_publish_receipt');
  assert.equal(task('platform_publish').status,'waiting_external');assert.equal(task('customer_attribution').status,'pending');assert.equal(records.posts.length,1);
  permitPublish=true;await reconcileDigitalEmployeeRun(tenant,run.id);saveStep('followup_approval');
  assert.equal(task('customer_attribution').status,'succeeded');assert.equal(task('followup_batch_approval').status,'waiting_approval');assert.equal(task('followup_dispatch').status,'pending');
  await decide('followup_batch_approval');saveStep('awaiting_message_receipt');
  assert.equal(task('followup_dispatch').status,'waiting_external');assert.equal(task('weekly_review').status,'pending');
  permitSend=true;await reconcileDigitalEmployeeRun(tenant,run.id);saveStep('all_terminal');
  assert.equal(run.status,'succeeded');assert.ok(tasks.every(t=>t.status==='succeeded'));
  assert.equal(records.weekly_reviews.length,1,'a real review record is written to the isolated store');assert.equal(records.weekly_reviews[0].status,'generated');assert.equal(records.weekly_reviews[0].summary.completionRate,100);
  const counts=Object.fromEntries(Object.entries(records).map(([k,v])=>[k,v.length]));await reconcileDigitalEmployeeRun(tenant,run.id);assert.deepEqual(Object.fromEntries(Object.entries(records).map(([k,v])=>[k,v.length])),counts,'completed reconciliation creates nothing twice');
 });
 assert.equal(currentExecutionAdapters(),undefined,'scoped adapters do not leak to production defaults');assert.equal(networkCalls,0);assert.equal((records.run_events||[]).filter(e=>e.type==='task.execution_failed').length,0,'no swallowed execution errors');
 const result={schemaVersion:1,generatedAt:new Date().toISOString(),mode:'isolated_mock_with_real_orchestrator',realBusinessRunModified:false,synthetic:true,networkCalls,taskCount:tasks.length,successfulTasks:tasks.filter(t=>t.status==='succeeded').length,coverage:{real:['domain plan DAG','dependency gates','proof predicates','approval preflight and decision handler','publishing calendar creation','task and run state transitions','weekly review aggregation','pending approval and completed-run idempotence','parallel adapter scope isolation'],simulated:['collection/analysis output','render and quality result','customer read model','segment and draft creation','platform and message provider receipts','human approval decisions'],notCovered:['real providers','OAuth/auth middleware','browser UI','real file rendering/vision','actual message delivery','natural customer attribution acquisition']},steps,statusHistory};
 assert.equal(result.realBusinessRunModified,false);
 assert.equal(result.networkCalls,0);
 assert.equal(result.successfulTasks,result.taskCount);
 assert.equal(result.steps.at(-1)?.name,'all_terminal');
 assert.equal(result.steps.at(-1)?.status,'succeeded');
 console.log('16-node real-orchestrator mock integration passed; in-memory summary validated; all external outputs synthetic; network calls 0');
} finally {Object.assign(store,original);globalThis.fetch=originalFetch;fs.rmSync(fixtureDirectory,{recursive:true,force:true});}
