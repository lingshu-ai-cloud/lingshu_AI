import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import ffmpeg from 'ffmpeg-static';
import {buildSocialReferenceReviewHandoff} from '../starter198/socialReferenceReviewHandoff.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';
import {createSocialOperatingDecisionService} from '../socialOperating/service.js';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from './weeklyContentQualityAudit.fixture.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {createSocialWeeklyProductionAdapter} from './socialWeeklyProductionAdapter.js';
import {runSocialWeeklyExecutionScan} from './socialWeeklyExecutionRuntime.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';

export async function prepareWeeklyPlanningProductionFixture(t:TestContext,options:{ownedReferenceBytes?:boolean;tenantId?:string}={}){
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 const tenantId=options.tenantId??'t';
 // Rebind seed identities before planning generates any tenant-scoped hashes.
 if(tenantId!=='t'){const seen=new Set<object>();const bind=(value:unknown):void=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);for(const [key,item] of Object.entries(value)){if(item==='t'&&(key==='tenant_id'||key==='tenantId'))(value as Record<string,unknown>)[key]=tenantId;else bind(item);}};bind(f.tables);bind(f.pkg);bind(f.task);}
 f.tables.social_weekly_agent_planning=[];
 const pkg=f.pkg;pkg.referenceSourcePolicy={profile:'b2b_cold_start',ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'};
 Object.assign(pkg.socialContentPackage,{originalContentTarget:1,adaptationVersionTarget:0,publicationTaskTarget:1});
 Object.assign(pkg.socialContentPackage.publicationTasks[0]!,{motherContentId:'new-mother',adaptationOfPublicationTaskId:null,accountPositioning:'B2B采购产品说明',publishWindow:'2026-10-08T10:00:00Z'});
  await f.store.create('social_discovery_scopes', {
    tenant_id: tenantId, program_id: 'p', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await f.store.create('social_candidate_evidence', {
    tenant_id: tenantId, evidenceId: 'evidence-decorative-reference', version: 1, tenantId: tenantId, candidateId: 'decorative-reference', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'decorative-reference', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/@fixture/video/1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await f.store.create('trend_videos', { id: 'decorative-reference', tenantId: tenantId, platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/@fixture/video/1',duration:6,aiAnalysis:JSON.stringify({analysisMode:'exact',analysisQuality:'video',gemini:{scriptDetails15s:[{time:'0-3',purpose:'装饰转场',visual:'纯装饰抽象几何动画，不作企业证据',shot:'图形',camera:'固定',confidence:0.98},{time:'3-6',purpose:'装饰转场',visual:'纯装饰彩色图形动画，不作企业证据',shot:'图形',camera:'固定',confidence:0.98}]}}) });
 if(options.ownedReferenceBytes){assert.ok(ffmpeg);const mediaRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../data/media');const folder=path.join(mediaRoot,'tenants/t/reference-videos');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,'decorative-reference.mp4');await assert.rejects(fs.access(path.join(mediaRoot,'tenants/t/reference-evidence/decorative-reference')),'test must not delete existing owned evidence');await assert.rejects(fs.access(file),'test source must not overwrite an existing owned file');await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x180:rate=10','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-y',file]);t.after(()=>fs.rm(file,{force:true}));t.after(()=>fs.rm(path.join(mediaRoot,'tenants/t/reference-evidence/decorative-reference'),{recursive:true,force:true}));const record=f.tables.trend_videos!.find(row=>row.id==='decorative-reference')!;const original=JSON.parse(String(record.aiAnalysis));record.videoFileId='tenants/t/reference-videos/decorative-reference.mp4';record.aiAnalysis=JSON.stringify({...original,analysisRunId:'actual-local-analysis-run',contentSha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});}
  await f.store.create('social_tracked_accounts', {
    tenant_id: tenantId, accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['decorative-reference', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });
 await f.store.create('social_programs',{tenant_id:tenantId,program_id:'p',payload:{version:1}});
 await f.store.create('social_owned_accounts',{tenant_id:tenantId,program_id:'p',account_id:'account',payload:{version:1,platform:'tiktok'}});
 const goalResult=await createSocialOperatingDecisionService(f.store).buildAndSave({tenantId:tenantId,operator:{type:'user',id:'owner'},input:{programRef:{type:'social_program',id:'p',version:1},enterprise:{ref:{type:'enterprise_profile',id:'profile',version:1},products:['企业产品'],markets:['US'],audiences:['企业采购'],languages:['en'],publicFacts:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>({ref,statement:'已确认的企业产品信息'})),prohibitedClaims:['编造产品性能'],weeklyBudgetCny:10,salesOwnerId:'owner'},accounts:[{ref:{type:'owned_social_account',id:'account',version:1},accountId:'account',platform:'tiktok',role:'核心账号',status:'active',conversionRouteId:'test-contact'}],conversionRoutes:[{ref:{type:'conversion_route',id:'test-contact',version:1},routeId:'test-contact',kind:'website',target:'https://example.test/contact',verified:true}]}});
 assert.equal(goalResult.goal.status,'ready');pkg.businessContentGoalRef={type:'business_content_goal',id:goalResult.goal.goalId,version:goalResult.goal.version};
 const service=createWeeklyPlanningAuthority(f.store);
 const initial=await service.initialize(tenantId,pkg);
 const analysis=await service.runDirectorAnalysis({tenantId:tenantId,programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 assert.equal(analysis.directorAnalyses.length,1);assert.equal(analysis.directorAnalyses[0]!.benchmarkVideoRefs[0]!.id,'decorative-reference');
 const schedule=await service.mergeDetailedSchedule({tenantId:tenantId,programId:'p',package:pkg,expectedPlanningVersion:analysis.version,actor:'business_agent'});
 const confirmation=await service.confirm({tenantId:tenantId,programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:schedule.version,userId:'owner'});
 const dispatched=await service.dispatch({tenantId:tenantId,programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmation.version,actor:'business_agent'});
 assert.equal(dispatched.status,'dispatched');
 // Remove the unrelated already-produced fixture task; production must use actual creation.
 f.tables.starter_social_content_tasks=[];
 const task:WeeklyExecutionTask={...f.task,taskId:'actual-planning-production',workflowKind:'content',status:'queued',schedule:{...f.task.schedule,stepKind:'material_readiness',responsibleActor:'content_agent'},dependsOnTaskIds:[],upstreamVersionRefs:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],attempt:0,lease:null,nextAttemptAt:null,inputSnapshot:{publicationTask:structuredClone(pkg.socialContentPackage.publicationTasks[0])}};
 f.tables.social_weekly_execution_tasks=[{id:task.taskId,tenant_id:tenantId,program_id:'p',package_id:pkg.packageId,package_version:pkg.version,task_id:task.taskId,status:'queued',payload:task}];
 const initialRunCount=f.tables.workflow_runs!.length;
 const report=await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{material_readiness:createSocialWeeklyProductionAdapter(f.store)},maxTasksPerTenant:1});
 const actual=f.tables.social_weekly_execution_tasks[0]!.payload as WeeklyExecutionTask;
 assert.equal(report.claimed,1);assert.ok(['pending','blocked','succeeded'].includes(actual.status),JSON.stringify(actual.lastError));
 assert.equal(f.tables.starter_usage_ledger?.length??0,0,'planning and prerequisite checks must not pay a supplier');
 assert.equal(f.tables.content_execution_jobs?.length??0,0);
 assert.equal(actual.lastError?.code,'reference_person_automatic_analysis_required',JSON.stringify(actual));
 assert.equal(f.tables.starter_social_content_tasks.length,1,'actual default create stores exactly one production identity');
 const created=f.tables.starter_social_content_tasks[0]!;assert.equal(created.create_idempotency_key,`weekly-production:${pkg.packageId}:${pkg.version}:pub`);
 assert.ok(!created.run_id,'actual director review blocks original run creation');assert.equal(f.tables.workflow_runs!.length,initialRunCount);assert.ok(!created.orchestrator_item_id);
 let detail:Awaited<ReturnType<typeof readSocialTaskDetail>>=null;
 await assert.rejects(readSocialTaskDetail({repository:f.repository,tenantId:tenantId,taskId:String(created.task_id)}),/^Error: reference_person_automatic_analysis_required:/,'missing independent person evidence must refuse actual asset planning');
 assert.equal((created.brief as {targetAccountRef:{objectType:string}}).targetAccountRef.objectType,'social_owned_account');
 const adapter=createSocialWeeklyProductionAdapter(f.store);await adapter.execute(actual);assert.equal(f.tables.starter_social_content_tasks.length,1);assert.equal(f.tables.content_execution_jobs?.length??0,0,'missing frozen material proof never claims paid execution completion');
 const referenceReviewHandoff=buildSocialReferenceReviewHandoff({record:f.tables.trend_videos!.find(row=>row.id==='decorative-reference')!,verifiedEnterpriseFactRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>`${ref.type}:${ref.id}@${ref.version}`)});
 return {f,pkg,task,actual,created,report,dispatched,detail,referenceReviewHandoff};
}
