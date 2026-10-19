import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {bindWeeklyPreproductionAuthority,runWeeklyPreproductionProducerScan,WEEKLY_PREPRODUCTION_JOBS} from '../runtime/weeklyPreproductionProducer.js';
import {supplementConsumerHash} from './weeklySupplementRequests.js';
import {projectWeeklyContinuationCalendar} from './weeklyContinuationCalendar.js';
import {auditWeeklyTasks,classifyWeeklyBlocker,weeklyBlockerAction} from './weeklyTaskAudit.js';
import type {Record_} from '../storage/datastore.js';
import {issueWeeklyAccountCollectionBudgetAuthorization} from '../socialDiscovery/weeklyAccountCollectionBudget.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

test('signed blocked collection job supersedes stale dispatch reason only in read models',async t=>{
  const f=await prepareWeeklyEnterpriseFactFixture(t);
  const task={...f.task,
    workflowKind:'readiness' as const,scope:'package' as const,accountId:null,publicationTaskId:null,inputSnapshot:{},
    status:'blocked' as const,ownBlockingReasons:['business_dispatch_required'],
    lastError:{code:'business_dispatch_required',message:'等待排期确认及正式派单',retryable:false,occurredAt:'2026-10-18T00:00:00Z'},
    schedule:{...f.task.schedule,stepKind:'benchmark_collection' as const},
  };
  await f.store.create('social_weekly_execution_tasks',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,idempotency_key:task.idempotencyKey,status:task.status,payload:task});
  const scope={id:'approved-collection',tenant_id:task.tenantId,version:1,status:'active',created_by:'owner',payload:{approval:{status:'approved',scopeVersion:1,approvedBy:'owner'},discoveryBrief:{discoveryModes:['account'],modePolicies:{account:{enabled:true}}}}};
  await f.store.create('social_discovery_scopes',scope);
  await bindWeeklyPreproductionAuthority({store:f.store,tenantId:task.tenantId,actorUserId:'owner',programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(task),discovery:{scopeId:scope.id,scopeVersion:1,requestedModes:['account']}});
  const oldToken=process.env.APIFY_TOKEN;delete process.env.APIFY_TOKEN;
  try{
    const scan=await runWeeklyPreproductionProducerScan({store:f.store});
    assert.equal(scan.blocked,1);
    const job=(await f.store.list<Record_>(WEEKLY_PREPRODUCTION_JOBS)).items[0]!;
    assert.equal((job.payload as {code:string}).code,'weekly_preproduction_collection_credentials_required');
    const before=f.store.snapshot();
    const [projected]=await projectWeeklyContinuationCalendar(f.store,[task]);
    assert.deepEqual(projected!.ownBlockingReasons,['weekly_preproduction_collection_credentials_required']);
    assert.equal(projected!.lastError?.code,'weekly_preproduction_collection_credentials_required');
    assert.match(projected!.lastError!.message,/采集受阻／待干预/);
    const audit=await auditWeeklyTasks(f.store,[task]);
    assert.deepEqual(audit.items[0]!.ownReasons.map(reason=>reason.code),['weekly_preproduction_collection_credentials_required']);
    assert(audit.items[0]!.requiredActions.some(action=>action.code==='weekly_preproduction_collection_credentials_required'&&action.action==='collection_service'&&action.userRequired));
    assert.equal(classifyWeeklyBlocker('weekly_preproduction_collection_credentials_required'),'user_input');
    assert.match(weeklyBlockerAction('weekly_preproduction_collection_credentials_required').label,/任务卡不收集密钥/);
    assert.deepEqual(f.store.snapshot(),before,'read models must never mutate the task, job, quota or scheduler state');
    assert.deepEqual(task.ownBlockingReasons,['business_dispatch_required']);

    await f.store.update(WEEKLY_PREPRODUCTION_JOBS,job.id,{record_hash:'tampered'});
    const [unverified]=await projectWeeklyContinuationCalendar(f.store,[task]);
    assert.deepEqual(unverified!.ownBlockingReasons,['business_dispatch_required'],'damaged job cannot become a credential intervention');
    assert.equal(unverified!.lastError?.code,'business_dispatch_required');
  }finally{if(oldToken===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=oldToken;}
});

test('account collection without CNY authorization is an intervention before run or quota reservation',async t=>{
  const f=await prepareWeeklyEnterpriseFactFixture(t),url='https://www.tiktok.com/@yuchengcosmeticsfactory';
  f.pkg.discoveryBudgetCny=5;const packageRow=(await f.store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,program_id:f.task.programId,package_id:f.task.packageId,version:f.task.packageVersion},perPage:2})).items[0]!;await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:structuredClone(f.pkg)});
  const task={...f.task,workflowKind:'readiness' as const,scope:'package' as const,accountId:null,publicationTaskId:null,inputSnapshot:{},status:'blocked' as const,ownBlockingReasons:['business_dispatch_required'],schedule:{...f.task.schedule,stepKind:'benchmark_collection' as const}};
  await f.store.create('social_weekly_execution_tasks',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,idempotency_key:task.idempotencyKey,status:task.status,payload:task});
  const scope={id:'scope-account-fee',tenant_id:task.tenantId,version:3,status:'active',created_by:'owner',payload:{approval:{status:'approved',scopeVersion:3,approvedBy:'owner'},weeklyAccountRevision:{accountUrl:url,targetCount:5},discoveryBrief:{discoveryModes:['account'],weeklyAccountCollectionTarget:{accountUrl:url,targetCount:5},modePolicies:{account:{enabled:true,budgetLimitCny:null}}}}};
  await f.store.create('social_discovery_scopes',scope);
  await f.store.create('competitor_accounts',{id:'scope-account',tenantId:task.tenantId,platform:'tiktok',accountUrl:url});
  await bindWeeklyPreproductionAuthority({store:f.store,tenantId:task.tenantId,actorUserId:'owner',programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(task),discovery:{scopeId:scope.id,scopeVersion:3,requestedModes:['account']}});
  const oldToken=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='test-token-never-used';let posts=0;
  try{
    const scan=await runWeeklyPreproductionProducerScan({store:f.store,discoveryDependencies:{dataStore:f.store,async crawl(){posts++;throw Error('unexpected POST');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('unexpected worker');}}});
    assert.equal(scan.blocked,1,JSON.stringify(scan));assert.equal(posts,0);
    assert.equal((await f.store.list('social_discovery_runs')).totalItems,0);assert.equal((await f.store.list('social_discovery_daily_reservations')).totalItems,0);
    const [projected]=await projectWeeklyContinuationCalendar(f.store,[task]);
    assert.deepEqual(projected!.ownBlockingReasons,['weekly_preproduction_collection_budget_authorization_required']);
    assert.equal(classifyWeeklyBlocker(projected!.lastError!.code),'user_input');
    const audit=await auditWeeklyTasks(f.store,[task]);
    assert(audit.items[0]!.requiredActions.some(action=>action.code==='weekly_preproduction_collection_budget_authorization_required'&&action.userRequired));
    const stale={...task,ownBlockingReasons:['weekly_preproduction_collection_credentials_required'],lastError:{code:'weekly_preproduction_collection_credentials_required',message:'old',retryable:false,occurredAt:'2026-10-18T00:00:00Z'}};
    const [budgetView]=await projectWeeklyContinuationCalendar(f.store,[stale]);
    assert.deepEqual(budgetView!.ownBlockingReasons,['weekly_preproduction_collection_budget_authorization_required']);
    await issueWeeklyAccountCollectionBudgetAuthorization({store:f.store,tenantId:task.tenantId,actorUserId:'owner',programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,scopeId:scope.id,scopeVersion:3,scopeHash:socialRequestHash(scope.payload),actorId:'clockworks/tiktok-scraper',totalLimitCny:5,perRunLimitCny:2,expiresAt:new Date(Date.now()+86400000).toISOString()});
    const next=await runWeeklyPreproductionProducerScan({store:f.store,discoveryDependencies:{dataStore:f.store,async crawl(){posts++;throw Error('unexpected POST');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('unexpected worker');}}});
    assert.equal(next.blocked,1,JSON.stringify(next));assert.equal(posts,0);
    const [technical]=await projectWeeklyContinuationCalendar(f.store,[stale]);
    assert.deepEqual(technical!.ownBlockingReasons,['weekly_preproduction_collection_cost_ceiling_unverified']);
    assert.equal(technical!.taskId,task.taskId,'projection retains the original clickable task identity');
    assert.equal(classifyWeeklyBlocker(technical!.lastError!.code),'technical');
    const technicalAudit=await auditWeeklyTasks(f.store,[stale]);
    assert.deepEqual(technicalAudit.items[0]!.ownReasons.map(reason=>reason.code),['weekly_preproduction_collection_cost_ceiling_unverified']);
    assert(technicalAudit.items[0]!.requiredActions.some(action=>action.code==='weekly_preproduction_collection_cost_ceiling_unverified'&&action.action==='technical_recovery'&&!action.userRequired));
    assert.deepEqual(stale.ownBlockingReasons,['weekly_preproduction_collection_credentials_required']);
  }finally{if(oldToken===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=oldToken;}
});
