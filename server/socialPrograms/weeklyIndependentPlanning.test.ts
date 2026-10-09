import {mayReconcileExistingWeeklyPlanning} from '../runtime/socialWeeklyPlanningReconciliation.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './weeklyContentTemplates.fixture.js';import {createSocialProgramService} from './service.js';import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';import {createWeeklyPlanningAuthority} from './planningAuthority.js';import {applyBusinessDispatchToExecutionTasks,listWeeklyExecutionTasks} from './executionTasks.js';
import {createSocialWeeklyPlanningAdapter} from '../runtime/socialWeeklyExecutionRuntime.js';import {validateWeeklyExecutionResults} from '../runtime/socialWeeklyResultValidation.js';import {createSocialWeeklyExecutionWorker} from '../runtime/socialWeeklyExecutionWorker.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';
import type {DataStore} from '../storage/datastore.js';
async function seedExternal(dataStore:DataStore,programId:string){
  await dataStore.create('social_discovery_scopes', {
    tenant_id: 't', program_id: programId, status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await dataStore.create('social_candidate_evidence', {
    tenant_id: 't', evidenceId: 'evidence-video-1', version: 1, tenantId: 't', candidateId: 'video-1', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'video-1', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/video-1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await dataStore.create('trend_videos', { id: 'video-1', tenantId: 't', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/video-1' });
  await dataStore.create('social_tracked_accounts', {
    tenant_id: 't', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['video-1', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });

}
async function authoritativeInput(
  dataStore: DataStore,
  programId: string,
  accountIds: Record<string, string[]>,
): Promise<Record<string, unknown>> {
  const repository = createSocialOperatingRepository(dataStore);
  const goalRef = { type: 'business_content_goal', id: `goal-${programId}`, version: 1 };
  const goal = {
    goalId: goalRef.id, programId, version: 1, status: 'ready', objective: '获取可资格确认的采购咨询',
    products: ['精华'], markets: ['北美'], audiences: ['品牌采购'], languages: ['en'],
    accountBoundaries: [], conversionRouteIds: ['route-1'], publicFactRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }],
    prohibitedClaims: [], weeklyBudgetCny: 2600, evidence: [], blockers: [], inputRefs: [], inputFingerprint: `goal-fp-${programId}`,
    ruleVersion: 'business-content-goal/1.0.0', decisionRecordRef: { type: 'decision_record', id: `goal-decision-${programId}`, version: 1 },
    createdBy: 'operating-agent', createdAt: '2026-10-01T00:00:00.000Z',
  } as any;
  const goalDecision = {
    decisionId: `goal-decision-${programId}`, decisionType: 'business_content_goal', subjectRef: goalRef, version: 1,
    outcome: 'accepted', ruleVersion: 'business-content-goal/1.0.0', inputRefs: [], inputFingerprint: goal.inputFingerprint,
    evidence: [], blockers: [], impacts: [], output: goalRef, operator: { type: 'agent', id: 'operating-agent' }, decidedAt: goal.createdAt,
  } as any;
  await repository.save('t', goal, goalDecision);
  const quotas = [
    ...accountIds.tiktok!.map(accountId => ({ accountId, publicationQuota: 5 })),
    ...accountIds.facebook!.map(accountId => ({ accountId, publicationQuota: 5 })),
    ...accountIds.instagram!.map(accountId => ({ accountId, publicationQuota: 3 })),
    ...accountIds.youtube!.map(accountId => ({ accountId, publicationQuota: 3 })),
  ];
  const capacityRef = { type: 'capacity_plan', id: `capacity-${programId}`, version: 1 };
  await repository.saveDecision('t', programId, {
    decisionId: capacityRef.id, decisionType: 'capacity_plan', subjectRef: goalRef, version: 1, outcome: 'accepted',
    ruleVersion: 'capacity-planner/1.0.0', inputRefs: [goalRef], inputFingerprint: `capacity-fp-${programId}`,
    evidence: [], blockers: [], output: { status: 'ready', originalContentQuota: 5, adaptationQuota: 0, publicationQuota: 5, accountQuotas: quotas, estimatedCostCny: 2600, limitingFactors: [] },
    operator: { type: 'agent', id: 'capacity-agent' }, decidedAt: '2026-10-01T00:01:00.000Z',
  });
  const policyRef = { type: 'automation_policy', id: `policy-${programId}`, version: 1 };
  await repository.saveDecision('t', programId, {
    decisionId: policyRef.id, decisionType: 'automation_policy', subjectRef: goalRef, version: 1, outcome: 'accepted',
    ruleVersion: 'automation-policy/1.0.0', inputRefs: [goalRef], inputFingerprint: `policy-fp-${programId}`,
    evidence: [], blockers: [], output: { status: 'allowed', mode: 'managed', action: 'draft', humanGate: 'none', automaticExecutionAllowed: true, authorizationIssue: null },
    operator: { type: 'agent', id: 'policy-agent' }, decidedAt: '2026-10-01T00:02:00.000Z',
  });
  return {
    businessContentGoalRef: goalRef,
    capacityPlanRef: capacityRef,
    automationPolicyRef: policyRef,
    publicationTasks: Array.from({ length: 5 }, (_, index) => ({
      businessProposition: `业务主张-${index + 1}`, cta: '查看产品页',
      factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }],
      metricTargets: ['qualified_inquiry'], publishWindow: '2026-10-13T10:00:00Z',
    })),
  };
}
test('actual established program keeps owned gaps while external slots get explicit immutable partial dispatch',async()=>{const f=await fixture();try{const programs=createSocialProgramService(f.store),p=await programs.createProgram('t','owner',{brandName:'Factory',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'account_repair'}),account=await programs.createAccount('t','owner',p.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'facts'}),packages=createWeeklyOperatingPackageService(f.store);const authorityInput=await authoritativeInput(f.store,p.programId,{tiktok:[account.accountId],facebook:[],instagram:[],youtube:[]});const pkg=await packages.create('t','owner',p.programId,{...authorityInput,weekStart:'2026-10-12',objective:'Five weekly publications',successCriteria:['Five reviewed videos'],accountPlans:[{accountId:account.accountId,publicationCount:5}],originalContentTarget:5,referenceSourcePolicy:{profile:'b2b_established',ownedPercent:40,externalPercent:60,allocationUnit:'mother_content'}});await seedExternal(f.store,p.programId);const authority=createWeeklyPlanningAuthority(f.store),outline=await authority.get('t',p.programId,pkg.packageId,1),a={tenantId:'t',programId:p.programId,packageId:pkg.packageId,packageVersion:1};assert.equal(outline.skeleton.slots.filter(s=>s.referenceSource==='owned').length,2);let analyzed=await authority.runDirectorAnalysis({...a,expectedPlanningVersion:outline.version,actor:'director_agent'});assert.equal(analyzed.directorAnalyses.length,3);assert.equal(analyzed.directorGaps?.length,2);assert.ok(analyzed.directorGaps?.every(g=>g.referenceSource==='owned'));assert.deepEqual(analyzed.referenceSourcePolicy,pkg.referenceSourcePolicy);const originalExternalRefs=structuredClone(analyzed.directorAnalyses);analyzed=await authority.runDirectorAnalysis({...a,expectedPlanningVersion:analyzed.version,actor:'director_agent',selectedSlotIds:outline.skeleton.slots.filter(s=>s.referenceSource==='owned').map(s=>s.slotId)});assert.deepEqual(analyzed.directorAnalyses,originalExternalRefs,'reanalysis of missing owned branch preserves real independent external analyses');assert.equal(analyzed.directorGaps?.length,2);for(const selectedSlotIds of ['foo',{},null,[],[1],[' '],Array(1001).fill('fake')])await assert.rejects(authority.runDirectorAnalysis({...a,expectedPlanningVersion:analyzed.version,actor:'director_agent',selectedSlotIds:selectedSlotIds as unknown as string[]}),e=>e instanceof Error&&'status'in e&&e.status===400);await assert.rejects(authority.mergeDetailedSchedule({tenantId:'t',programId:p.programId,package:pkg,expectedPlanningVersion:analyzed.version,actor:'business_agent'}));const selectedSlotIds=analyzed.directorAnalyses.map(x=>x.slotId);const schedule=await authority.mergeDetailedSchedule({tenantId:'t',programId:p.programId,package:pkg,expectedPlanningVersion:analyzed.version,actor:'business_agent',selectedSlotIds});assert.equal(schedule.detailedSchedule?.items.length,3);assert.equal(schedule.detailedSchedule?.coverage?.pendingSlotIds.length,2);await assert.rejects(authority.confirm({...a,expectedPlanningVersion:schedule.version,userId:'owner'}));for(const bad of ['foo',{},null,[],[1]])await assert.rejects(authority.confirm({...a,expectedPlanningVersion:schedule.version,userId:'owner',selectedSlotIds:bad as unknown as string[]}),e=>e instanceof Error&&'status'in e&&e.status===400);const confirmed=await authority.confirm({...a,expectedPlanningVersion:schedule.version,userId:'owner',selectedSlotIds});await assert.rejects(authority.dispatch({...a,expectedPlanningVersion:confirmed.version,actor:'business_agent',selectedSlotIds:[selectedSlotIds[0]!] }));for(const bad of ['foo',{},null,[],[1]])await assert.rejects(authority.dispatch({...a,expectedPlanningVersion:confirmed.version,actor:'business_agent',selectedSlotIds:bad as unknown as string[]}),e=>e instanceof Error&&'status'in e&&e.status===400);const dispatched=await authority.dispatch({...a,expectedPlanningVersion:confirmed.version,actor:'business_agent',selectedSlotIds});assert.equal(dispatched.dispatch?.scheduleItems.length,3);assert.equal(dispatched.directorGaps?.length,2);assert.equal(dispatched.skeleton.slots.length,5);assert.deepEqual(dispatched.referenceSourcePolicy,pkg.referenceSourcePolicy);const actualTasks=await listWeeklyExecutionTasks(f.store,'t',p.programId,pkg.packageId,1);assert.equal(actualTasks.filter(t=>t.schedule.stepKind==='director_analysis').length,5);assert.ok(actualTasks.every(t=>t.status!=='succeeded'),'planning alone never completes production tasks');
const bound=await applyBusinessDispatchToExecutionTasks(f.store,'t',p.programId,pkg.packageId,1,dispatched.dispatch!);const selectedPublications=new Set(dispatched.dispatch!.scheduleItems.map(i=>i.publicationTaskId));assert.ok(bound.filter(t=>t.schedule.stepKind==='material_readiness'&&selectedPublications.has(t.publicationTaskId!)).every(t=>!t.ownBlockingReasons.includes('business_dispatch_required')));assert.ok(bound.filter(t=>t.schedule.stepKind==='material_readiness'&&!selectedPublications.has(t.publicationTaskId!)).every(t=>t.ownBlockingReasons.includes('business_dispatch_required')));
const adapter=createSocialWeeklyPlanningAdapter(f.store),external=bound.find(t=>t.schedule.stepKind==='benchmark_scoring'&&t.inputSnapshot.referenceSource==='external')!,owned=bound.find(t=>t.schedule.stepKind==='benchmark_scoring'&&t.inputSnapshot.referenceSource==='owned')!;const evidence=await adapter.execute(external);assert.equal(evidence.status,'succeeded');if(evidence.status==='succeeded'){await validateWeeklyExecutionResults(f.store,external,evidence.resultRefs);await assert.rejects(validateWeeklyExecutionResults(f.store,owned,evidence.resultRefs));}assert.equal((await adapter.execute(owned)).status,'blocked');
assert.ok(Date.parse(external.schedule.estimatedStartAt)>Date.now(),'factory forecast is future while actual scoped planning evidence already exists');
const worker=createSocialWeeklyExecutionWorker(f.store);let queuedExternal=false,completedExternal=false;
for(let i=0;i<30;i++){const actual=await listWeeklyExecutionTasks(f.store,'t',p.programId,pkg.packageId,1);const readyExternal=actual.find(t=>t.taskId===external.taskId);if(readyExternal?.status==='queued'){queuedExternal=true;const clock=new Date();assert.equal(await mayReconcileExistingWeeklyPlanning(f.store,readyExternal,clock),true);assert.equal(await mayReconcileExistingWeeklyPlanning(f.store,owned,clock),false,'missing owned observations cannot borrow readyExternal proof');assert.equal(await mayReconcileExistingWeeklyPlanning(f.store,{...readyExternal,nextAttemptAt:new Date(clock.getTime()+60000).toISOString()},clock),false,'explicit retry availability is retained');assert.equal(await mayReconcileExistingWeeklyPlanning(f.store,{...readyExternal,inputSnapshot:{...readyExternal.inputSnapshot,scheduleRevisionRef:{type:'weekly_schedule_snapshot',id:'snapshot',version:1}}},clock),false,'confirmed capacity schedule is not a forecast');assert.equal(await mayReconcileExistingWeeklyPlanning(f.store,{...readyExternal,schedule:{...readyExternal.schedule,stepKind:'publishing'}},clock),false,'publication time gate is never reconciled early');const persistedPackage=f.tables.social_weekly_operating_packages!.find(row=>row.package_id===pkg.packageId)!.payload as Record<string,unknown>;persistedPackage.scheduleRevisionRef={type:'weekly_schedule_snapshot',id:'snapshot',version:1};assert.equal(await mayReconcileExistingWeeklyPlanning(f.store,readyExternal,clock),false,'server frozen schedule is honored even if task omitted its ref');delete persistedPackage.scheduleRevisionRef;
}const claim=await worker.claimNext({tenantId:'t',workerId:'independent-test',kinds:['readiness','discovery','directing']});if(!claim)break;const output=await adapter.execute(claim.task);if(output.status==='succeeded'){await worker.complete(claim,output.resultRefs);if(claim.task.taskId===external.taskId)completedExternal=true;}else await worker.defer(claim,{code:output.code,message:output.message,blockingReason:output.code});}
assert.ok(queuedExternal&&completedExternal,JSON.stringify((await listWeeklyExecutionTasks(f.store,'t',p.programId,pkg.packageId,1)).filter(t=>['business_outline','benchmark_collection','benchmark_scoring'].includes(t.schedule.stepKind)).map(t=>({step:t.schedule.stepKind,source:t.inputSnapshot.referenceSource,status:t.status,own:t.ownBlockingReasons,inherited:t.inheritedBlockingTaskIds}))));const after=await listWeeklyExecutionTasks(f.store,'t',p.programId,pkg.packageId,1);assert.notEqual(after.find(t=>t.taskId===owned.taskId)?.status,'succeeded');assert.ok(after.filter(t=>t.schedule.stepKind==='material_readiness'&&!selectedPublications.has(t.publicationTaskId!)).every(t=>t.status==='blocked'));}finally{await f.cleanup();}});
