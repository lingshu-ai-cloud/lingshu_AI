import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from '../runtime/durableLease.js';
import { createWeeklyPlanningAuthority, assertWeeklyDirectorQualifiedAdmission, readWeeklyPinnableReferenceOptions } from './planningAuthority.js';
import {assertWeeklyDetailedCoverage} from './weeklyPlanningCoverage.js';
import { SocialProgramError } from './service.js';
import { linkObservedWeeklyAccounts } from '../socialDiscovery/observedAccountLink.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

test('pinned-reference options do not surface historical supply without this package run', async()=>{
 const store=memoryStore(),weekly=pkg();
 const state=await createWeeklyPlanningAuthority(store).initialize('tenant-1',weekly);
 await store.create('trend_videos',{id:'old-tenant-video',tenantId:'tenant-1',title:'Historical video',sourceUrl:'https://www.tiktok.com/@factory/video/123'});
 const options=await readWeeklyPinnableReferenceOptions(store,{tenantId:'tenant-1',programId:weekly.programId,packageId:weekly.packageId,packageVersion:weekly.version});
 assert.equal(options.status,'awaiting_collection');
 assert.equal(options.planningVersion,state.version);
 assert.deepEqual(options.options,[]);
});

test('automatic director admission rejects high-score cross-product videos, stale package proofs and revoked resources',async()=>{
 const store=memoryStore(),candidateId='car-cleaning-high-score',sourceUrl='https://www.tiktok.com/@car_cleaning57/video/7696453131495853344';
 await store.create('trend_videos',{id:candidateId,tenantId:'tenant-1',title:'Car cleaning foam',sourceUrl,aiAnalysis:JSON.stringify({analysisRunId:'exact-1'})});
 const scope=await store.create<any>('social_discovery_scopes',{id:'scope-1',tenant_id:'tenant-1',version:2,payload:{keywordSet:{scope:{productRef:'洁面泡沫 8809987654327'}}}});
 await store.create('tenant_profiles',{tenant_id:'tenant-1',profile:{products:{items:[{name:'洁面泡沫 8809987654327'},{name:'水龙头泡棉包装'}]}}});
 const context={tenantId:'tenant-1',candidateId,programId:'program-1',packageId:'package-1',packageVersion:1,recordHash:'context-1',keyword:{scopeId:'scope-1',scopeVersion:2,scopeHash:socialRequestHash(scope)},productFacts:[{ref:{type:'enterprise_fact',id:'cleansing-foam',version:24},statement:'洁面泡沫 8809987654327'}],observations:[{shotIndex:1,observedFacts:'车身清洁泡沫',visual:'汽车清洁'}]};
 const semantic={tenantId:'tenant-1',candidateId,contextHash:'context-1',assessmentId:'semantic-1',dimensions:{relevance:{state:'assessed',value:.95,evidence:[{factRef:'enterprise_fact:cleansing-foam@24',shotIndex:1,quote:'车身清洁泡沫',reason:'误把同词当同产品'}]}}};
 const transfer={tenantId:'tenant-1',candidateId,contextHash:'context-1',semanticAssessmentId:'semantic-1',state:'assessed'};
 const handoff={inspirationId:candidateId,readiness:'production_reference',analysisId:'exact-1',version:'1',source:{sourceUrl},rights:{mayAnalyze:true,mayAdapt:true,mayUseOriginalMedia:false}};
 const base={store,tenantId:'tenant-1',programId:'program-1',packageId:'package-1',packageVersion:1,candidateId,handoffs:[{id:'handoff-1',tenant_id:'tenant-1',record_hash:socialRequestHash(handoff),payload:handoff}] as Record_[]};
 let resourceAlive=true;
 const readers={media:async()=>true,context:async()=>context,semantic:async()=>semantic,transferability:async()=>resourceAlive?transfer:null} as any;
 await assert.rejects(assertWeeklyDirectorQualifiedAdmission({...base,readers:{...readers,semantic:async()=>({...semantic,dimensions:{relevance:{...semantic.dimensions.relevance,value:.2}}})}}),/本轮候选尚无/,'a misleading high discovery score cannot override low product relevance');
 await assert.rejects(assertWeeklyDirectorQualifiedAdmission({...base,readers:{...readers,context:async()=>({...context,productFacts:[{ref:{type:'enterprise_fact',id:'faucet-foam',version:24},statement:'水龙头泡棉包装'}]}),semantic:async()=>({...semantic,dimensions:{relevance:{...semantic.dimensions.relevance,evidence:[{factRef:'enterprise_fact:faucet-foam@24',shotIndex:1,quote:'车身清洁泡沫',reason:'错误产品也被打高分'}]}}})}}),/本轮候选尚无/,'even a high semantic score for a different product cannot replace the selected product');
 await assert.rejects(assertWeeklyDirectorQualifiedAdmission({...base,readers:{...readers,semantic:async()=>({...semantic,dimensions:{relevance:{...semantic.dimensions.relevance,evidence:[{factRef:'enterprise_fact:faucet-foam@24',shotIndex:1,quote:'车身清洁泡沫',reason:'错产品'}]}}})}}),/本轮候选尚无/,'faucet packing foam cannot supply current cleansing-product fact evidence');
 await assert.rejects(assertWeeklyDirectorQualifiedAdmission({...base,packageVersion:2,readers}),/本轮候选尚无/,'the prior weekly package proof cannot pass a revision');
 await assert.doesNotReject(assertWeeklyDirectorQualifiedAdmission({...base,readers}));
 resourceAlive=false;
 await assert.rejects(assertWeeklyDirectorQualifiedAdmission({...base,readers}),/本轮候选尚无/,'a previously checked target resource may be revoked before director freeze');
 await assert.rejects(assertWeeklyDirectorQualifiedAdmission({...base,handoffs:[{...base.handoffs[0]!,payload:{...handoff,analysisId:'old-exact'}}],readers}),/本轮候选尚无/,'the handoff must bind the actual exact-video operation');
});

test('weekly accepted videos from four platforms link to watching accounts without false business confirmation', async () => {
 const dataStore=memoryStore();
 const weekly=pkg();
 const first=weekly.socialContentPackage.publicationTasks[0]!;
 weekly.socialContentPackage.publicationTasks=Array.from({length:5},(_,i)=>({...first,publicationTaskId:`publication-${i}`,motherContentId:`mother-${i}`}));
 weekly.socialContentPackage.originalContentTarget=5;
 weekly.socialContentPackage.publicationTaskTarget=5;
 await dataStore.create('social_discovery_scopes',{tenant_id:'tenant-1',program_id:'program-1',status:'active',keyword_set_id:'set',version:1,payload:{approval:{status:'approved',scopeVersion:1},keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}}}});
 const candidateIds=Array.from({length:5},(_,i)=>`observed-video-${i}`);
 const sources=[
  {platform:'tiktok',account:'https://www.tiktok.com/@oem_factory',url:'https://www.tiktok.com/@oem_factory/video/7656562868334136589'},
  {platform:'facebook',account:'https://www.facebook.com/oem_factory',url:'https://www.facebook.com/reel/7656562868334136589'},
  {platform:'instagram',account:'https://www.instagram.com/oem_factory',url:'https://www.instagram.com/reel/OemFactory1'},
  {platform:'youtube',account:'https://www.youtube.com/@oem_factory',url:'https://www.youtube.com/shorts/OemFactory1'},
  {platform:'tiktok',account:'https://www.tiktok.com/@oem_factory',url:'https://www.tiktok.com/@oem_factory/video/7656562868334136590'},
 ] as const;
 for(const [i,candidateId] of candidateIds.entries()){
  const source=sources[i]!,sourceUrl=source.url;
  await dataStore.create('trend_videos',{id:candidateId,tenantId:'tenant-1',platform:source.platform,title:`OEM factory ${i}`,sourceUrl,aiAnalysis:JSON.stringify({sourceAccount:source.account,sourceAccountEvidence:'provider_metadata'})});
  await dataStore.create('social_candidate_evidence',{tenant_id:'tenant-1',evidenceId:`evidence-${candidateId}`,version:1,tenantId:'tenant-1',candidateId,inputFingerprint:candidateId,evidence:{inspirationId:candidateId,discoveryPath:['keyword'],sceneIds:[],relevance:{level:'high',reasons:[]},momentum:{level:'high_performance',reasons:[],confidence:.8},transferability:{level:'high',mechanisms:['demo'],limitations:[]},evidenceRefs:['source'],qualityScore:{ruleVersion:'discovery-score-v1',overall:90,dimensions:{relevance:90,transferability:90,momentum:75,evidence:80,platformPriority:90,businessModelFit:100},decision:'accepted',reasons:['B2B'],blockers:[],scoredAt:'2026-10-01T00:00:00Z'},classification:{businessModel:'b2b',platform:source.platform,keywordTier:'medium'}},g1:{sourceUrl},completeness:'complete',createdAt:'2026-10-01T00:00:00Z',supersedesEvidenceId:null});
 }
 assert.equal(await linkObservedWeeklyAccounts(dataStore,'tenant-1',candidateIds),5);
 assert.equal(await linkObservedWeeklyAccounts(dataStore,'tenant-1',candidateIds),5,'recovery replay is idempotent');
 const accounts=await dataStore.list<any>('social_tracked_accounts');
 assert.equal(accounts.totalItems,4);
 assert.ok(accounts.items.every(item=>item.status==='watching'&&item.businessConfirmation===undefined));
 assert.deepEqual(new Set(accounts.items.flatMap(item=>item.evidenceVideoIds)),new Set(candidateIds));
 const service=createWeeklyPlanningAuthority(dataStore);
 const outline=await service.initialize('tenant-1',weekly);
 const analyzed=await service.runDirectorAnalysis({tenantId:'tenant-1',programId:'program-1',packageId:weekly.packageId,packageVersion:1,expectedPlanningVersion:outline.version,actor:'director_agent'});
 assert.deepEqual(new Set(analyzed.directorAnalyses.map(item=>item.benchmarkVideoRefs[0]?.id)),new Set(candidateIds));
});

function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const existing = rows.get(collection) ?? [];
      if (data.id && existing.some(row => row.id === data.id)) return null;
      if (collection === DURABLE_OPERATION_LEASE_COLLECTION && existing.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_; rows.set(collection, [...(rows.get(collection) ?? []), row]); return structuredClone(row) as T; },
    async update(collection: string, id: string, data: Record<string, unknown>) { const list = rows.get(collection) ?? []; const index = list.findIndex(row => row.id === id); if (index < 0) return false; list[index] = { ...list[index], ...structuredClone(data) }; return true; },
    async delete(collection: string, id: string) { const list = rows.get(collection) ?? []; rows.set(collection, list.filter(row => row.id !== id)); return true; },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let list = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      if (query.sort) { const desc = query.sort.startsWith('-'); const field = desc ? query.sort.slice(1) : query.sort; list = [...list].sort((a, b) => (Number(a[field]) - Number(b[field])) * (desc ? -1 : 1)); }
      const page = query.page ?? 1; const perPage = query.perPage ?? 100;
      return { items: structuredClone(list.slice((page - 1) * perPage, page * perPage)) as T[], totalItems: list.length, totalPages: Math.max(1, Math.ceil(list.length / perPage)), page, perPage };
    },
  };
}

function pkg(): WeeklyOperatingPackage {
  const publication = {
    publicationTaskId: 'publication-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null,
    platform: 'tiktok' as const, accountId: 'owned-account-1', accountPositioning: 'B2B factory', businessProposition: 'OEM proof', cta: 'Contact sales',
    factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }], metricTargets: ['qualified_inquiry'], publishWindow: '2026-10-08T10:00:00Z', status: 'planned' as const,
  };
  return {
    packageId: 'package-1', programId: 'program-1', version: 1, status: 'draft', weekStart: '2026-10-05', weekEnd: '2026-10-11', objective: '获得 B2B 询盘',
    enterpriseProfileRef: null, monthlyPlanRef: null, workflows: [], workflowTasks: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [],
    capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: 10,
    socialContentPackage: {
      contentPackageId: 'content-package-1', operatingPackageId: 'package-1', version: 1, status: 'draft', originalContentTarget: 1, adaptationVersionTarget: 0,
      publicationTaskTarget: 1, publicationTasks: [publication], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [],
      authorization: { mode: 'bounded', accountIds: ['owned-account-1'], maxPublishItems: 1, weekStart: '2026-10-05', weekEnd: '2026-10-11', allowRealPublishing: false, authorizedBy: null, authorizedAt: null, revokedBy: null, revokedAt: null },
    },
    successCriteria: ['1 条完成'], changeReason: null, previousVersion: null, createdBy: 'owner', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
}

test('automatic director API cannot fall back to historical candidates or an arbitrary eligible ID list',async()=>{
 const store=memoryStore(),weekly=pkg(),planner=createWeeklyPlanningAuthority(store);
 weekly.version=7;weekly.previousVersion=6;
 const first=weekly.socialContentPackage.publicationTasks[0]!;
 weekly.socialContentPackage.publicationTasks=Array.from({length:5},(_,i)=>({...first,publicationTaskId:`publication-${i}`,motherContentId:`mother-${i}`}));
 weekly.socialContentPackage.originalContentTarget=5;weekly.socialContentPackage.publicationTaskTarget=5;
 weekly.referenceSourcePolicy={profile:'b2b_established',ownedPercent:40,externalPercent:60,allocationUnit:'mother_content'};
 await store.create('social_weekly_template_adoptions',{tenant_id:'tenant-1',program_id:'program-1',package_id:weekly.packageId,package_version:6,payload:{source:'automatic_template'}});
 await store.create('social_discovery_scopes',{tenant_id:'tenant-1',program_id:'program-1',status:'active',keyword_set_id:'set',version:1,payload:{approval:{status:'approved',scopeVersion:1},keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}}}});
 await store.create('social_candidate_evidence',{tenant_id:'tenant-1',evidenceId:'old',version:1,tenantId:'tenant-1',candidateId:'old',inputFingerprint:'old',evidence:{inspirationId:'old',qualityScore:{ruleVersion:'v1',overall:99,dimensions:{relevance:99,transferability:99,momentum:99,evidence:99,platformPriority:99,businessModelFit:99},decision:'accepted',reasons:[],blockers:[],scoredAt:'2026-10-01T00:00:00Z'},classification:{businessModel:'b2b',platform:'tiktok'}},g1:{sourceUrl:'https://www.tiktok.com/@old/video/1'},completeness:'complete'});
 await store.create('trend_videos',{id:'old',tenantId:'tenant-1',platform:'tiktok',title:'historical high score',sourceUrl:'https://www.tiktok.com/@old/video/1'});
 const outline=await planner.initialize('tenant-1',weekly),scope={tenantId:'tenant-1',programId:'program-1',packageId:weekly.packageId,packageVersion:7,expectedPlanningVersion:outline.version,actor:'director_agent' as const};
 for(const input of [{}, {eligibleVideoIds:['old']}, {eligibleVideoIds:['old'],discoveryAuthority:{rootJobId:'missing',currentJobId:'missing',runId:'missing'}}, {eligibleVideoIds:['old'],discoveryAuthority:{rootJobId:'another-package-job',currentJobId:'another-package-job',runId:'another-week-run'}}]){
  await assert.rejects(planner.runDirectorAnalysis({...scope,...input}),e=>e instanceof SocialProgramError&&e.code==='weekly_director_discovery_authority_required');
 }
 const owned=outline.skeleton.slots.find(slot=>slot.referenceSource==='owned');
 assert.ok(owned);
 await assert.rejects(planner.runDirectorAnalysis({...scope,selectedSlotIds:[owned.slotId]}),e=>e instanceof SocialProgramError&&e.code==='weekly_director_discovery_authority_required','partial owned-only reanalysis cannot preserve historical external references');
 await assert.rejects(planner.runDirectorAnalysis({...scope,selectedSlotIds:[owned.slotId],eligibleVideoIds:['old'],discoveryAuthority:{rootJobId:'missing',currentJobId:'missing',runId:'missing'}}),e=>e instanceof SocialProgramError&&e.code==='weekly_director_full_external_reanalysis_required','even a supplied authority cannot leave external slots unvalidated');
 assert.equal((await planner.get('tenant-1','program-1',weekly.packageId,7)).version,outline.version,'rejected API calls never append analysis');
});

test('five mother-content slots select five distinct scored references and hold shortages as director gaps',async()=>{
 const dataStore=memoryStore(),service=createWeeklyPlanningAuthority(dataStore),weekly=pkg();
 const first=weekly.socialContentPackage.publicationTasks[0]!;
 weekly.socialContentPackage.publicationTasks=Array.from({length:5},(_,index)=>({...first,publicationTaskId:`publication-${index+1}`,motherContentId:`mother-${index+1}`}));
 weekly.socialContentPackage.originalContentTarget=5;weekly.socialContentPackage.publicationTaskTarget=5;
 await dataStore.create('social_discovery_scopes',{tenant_id:'tenant-1',program_id:'program-1',status:'active',keyword_set_id:'set-1',version:1,payload:{approval:{status:'approved',scopeVersion:1},keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}}}});
 await dataStore.create('social_tracked_accounts',{tenant_id:'tenant-1',accountId:'https://www.tiktok.com/@oem_factory',decision:'track',status:'tracked',accountRole:'brand_factory',reasons:['OEM factory wholesale supplier'],evidenceVideoIds:['video-1','video-2','video-3','video-4','video-5'],relatedSceneIds:[],missingEvidence:[],confidence:0.95,businessConfirmation:{status:'confirmed',confirmedBy:'business_agent',decisionRef:'decision-1',reason:null,confirmedAt:'2026-10-01T00:00:00Z'}});
 const seed=async(index:number)=>{
  const id=`video-${index}`;
  await dataStore.create('social_candidate_evidence',{tenant_id:'tenant-1',evidenceId:`evidence-${id}`,version:1,tenantId:'tenant-1',candidateId:id,inputFingerprint:`fp-${id}`,evidence:{inspirationId:id,discoveryPath:['keyword'],sceneIds:[],relevance:{level:'high',reasons:[]},momentum:{level:'high_performance',reasons:[],confidence:0.8},transferability:{level:'high',mechanisms:['demo'],limitations:[]},evidenceRefs:['source'],qualityScore:{ruleVersion:'discovery-score-v1',overall:96-index,dimensions:{relevance:95-index,transferability:90,momentum:75,evidence:80,platformPriority:100,businessModelFit:100},decision:'accepted',reasons:['B2B'],blockers:[],scoredAt:'2026-10-01T00:00:00Z'},classification:{businessModel:'b2b',platform:'tiktok',keywordTier:'medium'}},g1:{sourceUrl:`https://www.tiktok.com/${id}`},completeness:'complete',createdAt:'2026-10-01T00:00:00Z',supersedesEvidenceId:null});
  await dataStore.create('trend_videos',{id,tenantId:'tenant-1',platform:'tiktok',title:`OEM factory ${id}`,sourceUrl:`https://www.tiktok.com/${id}`});
 };
 for(let index=1;index<=3;index++)await seed(index);
 const outline=await service.initialize('tenant-1',weekly);
 const short=await service.runDirectorAnalysis({tenantId:'tenant-1',programId:'program-1',packageId:weekly.packageId,packageVersion:1,expectedPlanningVersion:outline.version,actor:'director_agent'});
 assert.equal(short.directorAnalyses.length,3);assert.equal(short.directorGaps?.length,2);
 assert.equal(new Set(short.directorAnalyses.map(analysis=>analysis.benchmarkVideoRefs[0]?.id)).size,3);
 for(let index=4;index<=5;index++)await seed(index);
 const complete=await service.runDirectorAnalysis({tenantId:'tenant-1',programId:'program-1',packageId:weekly.packageId,packageVersion:1,expectedPlanningVersion:short.version,actor:'director_agent'});
 const chosen=complete.directorAnalyses.map(analysis=>analysis.benchmarkVideoRefs[0]?.id);
 assert.equal(chosen.length,5);assert.equal(new Set(chosen).size,5);assert.equal(complete.directorGaps?.length,0);
 await seed(6);
 const tracked=(await dataStore.list<any>('social_tracked_accounts')).items[0]!;
 await dataStore.update('social_tracked_accounts',tracked.id,{evidenceVideoIds:[...tracked.evidenceVideoIds,'video-6']});
 const template=(await dataStore.list<any>('social_candidate_evidence')).items[0]!;
 for(let index=0;index<101;index++){
  const candidateId=`higher-scored-unrelated-${index}`;
  const {id:_rowId,...copy}=structuredClone(template);
  await dataStore.create('social_candidate_evidence',{...copy,candidateId,evidenceId:`evidence-${candidateId}`,evidence:{...copy.evidence,inspirationId:candidateId,qualityScore:{...copy.evidence.qualityScore,overall:100}},g1:{...copy.g1,sourceUrl:`https://www.tiktok.com/${candidateId}`}});
  await dataStore.create('trend_videos',{id:candidateId,tenantId:'tenant-1',platform:'tiktok',title:candidateId,sourceUrl:`https://www.tiktok.com/${candidateId}`});
 }
 await assert.rejects(service.runDirectorAnalysis({tenantId:'tenant-1',programId:'program-1',packageId:weekly.packageId,packageVersion:1,expectedPlanningVersion:complete.version,actor:'director_agent',eligibleVideoIds:['video-2','video-3','video-4','video-5','video-6']}),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_director_discovery_authority_required','a current-run ID allowlist cannot replace the persisted discovery authority');
 const detailed=await service.mergeDetailedSchedule({tenantId:'tenant-1',programId:'program-1',package:weekly,expectedPlanningVersion:complete.version,actor:'business_agent'});
 const duplicate=structuredClone(detailed);duplicate.directorAnalyses[4]!.benchmarkVideoRefs=structuredClone(duplicate.directorAnalyses[0]!.benchmarkVideoRefs);
 assert.throws(()=>assertWeeklyDetailedCoverage(duplicate),(error:unknown)=>error instanceof SocialProgramError&&error.code==='weekly_unique_benchmark_video_required');
});

test('all four discovery platforms can compete for five distinct mother references', async () => {
 const dataStore=memoryStore(),service=createWeeklyPlanningAuthority(dataStore),weekly=pkg(),first=weekly.socialContentPackage.publicationTasks[0]!;
 weekly.socialContentPackage.publicationTasks=Array.from({length:5},(_,index)=>({...first,publicationTaskId:`publication-${index+1}`,motherContentId:`mother-${index+1}`}));
 weekly.socialContentPackage.originalContentTarget=5;weekly.socialContentPackage.publicationTaskTarget=5;
 await dataStore.create('social_discovery_scopes',{tenant_id:'tenant-1',program_id:'program-1',status:'active',keyword_set_id:'set-1',version:1,payload:{approval:{status:'approved',scopeVersion:1},keywordSet:{scope:{audienceRole:'brand_buyer'},graph:{sceneClusters:[]}}}});
 const sources=[['tiktok','https://www.tiktok.com/@factory','video-tk-1'],['facebook','https://www.facebook.com/factory','video-fb'],['instagram','https://www.instagram.com/factory','video-ig'],['youtube','https://www.youtube.com/@factory','video-yt'],['tiktok','https://www.tiktok.com/@factory','video-tk-2']] as const;
 for(const [platform,accountId,videoId] of sources){
  await dataStore.create('social_candidate_evidence',{tenant_id:'tenant-1',evidenceId:`evidence-${videoId}`,version:1,tenantId:'tenant-1',candidateId:videoId,inputFingerprint:videoId,evidence:{inspirationId:videoId,discoveryPath:['keyword'],sceneIds:[],relevance:{level:'high',reasons:[]},momentum:{level:'high_performance',reasons:[],confidence:.8},transferability:{level:'high',mechanisms:['demo'],limitations:[]},evidenceRefs:['source'],qualityScore:{ruleVersion:'discovery-score-v1',overall:90,dimensions:{relevance:90,transferability:90,momentum:75,evidence:80,platformPriority:90,businessModelFit:100},decision:'accepted',reasons:['B2B'],blockers:[],scoredAt:'2026-10-01T00:00:00Z'},classification:{businessModel:'b2b',platform,keywordTier:'medium'}},g1:{sourceUrl:`${accountId}/${videoId}`},completeness:'complete',createdAt:'2026-10-01T00:00:00Z',supersedesEvidenceId:null});
  await dataStore.create('trend_videos',{id:videoId,tenantId:'tenant-1',platform,title:`OEM factory ${videoId}`,sourceUrl:`${accountId}/${videoId}`});
 }
 for(const [,accountId] of sources.filter((source,index,all)=>all.findIndex(item=>item[1]===source[1])===index)){
  const videoIds=sources.filter(source=>source[1]===accountId).map(source=>source[2]);
  await dataStore.create('social_tracked_accounts',{tenant_id:'tenant-1',accountId,decision:'track',status:'tracked',accountRole:'brand_factory',reasons:['OEM factory supplier'],evidenceVideoIds:[...videoIds,'other-1','other-2'],relatedSceneIds:[],missingEvidence:[],confidence:.95,businessConfirmation:{status:'confirmed',confirmedBy:'business_agent',decisionRef:'decision',reason:null,confirmedAt:'2026-10-01T00:00:00Z'}});
 }
 const outline=await service.initialize('tenant-1',weekly),analysis=await service.runDirectorAnalysis({tenantId:'tenant-1',programId:'program-1',packageId:weekly.packageId,packageVersion:1,expectedPlanningVersion:outline.version,actor:'director_agent'});
 assert.deepEqual(new Set(analysis.directorAnalyses.map(item=>item.benchmarkVideoRefs[0]?.id)),new Set(sources.map(item=>item[2])));
 assert.equal(analysis.directorGaps?.length,0);
});

test('business outline → director evidence → business schedule → user confirmation → business dispatch keeps authority boundaries', async () => {
  const dataStore = memoryStore();
  const service = createWeeklyPlanningAuthority(dataStore);
  await dataStore.create('social_discovery_scopes', {
    tenant_id: 'tenant-1', program_id: 'program-1', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await dataStore.create('social_candidate_evidence', {
    tenant_id: 'tenant-1', evidenceId: 'evidence-video-1', version: 1, tenantId: 'tenant-1', candidateId: 'video-1', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'video-1', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/video-1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await dataStore.create('trend_videos', { id: 'video-1', tenantId: 'tenant-1', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/video-1' });
  await dataStore.create('social_tracked_accounts', {
    tenant_id: 'tenant-1', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['video-1', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });
  const outline = await service.initialize('tenant-1', pkg());
  assert.equal(outline.skeleton.generatedBy, 'business_agent');
  assert.equal(outline.skeleton.tokenCost, 0);
  const analyzed = await service.runDirectorAnalysis({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: outline.version, actor: 'director_agent' });
  assert.equal(analyzed.directorAnalyses[0]?.analyzedBy, 'director_agent');
  assert.equal(analyzed.directorAnalyses[0]?.benchmarkVideoRefs[0]?.id, 'video-1');
  const tracked = (await dataStore.list<any>('social_tracked_accounts')).items[0]!;
  await dataStore.update('social_tracked_accounts', tracked.id, { evidenceVideoIds: ['unrelated-1', 'unrelated-2', 'unrelated-3'] });
  await assert.rejects(service.runDirectorAnalysis({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: analyzed.version, actor: 'director_agent' }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'benchmark_account_video_link_required');
  assert.deepEqual(await service.get('tenant-1', 'program-1', 'package-1', 1), analyzed, 'missing linkage must not append a fabricated analysis');
  await dataStore.update('social_tracked_accounts', tracked.id, { evidenceVideoIds: tracked.evidenceVideoIds });
  await dataStore.create('social_owned_accounts', { tenant_id: 'tenant-1', program_id: 'program-1', payload: { accountId: 'owned-account-1', programId: 'program-1', platform: 'tiktok', displayName: '我的工厂', version: 3 } });
  const ownPkg = { ...pkg(), packageId: 'own-week', referenceSourcePolicy: { profile: 'b2b_established' as const, ownedPercent: 100, externalPercent: 0, allocationUnit: 'mother_content' as const } };
  const ownOutline = await service.initialize('tenant-1', ownPkg);
  const ownInput = { tenantId: 'tenant-1', programId: 'program-1', packageId: ownPkg.packageId, packageVersion: 1, expectedPlanningVersion: ownOutline.version, actor: 'director_agent' as const };
  await assert.rejects(service.runDirectorAnalysis(ownInput), (error: unknown) => error instanceof SocialProgramError && error.code === 'owned_reference_evidence_required');
  await dataStore.create('social_external_contents', { tenant_id: 'tenant-1', account_id: 'owned-account-1', channel_id: 'tiktok', external_content_id: 'provider-video-1', content: { tenantId: 'tenant-1', accountId: 'owned-account-1', channelId: 'tiktok', externalContentId: 'provider-video-1', status: 'published', publicUrl: 'https://www.tiktok.com/video-1' } });
  const metric = { snapshotId: 'snapshot-own', tenantId: 'tenant-1', accountId: 'owned-account-1', channelId: 'tiktok', externalContentId: 'provider-video-1', capturedAt: '2026-10-02T00:00:00Z', source: 'official_api', metrics: { views: 1200, likes: 0, shares: null, comments: 4 } };
  const metricRow = { tenant_id: 'tenant-1', account_id: metric.accountId, channel_id: metric.channelId, external_content_id: metric.externalContentId };
  await dataStore.create('social_channel_metric_snapshots', { ...metricRow, snapshot_id: metric.snapshotId, snapshot: metric });
  await dataStore.create('social_channel_metric_snapshots', { ...metricRow, snapshot_id: 'wrong-tenant', snapshot: { ...metric, snapshotId: 'wrong-tenant', tenantId: 'tenant-other', capturedAt: '2026-10-03T00:00:00Z', metrics: { views: 99999 } } });
  await dataStore.create('social_channel_metric_snapshots', { ...metricRow, snapshot_id: 'future', snapshot: { ...metric, snapshotId: 'future', capturedAt: '2099-10-03T00:00:00Z', metrics: { views: 99999 } } });
  for (let index = 0; index < 501; index++) await dataStore.create('social_channel_metric_snapshots', { ...metricRow, external_content_id: 'other-video', snapshot_id: `unrelated-${index}`, snapshot: { ...metric, snapshotId: `unrelated-${index}`, externalContentId: 'other-video' } });
  await dataStore.create('social_channel_metric_snapshots', { ...metricRow, snapshot_id: 'snapshot-latest', snapshot: { ...metric, snapshotId: 'snapshot-latest', capturedAt: '2026-10-04T00:00:00Z' } });
  const ownAnalysis = await service.runDirectorAnalysis(ownInput);
  assert.deepEqual(ownAnalysis.directorAnalyses[0]?.benchmarkAccountRefs, [{ type: 'owned_social_account', id: 'owned-account-1', version: 3 }]);
  assert.match(ownAnalysis.directorAnalyses[0]!.contentDirection, /本账号/);
  assert.deepEqual(ownAnalysis.directorAnalyses[0]?.historicalPerformance?.metrics, { views: 1200, likes: 0, shares: null, comments: 4 });
  assert.equal(ownAnalysis.directorAnalyses[0]?.historicalPerformance?.snapshotRef.id, 'snapshot-latest');
  assert.equal(ownAnalysis.directorAnalyses[0]?.ownedReferenceDiagnosis?.performanceStatus, 'partial');
  assert.deepEqual(ownAnalysis.directorAnalyses[0]?.ownedReferenceDiagnosis?.missingMetrics, ['shares']);
  assert.equal(ownAnalysis.directorAnalyses[0]?.ownedReferenceDiagnosis?.toneStatus, 'pending');
  const coldPkg = { ...pkg(), packageId: 'cold-check', referenceSourcePolicy: { profile: 'b2b_cold_start' as const, ownedPercent: 0, externalPercent: 100, allocationUnit: 'mother_content' as const } };
  const cold = await service.initialize('tenant-1', coldPkg);
  await assert.rejects(service.runDirectorAnalysis({ ...ownInput, packageId: coldPkg.packageId, expectedPlanningVersion: cold.version }), (error: unknown) => error instanceof SocialProgramError && error.code === 'benchmark_account_video_link_required');
  const merged = await service.mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: analyzed.version, actor: 'business_agent' });
  assert.equal(merged.detailedSchedule?.mergedBy, 'business_agent');
  assert.equal(merged.detailedSchedule?.items[0]?.qualityTier, 'premium');
  assert.equal(merged.detailedSchedule?.items[0]?.materialPlan.canStartWithExistingAssets, false, 'planning cannot certify uninspected assets');
  assert.deepEqual(merged.detailedSchedule?.items[0]?.materialPlan.optionalShootTaskIds, [], 'uncreated shooting tasks must not acquire fabricated IDs');
  await assert.rejects(
    service.dispatch({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: merged.version, actor: 'business_agent' }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'confirmed_detailed_schedule_required',
  );
  const confirmed = await service.confirm({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: merged.version, userId: 'owner' });
  const assertFrozen = async (state: typeof confirmed) => {
    await assert.rejects(service.mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: state.version, actor: 'business_agent' }),
      (error: unknown) => error instanceof SocialProgramError && error.status === 409 && error.code === 'weekly_agent_plan_already_confirmed');
    await assert.rejects(service.runDirectorAnalysis({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: state.version, actor: 'director_agent' }),
      (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_plan_already_confirmed');
    const repeated = await service.confirm({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: state.version, userId: 'other-user' });
    assert.deepEqual(repeated, state, 'reconfirmation preserves the original approval and history');
    assert.deepEqual(await service.get('tenant-1', 'program-1', 'package-1', 1), state);
  };
  await assertFrozen(confirmed);
  const dispatched = await service.dispatch({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: confirmed.version, actor: 'business_agent' });
  assert.equal(dispatched.dispatch?.issuedBy, 'business_agent');
  assert.equal(dispatched.dispatch?.assignedTo, 'content_agent');
  assert.deepEqual(dispatched.dispatch?.scheduleItems[0]?.materialEvidenceRequirements, merged.detailedSchedule?.items[0]?.materialEvidenceRequirements);
  assert.equal(dispatched.dispatch?.scheduleItems[0]?.materialEvidenceRequirements?.items[0]?.classification, 'unknown');
  assert.equal(dispatched.dispatch?.scheduleItems[0]?.materialEvidenceRequirements?.scope.packageVersion, 1);
  assert.ok(dispatched.dispatch?.detailedScheduleRef.id);
  await assertFrozen(dispatched);
});

async function preparedPlanning(dataStore: DataStore) {
  const authority = createWeeklyPlanningAuthority(dataStore);
  const outline = await authority.initialize('tenant-1', pkg());
  const slot = outline.skeleton.slots[0]!;
  const state = { ...outline, version: 2, status: 'director_analyzing', directorAnalyses: [{ analysisId: 'analysis-concurrent', slotId: slot.slotId, packageId: outline.packageId, packageVersion: 1, analyzedBy: 'director_agent', benchmarkAccountRefs: [{type:'social_benchmark_account',id:'account-fixture',version:1}], benchmarkVideoRefs: [{type:'social_discovery_video',id:'video-fixture',version:1}], benchmarkEvidenceRefs: ['evidence-fixture'], contentDirection: 'verified direction', styleRules: [], updateRhythm: 'weekly', materialRequirements: [], estimatedProductionMinutes: 30, createdAt: outline.createdAt }] };
  await dataStore.create('social_weekly_agent_planning', { tenant_id: 'tenant-1', program_id: outline.programId, package_id: outline.packageId, package_version: 1, planning_version: 2, payload: state, created_at: outline.createdAt });
  return state;
}
function assertSingleWinner(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof SocialProgramError);
  assert.equal(failed.reason.code, 'weekly_agent_planning_version_conflict');
}
test('independent authorities serialize merge, confirmation and dispatch without duplicate or lost history', async () => {
  const dataStore = memoryStore(); await preparedPlanning(dataStore);
  const first = createWeeklyPlanningAuthority(dataStore), second = createWeeklyPlanningAuthority(dataStore);
  const merge = { tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' as const };
  assertSingleWinner(await Promise.allSettled([first.mergeDetailedSchedule(merge), second.mergeDetailedSchedule(merge)]));
  const confirm = { tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: 3, userId: 'owner' };
  assertSingleWinner(await Promise.allSettled([first.confirm(confirm), second.confirm(confirm)]));
  const dispatch = { ...confirm, expectedPlanningVersion: 4, actor: 'business_agent' as const };
  assertSingleWinner(await Promise.allSettled([first.dispatch(dispatch), second.dispatch(dispatch)]));
  const history = await dataStore.list<any>('social_weekly_agent_planning', { where: { tenant_id: 'tenant-1' }, sort: 'planning_version' });
  assert.deepEqual(history.items.map(row => row.planning_version), [1, 2, 3, 4, 5]);
  assert.deepEqual(history.items.map(row => row.payload.status), ['outline_ready', 'director_analyzing', 'awaiting_confirmation', 'confirmed', 'dispatched']);
  const dispatched = await first.get('tenant-1', 'program-1', 'package-1', 1);
  assert.equal(dispatched.userConfirmation?.confirmedBy, 'owner');
  assert.equal(dispatched.dispatch?.scheduleItems.length, 1);
  await assert.rejects(first.dispatch(dispatch), (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_planning_version_conflict');
});
test('lost planning lease fences stale append and preserves the prior history', async () => {
  const dataStore = memoryStore(); await preparedPlanning(dataStore);
  let fence = true;
  const fencedStore: DataStore = { ...dataStore, async getById<T>(collection: string, id: string) {
    const row = await dataStore.getById<any>(collection, id);
    if (fence && collection === DURABLE_OPERATION_LEASE_COLLECTION && row) { fence = false; return { ...row, lease_token: 'successor-token' } as T; }
    return row as T | null;
  } };
  await assert.rejects(createWeeklyPlanningAuthority(fencedStore).mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' }), (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_planning_lease_lost');
  assert.deepEqual((await dataStore.list<any>('social_weekly_agent_planning', { sort: 'planning_version' })).items.map(row => row.planning_version), [1, 2]);
  const recovered = await createWeeklyPlanningAuthority(dataStore).mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' });
  assert.equal(recovered.version, 3);
});
test('concurrent initialization creates one immutable outline', async () => {
  const dataStore = memoryStore();
  const results = await Promise.allSettled([createWeeklyPlanningAuthority(dataStore).initialize('tenant-1', pkg()), createWeeklyPlanningAuthority(dataStore).initialize('tenant-1', pkg())]);
  assertSingleWinner(results);
  assert.equal((await dataStore.list('social_weekly_agent_planning')).totalItems, 1);
  assert.equal((await createWeeklyPlanningAuthority(dataStore).initialize('tenant-1', pkg())).version, 1);
});
test('create-only version identity fences a delayed stale write after a successor commits', async () => {
  const dataStore = memoryStore(); await preparedPlanning(dataStore);
  let signalStarted!: () => void, releaseWrite!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const resume = new Promise<void>(resolve => { releaseWrite = resolve; });
  let delayFirst = true;
  const staleStore: DataStore = { ...dataStore, async create<T>(collection: string, data: Record<string, unknown>) {
    if (collection === 'social_weekly_agent_planning' && data.planning_version === 3 && delayFirst) {
      delayFirst = false; signalStarted(); await resume;
    }
    return dataStore.create<T>(collection, data);
  } };
  const input = { tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' as const };
  const stale = createWeeklyPlanningAuthority(staleStore).mergeDetailedSchedule(input);
  // Attach rejection handling before allowing the first operation to finish.
  const rejected = assert.rejects(stale, (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_planning_version_conflict');
  await started;
  const lease = (await dataStore.list<any>(DURABLE_OPERATION_LEASE_COLLECTION)).items[0];
  await dataStore.delete(DURABLE_OPERATION_LEASE_COLLECTION, lease.id);
  const winner = await createWeeklyPlanningAuthority(dataStore).mergeDetailedSchedule({ ...input, now: new Date('2026-10-07T09:00:00Z') });
  releaseWrite(); await rejected;
  const history = await dataStore.list<any>('social_weekly_agent_planning', { sort: 'planning_version' });
  assert.deepEqual(history.items.map(row => row.planning_version), [1, 2, 3]);
  assert.deepEqual(history.items.at(-1).payload, winner, 'delayed stale creator cannot overwrite the successor history');
});

test('stored unknown material configuration is read by actual director reanalysis and frozen into schedule',async()=>{
  const dataStore = memoryStore();
  const service = createWeeklyPlanningAuthority(dataStore);
  await dataStore.create('social_discovery_scopes', {
    tenant_id: 'tenant-1', program_id: 'program-1', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await dataStore.create('social_candidate_evidence', {
    tenant_id: 'tenant-1', evidenceId: 'evidence-video-1', version: 1, tenantId: 'tenant-1', candidateId: 'video-1', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'video-1', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/video-1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await dataStore.create('trend_videos', { id: 'video-1', tenantId: 'tenant-1', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/video-1' });
  await dataStore.create('social_tracked_accounts', {
    tenant_id: 'tenant-1', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['video-1', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });

 const {socialRequestHash}=await import('../starter198/socialContentValidation.js');const {saveMaterialEvidenceConfiguration}=await import('./materialEvidenceConfiguration.js');
 const handoff:any={inspirationId:'video-1',version:'1',analysisVersion:'1',readiness:'production_reference',source:{sourceUrl:'https://www.tiktok.com/video-1'},rights:{mayAnalyze:true,mayAdapt:true},productionImplications:{requiredEvidence:['产品细节镜头'],likelyAssetNeeds:[]},adaptationBoundary:{reusable:[],mustReplace:[],prohibited:[]}};
 await dataStore.create('starter_social_inspiration_handoff_versions',{tenant_id:'tenant-1',handoff_version:'1',record_hash:socialRequestHash(handoff),payload:handoff});await dataStore.create('users',{id:'operator',tenantId:'tenant-1',role:'social_operator'});
 const outline=await service.initialize('tenant-1',pkg());const input={tenantId:'tenant-1',programId:'program-1',packageId:'package-1',packageVersion:1,expectedPlanningVersion:outline.version,actor:'director_agent' as const};const analyzed=await service.runDirectorAnalysis(input);const requirement=analyzed.directorAnalyses[0]!.materialEvidenceRequirements!;assert.equal(requirement.items[0]!.classification,'unknown');
 const config=await saveMaterialEvidenceConfiguration(dataStore,{tenantId:'tenant-1',programId:'program-1',scope:requirement.scope,actorUserId:'operator',expectedPlanningVersion:analyzed.version,decisions:[{requirementId:requirement.items[0]!.requirementId,classification:'human_irreplaceable',reason:'要求自有真实产品',shotUsage:'第二镜头细节实拍'}]});
 const reanalyzed=await service.runDirectorAnalysis({...input,expectedPlanningVersion:analyzed.version});const next=reanalyzed.directorAnalyses[0]!.materialEvidenceRequirements!;assert.equal(next.items[0]!.classification,'human_irreplaceable');assert.equal(next.configurationRef?.recordHash,config.recordHash);assert.equal(analyzed.directorAnalyses[0]!.materialEvidenceRequirements!.items[0]!.classification,'unknown','old plan immutable');
 const merged=await service.mergeDetailedSchedule({tenantId:'tenant-1',programId:'program-1',package:pkg(),expectedPlanningVersion:reanalyzed.version,actor:'business_agent'});assert.deepEqual(merged.detailedSchedule!.items[0]!.materialEvidenceRequirements,next);
});
