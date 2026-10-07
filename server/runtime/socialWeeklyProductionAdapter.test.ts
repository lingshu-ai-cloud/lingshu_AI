import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, Record_, ListQuery } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import { createStarter198Repository } from '../starter198/repository.js';
import { createSocialWeeklyProductionAdapter, weeklyProductionBindingKey } from './socialWeeklyProductionAdapter.js';
function memory(): DataStore {
  const data = new Map<string, Record_[]>();
  return {
    async getById<T>(c: string, id: string) { return structuredClone(data.get(c)?.find(r => r.id === id) ?? null) as T | null; },
    async list<T>(c: string, q: ListQuery = {}) { const rows = (data.get(c) ?? []).filter(r => Object.entries(q.where ?? {}).every(([k,v]) => r[k] === v)); return { items: structuredClone(rows) as T[], totalItems: rows.length, totalPages: 1, page: 1, perPage: q.perPage ?? 30 }; },
    async create<T>(c: string, d: Record<string, unknown>) { const rows = data.get(c) ?? []; const row = { id: `${c}-${rows.length}`, ...structuredClone(d) }; data.set(c, [...rows, row]); return structuredClone(row) as T; },
    async update(c: string, id: string, d: Record<string, unknown>) { const row = data.get(c)?.find(r => r.id === id); if (!row) return false; Object.assign(row, structuredClone(d)); return true; },
    async delete(c: string, id: string) { data.set(c,(data.get(c) ?? []).filter(r => r.id !== id)); return true; },
  };
}
async function fixture() {
  const store = memory();
  const task = { tenantId:'tenant', programId:'program', packageId:'package', packageVersion:2, publicationTaskId:'publication', accountId:'account', workflowKind:'content', schedule:{stepKind:'script'} } as WeeklyExecutionTask;
  const pub = { publicationTaskId:'publication', accountId:'account', businessProposition:'真实经营主张', cta:'了解产品', factRefs:[{type:'enterprise_fact',id:'fact',version:1}], platform:'tiktok' };
  const planning = { status:'dispatched', userConfirmation:{confirmedBy:'human'}, dispatch:{packageId:'package',packageVersion:2, scheduleItems:[{publicationTaskId:'publication',accountId:'account',topic:'真实主题',materialRequirements:[]}]}};
  const pkg = { packageId:'package',programId:'program',version:2,status:'draft',socialContentPackage:{publicationTasks:[pub],perItemBudgetCny:10,weeklyBudgetCny:10}};
  await store.create('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:2,payload:pkg});
  await store.create('social_weekly_agent_planning',{tenant_id:'tenant',program_id:'program',package_id:'package',package_version:2,planning_version:1,payload:planning});
  await store.create('starter_social_content_tasks',{ tenant_id:'tenant',task_id:'content',create_idempotency_key:weeklyProductionBindingKey(task),brief:{_weeklyAuthority:{}} });
  let detail = { taskId:'content',version:'4',runId:'run-existing',status:'producing',readiness:{complete:true,missing:[]},artifacts:[] } as unknown as SocialContentTaskDetail;
  let starts = 0;
  const adapter = createSocialWeeklyProductionAdapter(store,{repository:createStarter198Repository(store),read:async()=>structuredClone(detail),start:async()=>{starts++; return detail;},persistResultAuthority:async()=>{}});
  return { store,task,pkg,planning,adapter,starts:()=>starts,set:(value:Partial<SocialContentTaskDetail>)=>{detail={...detail,...value};} };
}

test('existing running identity is polled without starting another paid run; missing artifact never succeeds',async()=>{
  const f=await fixture();
  assert.equal((await f.adapter.execute(f.task)).status,'pending');
  assert.equal((await f.adapter.execute(f.task)).status,'pending');
  assert.equal(f.starts(),0);
});
test('material readiness completes only after a real run identity, draft formally dispatched package admitted',async()=>{
  const f=await fixture();f.task.schedule.stepKind='material_readiness';
  assert.deepEqual(await f.adapter.execute(f.task),{status:'succeeded',resultRefs:[{type:'starter_social_content_task',id:'content',version:4}]});
  f.set({runId:null,status:'attention'});
  assert.equal((await f.adapter.execute(f.task)).status,'blocked');
});
test('dispatch and same-account authorization gates cannot be bypassed',async()=>{
  const f=await fixture();f.task.accountId='other';assert.equal((await f.adapter.execute(f.task)).status,'blocked');
  f.task.accountId='account';
  const row=(await f.store.list<any>('social_weekly_agent_planning')).items[0];
  await f.store.update('social_weekly_agent_planning',row.id,{payload:{...f.planning,userConfirmation:null}});
  assert.equal((await f.adapter.execute(f.task)).status,'blocked');
});
test('real generated artifact completes evidence-backed steps; creative quality failure stays blocked',async()=>{
  const f=await fixture();
  const artifact:any={artifactId:'artifact',taskId:'content',version:'1',kind:'short_video',origin:'agent',resourceRef:'socialfile:file',status:'review_required',content:{render:{completed:true,selectedAssetIds:['asset']},scriptBaseline:{scenes:[{script:'真实脚本'}]},directorPlan:{sceneCount:1},productionResult:{technicalReview:{approved:true},creativeReview:{approved:false}}}};
  f.set({status:'asset_review',artifacts:[artifact]});
  assert.equal((await f.adapter.execute(f.task)).status,'succeeded');
  f.task.schedule.stepKind='quality_check';
  assert.equal((await f.adapter.execute(f.task)).status,'blocked');
  artifact.content.productionResult.creativeReview.approved=true;f.set({artifacts:[artifact]});
  assert.equal((await f.adapter.execute(f.task)).status,'succeeded');
  artifact.status='superseded';f.set({artifacts:[artifact]});
  assert.equal((await f.adapter.execute(f.task)).status,'pending');
});
test('paused production preserves progress and awaits user action without restarting',async()=>{
  const f=await fixture();f.set({status:'attention',productionProgress:{step:'provider_reconciliation',activity:'供应商回执未知，需对账',estimatedRemainingSeconds:0,updatedAt:new Date().toISOString()}});
  const result=await f.adapter.execute(f.task);assert.equal(result.status,'blocked');
  assert.equal(f.starts(),0);
});

test('authoritative production binding freezes real analyzed evidence and rejects changed frozen evidence',async()=>{
  const { bindWeeklyProductionAuthority } = await import('./socialWeeklyProductionAuthority.js');
  const { createSocialAssetSupplyPlan } = await import('../../shared/socialContentAssetSupply.js');
  const { socialRequestHash } = await import('../starter198/socialContentValidation.js');
  const f=await fixture();
  const fact={type:'enterprise_fact',id:'fact',version:1};
  const publication:any={...f.pkg.socialContentPackage.publicationTasks[0],motherContentId:'mother',adaptationOfPublicationTaskId:null,accountPositioning:'采购',metricTargets:['询盘'],publishWindow:'2026-10-08',factRefs:[fact]};
  const weeklyWorkflowTask:any={taskId:'weekly-content',kind:'content',taskRef:{type:'weekly_workflow_task',id:'weekly-content',version:2},subjectRefs:[{type:'weekly_publication_task',id:'publication',version:2}],dependsOnTaskIds:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],status:'planned'};
  const analysis={analysisId:'analysis',benchmarkVideoRefs:[{type:'social_discovery_video',id:'candidate',version:3}],benchmarkEvidenceRefs:['evidence'],benchmarkAccountRefs:[]};
  const pkg:any={...f.pkg,enterpriseProfileRef:{type:'enterprise_profile',id:'enterprise',version:1},businessContentGoalRef:{type:'business_content_goal',id:'goal',version:1},workflowTasks:[weeklyWorkflowTask],successCriteria:['询盘'],weekEnd:'2026-10-11',socialContentPackage:{...f.pkg.socialContentPackage,publicationTasks:[publication],originalContentTarget:1,adaptationVersionTarget:0,publicationTaskTarget:1},agentPlanning:{...f.planning,directorAnalyses:[analysis],dispatch:{...f.planning.dispatch,issuedAt:'2026-10-07T00:00:00Z',scheduleItems:[{...f.planning.dispatch.scheduleItems[0],directorAnalysisRef:{type:'weekly_director_analysis',id:'analysis',version:1}}]}}};
  const goal={goalId:'goal',programId:'program',version:1,status:'ready',objective:'获得询盘',products:['产品'],markets:['US'],audiences:['采购商'],languages:['zh'],publicFactRefs:[fact],prohibitedClaims:[],weeklyBudgetCny:10,blockers:[],inputRefs:[],conversionRouteIds:[],accountBoundaries:[],evidence:[]};
  await f.store.create('social_business_content_goals',{tenant_id:'tenant',program_id:'program',goal_id:'goal',version:1,payload:goal});
  await f.store.create('social_programs',{tenant_id:'tenant',program_id:'program',payload:{version:4}});
  await f.store.create('social_candidate_evidence',{tenant_id:'tenant',tenantId:'tenant',candidateId:'candidate',evidenceId:'evidence',version:3,g1:{sourceUrl:'https://example.com/reference'},evidence:{qualityScore:{dimensions:{relevance:90,transferability:80}}}});
  const handoff:any={inspirationId:'candidate',analysisId:'real-analysis',analysisVersion:'3',version:'3',readiness:'production_reference',source:{platform:'tiktok',sourceUrl:'https://example.com/reference'},taskContext:{},whySelected:['观察到的结构'],referenceRole:'primary_structure',reusableLogic:{hookTypes:[],revealOrder:[],proofPlacement:[],pacing:'',emotionalProgression:'',ctaPosition:''},adaptationBoundary:{reusable:[],mustReplace:[],prohibited:[]},productionImplications:{requiredEvidence:[],likelyAssetNeeds:[],risks:[]},evidenceRefs:[{description:'真实观测',confidence:0.9,needsReview:false}],rights:{mayAnalyze:true,mayUseOriginalMedia:false,mayAdapt:true}};
  await f.store.create('starter_social_inspiration_handoff_versions',{tenant_id:'tenant',handoff_id:'candidate',handoff_version:'3',payload:handoff,record_hash:socialRequestHash(handoff)});
  const brief:any={title:'采购内容',objective:'获得询盘',productRef:'产品',audience:'采购',markets:['US'],languages:['zh'],platforms:['tiktok'],formats:['short_video'],aspectRatio:'9:16',cadence:null,requestedOutputCount:1,weeklyBudgetCny:10,perItemBudgetCny:10,retryReserveCny:null,planningMode:'auto_adjust',shootingWindowMinutes:0,specialRequirements:null,dueAt:null,brandNotes:null,restrictions:[],callToAction:'询盘',creationMode:'material_processing',assetAvailability:'none',managementMode:'one_click_managed',productionMode:'social_ready'};
  const detail:any={taskId:'content',version:'1',status:'plan_review',brief,sources:[],assetSupplyPlan:createSocialAssetSupplyPlan({creationMode:'material_processing',planVersion:'1',confirmedFactRefs:['enterprise_fact:fact@1'],shots:[{shotId:'scene-1',function:'value',requestedDescription:'真实内容'}]}),referenceVideoAnalysis:null,replicationScript:null};
  const repository=createStarter198Repository(f.store);
  const result=await bindWeeklyProductionAuthority({dataStore:f.store,repository,tenantId:'tenant',pkg,publication,detail});
  assert.equal(result.referenceSelection.selected[0].evidenceVersion,3);
  const replay=await bindWeeklyProductionAuthority({dataStore:f.store,repository,tenantId:'tenant',pkg,publication,detail});
  assert.equal(replay.referenceSelection.selectionId,result.referenceSelection.selectionId);
  assert.equal((await f.store.list('starter_social_content_lineage')).totalItems,1);
  assert.equal((await f.store.list('starter_social_director_brief_versions')).totalItems,1);
  const candidate=(await f.store.list<any>('social_candidate_evidence')).items[0];await f.store.update('social_candidate_evidence',candidate.id,{version:4});
  await assert.rejects(()=>bindWeeklyProductionAuthority({dataStore:f.store,repository,tenantId:'tenant',pkg,publication,detail}),/weekly_production_analyzed_handoff_required/);
});


test('observed production progress is returned while artifacts remain pending, never as completion', async () => {
  const f = await fixture();
  f.set({ productionProgress: { step: 'content_production', activity: '正在合成真实素材', estimatedRemainingSeconds: 90, updatedAt: '2026-10-07T00:00:00Z' } });
  const result = await f.adapter.execute(f.task);
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.status === 'pending' ? result.progress : null, { contentTaskId: 'content', runId: 'run-existing', step: 'content_production', activity: '正在合成真实素材', updatedAt: '2026-10-07T00:00:00Z' });
  assert.equal('resultRefs' in result, false);
  assert.equal(f.starts(), 0);
});
