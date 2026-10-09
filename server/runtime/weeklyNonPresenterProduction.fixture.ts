import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import ffmpeg from 'ffmpeg-static';
import {createExactShotMaterializationService} from '../lib/referenceExactShotMaterialization.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {validatePresenterContinuity} from '../lib/referencePresenterContinuity.js';
import {initialReferenceShotReview,updateReferenceShotReview} from '../lib/referenceShotReview.js';
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

export async function prepareWeeklyNonPresenterProductionFixture(t:TestContext,options:{ownedReferenceBytes?:boolean}={ownedReferenceBytes:true}){
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 f.tables.social_weekly_agent_planning=[];
 const pkg=f.pkg;pkg.referenceSourcePolicy={profile:'b2b_cold_start',ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'};
 Object.assign(pkg.socialContentPackage,{originalContentTarget:1,adaptationVersionTarget:0,publicationTaskTarget:1});
 Object.assign(pkg.socialContentPackage.publicationTasks[0]!,{motherContentId:'new-mother',adaptationOfPublicationTaskId:null,accountPositioning:'B2B采购产品说明',publishWindow:'2026-10-08T10:00:00Z'});
  await f.store.create('social_discovery_scopes', {
    tenant_id: 't', program_id: 'p', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await f.store.create('social_candidate_evidence', {
    tenant_id: 't', evidenceId: 'evidence-non-presenter-reference', version: 1, tenantId: 't', candidateId: 'non-presenter-reference', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'non-presenter-reference', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/@fixture/video/1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await f.store.create('trend_videos', { id: 'non-presenter-reference', tenantId: 't', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/@fixture/video/1',duration:6,aiAnalysis:JSON.stringify({analysisMode:'exact',analysisQuality:'video',gemini:{scriptDetails15s:[{time:'0-3',purpose:'装饰转场',visual:'纯装饰抽象几何动画，不作企业证据',shot:'图形',camera:'固定',confidence:0.98},{time:'3-6',purpose:'装饰转场',visual:'纯装饰彩色图形动画，不作企业证据',shot:'图形',camera:'固定',confidence:0.98}]}}) });
 if(options.ownedReferenceBytes){assert.ok(ffmpeg);const mediaRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../data/media');const folder=path.join(mediaRoot,'tenants/t/reference-videos');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,'non-presenter-reference.mp4');await assert.rejects(fs.access(path.join(mediaRoot,'tenants/t/reference-evidence/non-presenter-reference')),'test must not delete existing owned evidence');await assert.rejects(fs.access(file),'test source must not overwrite an existing owned file');const spoken=path.join(folder,'non-presenter-reference.aiff');await assert.rejects(fs.access(spoken));await promisify(execFile)('/usr/bin/say',['-o',spoken,'Hello.']);t.after(()=>fs.rm(spoken,{force:true}));await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x180:rate=10','-i',spoken,'-af','apad','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',file]);t.after(()=>fs.rm(file,{force:true}));t.after(()=>fs.rm(path.join(mediaRoot,'tenants/t/reference-evidence/non-presenter-reference'),{recursive:true,force:true}));const record=f.tables.trend_videos!.find(row=>row.id==='non-presenter-reference')!;const original=JSON.parse(String(record.aiAnalysis));record.videoFileId='tenants/t/reference-videos/non-presenter-reference.mp4';record.aiAnalysis=JSON.stringify({...original,analysisRunId:'actual-local-analysis-run',contentSha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});}
 // Controlled provider-contract output is frozen before actual planning. No live model proof.
 const reference=f.tables.trend_videos!.find(row=>row.id==='non-presenter-reference')!;
 const observed=JSON.parse(String(reference.aiAnalysis));
 observed.durationSeconds=6;
 observed.gemini.scriptDetails15s=observed.gemini.scriptDetails15s.map((shot:Record<string,unknown>,index:number)=>({...shot,
  observedFacts:'原片图形动画',bgm:'人工核对原片无配乐',voiceover:'Hello.',soundEffects:['人工核对原片无音效'],dialogue:'',beats:[{action:'原片图形连续运动'}],
  criticalShot:{classification:'critical',primaryHook:index===0,uniqueVisualMechanism:true,explicitAudioVisualSync:false,confidence:.95,reason:'controlled source provider contract',evidence:['实际原片图形'],model:'controlled-local-contract',provenance:'controlled-source-frames',actionEvents:[],syncPoints:[]}}));
 const frameRows=observed.gemini.scriptDetails15s.flatMap((_shot:unknown,index:number)=>[{shotId:`shot-${index+1}`,seconds:index*3+.1,base64:'controlled-contract-frame',mimeType:'image/jpeg'},{shotId:`shot-${index+1}`,seconds:index*3+1,base64:'controlled-contract-frame',mimeType:'image/jpeg'}]);
 for(const frame of frameRows){const filename=path.resolve('data/media/tenants/t/reference-videos',`actual-frame-${frame.shotId}-${frame.seconds}.jpg`);await assert.rejects(fs.access(filename));await promisify(execFile)(ffmpeg!,['-hide_banner','-loglevel','error','-ss',String(frame.seconds),'-i',path.resolve('data/media',String(reference.videoFileId)),'-frames:v','1','-y',filename]);frame.base64=(await fs.readFile(filename)).toString('base64');await fs.rm(filename);}
 observed.gemini.scriptDetails15s=validatePresenterContinuity({analysis:observed.gemini,frames:frameRows,sourceSha256:observed.contentSha256,videoId:'non-presenter-reference'}, {shots:[1,2].map((n)=>({shotId:`shot-${n}`,visibility:'no_person',personContinuityId:'',confidence:.95,evidence:['受控原片provider契约：图形动画无人'],frameSeconds:[(n-1)*3+.1,(n-1)*3+1]}))},'controlled-source-model');
 reference.aiAnalysis=JSON.stringify(observed);
 const materializer=createExactShotMaterializationService(f.store);const materialScope={tenantId:'t',recordId:'non-presenter-reference',expectedSourceSha256:observed.contentSha256,expectedAnalysisRunId:observed.analysisRunId,expectedAnalysisHash:socialRequestHash(observed)};await materializer.materialize(materialScope);const materialAnalysis=await materializer.readVerifiedAnalysis(materialScope);assert.ok(materialAnalysis);const reviewedRecord={...reference,aiAnalysis:materialAnalysis};
 const initialReview=initialReferenceShotReview(reviewedRecord);
 const hooks={camera:'原片固定镜头',visual:'原片图形运动',subject:'原片图形',music:'人工核对无配乐',voiceover:'Hello.',soundEffects:'人工核对无音效',spokenWords:'人工核对无口播',subjectAction:'原片图形连续移动'};
 reference.referenceShotReview=JSON.stringify(updateReferenceShotReview(reviewedRecord,{expectedVersion:initialReview.version,sections:initialReview.sections.map((section,index)=>({...section,start:index,end:index+1,confirmed:true})),shots:initialReview.shots.map((shot,index)=>({...shot,reviewStatus:'confirmed',labels:['图形'],content:'原片图形连续移动',purpose:'装饰表达',hookAction:'原片图形从左侧进入画面，随后持续移动到中央位置，不含人物动作。',hookMotionConfirmed:index===0,hookScript:hooks,hookScriptConfirmed:index===0})),selectedHookShotId:'shot-1'}));
 reference.referenceVerifiedSpeech={schemaVersion:1,analysisRunId:observed.analysisRunId,sourceSha256:observed.contentSha256,coverageConfirmed:true,reviewerId:'owner',verifiedAt:'2026-10-01T00:00:00Z',lines:[{start:.1,end:1.5,text:'Hello.',visibility:'voiceover'}]};
  await f.store.create('social_tracked_accounts', {
    tenant_id: 't', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['non-presenter-reference', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });
 await f.store.create('social_programs',{tenant_id:'t',program_id:'p',payload:{version:1}});
 await f.store.create('social_owned_accounts',{tenant_id:'t',program_id:'p',account_id:'account',payload:{version:1,platform:'tiktok'}});
 const goalResult=await createSocialOperatingDecisionService(f.store).buildAndSave({tenantId:'t',operator:{type:'user',id:'owner'},input:{programRef:{type:'social_program',id:'p',version:1},enterprise:{ref:{type:'enterprise_profile',id:'profile',version:1},products:['企业产品'],markets:['US'],audiences:['企业采购'],languages:['en'],publicFacts:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>({ref,statement:'已确认的企业产品信息'})),prohibitedClaims:['编造产品性能'],weeklyBudgetCny:10,salesOwnerId:'owner'},accounts:[{ref:{type:'owned_social_account',id:'account',version:1},accountId:'account',platform:'tiktok',role:'核心账号',status:'active',conversionRouteId:'test-contact'}],conversionRoutes:[{ref:{type:'conversion_route',id:'test-contact',version:1},routeId:'test-contact',kind:'website',target:'https://example.test/contact',verified:true}]}});
 assert.equal(goalResult.goal.status,'ready');pkg.businessContentGoalRef={type:'business_content_goal',id:goalResult.goal.goalId,version:goalResult.goal.version};
 const service=createWeeklyPlanningAuthority(f.store);
 const initial=await service.initialize('t',pkg);
 const analysis=await service.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 assert.equal(analysis.directorAnalyses.length,1);assert.equal(analysis.directorAnalyses[0]!.benchmarkVideoRefs[0]!.id,'non-presenter-reference');
 const schedule=await service.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analysis.version,actor:'business_agent'});
 const confirmation=await service.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:schedule.version,userId:'owner'});
 const dispatched=await service.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmation.version,actor:'business_agent'});
 assert.equal(dispatched.status,'dispatched');
 // Remove the unrelated already-produced fixture task; production must use actual creation.
 f.tables.starter_social_content_tasks=[];
 const task:WeeklyExecutionTask={...f.task,taskId:'actual-planning-production',workflowKind:'content',status:'queued',schedule:{...f.task.schedule,stepKind:'material_readiness',responsibleActor:'content_agent'},dependsOnTaskIds:[],upstreamVersionRefs:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],attempt:0,lease:null,nextAttemptAt:null,inputSnapshot:{publicationTask:structuredClone(pkg.socialContentPackage.publicationTasks[0])}};
 f.tables.social_weekly_execution_tasks=[{id:task.taskId,tenant_id:'t',program_id:'p',package_id:pkg.packageId,package_version:pkg.version,task_id:task.taskId,status:'queued',payload:task}];
 const initialRunCount=f.tables.workflow_runs!.length;
 const report=await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{material_readiness:createSocialWeeklyProductionAdapter(f.store)},maxTasksPerTenant:1});
 const actual=f.tables.social_weekly_execution_tasks[0]!.payload as WeeklyExecutionTask;
 assert.equal(report.claimed,1);assert.ok(['pending','blocked','succeeded'].includes(actual.status),JSON.stringify(actual.lastError));
 assert.equal(f.tables.starter_usage_ledger?.length??0,0,'planning and prerequisite checks must not pay a supplier');
 const created=f.tables.starter_social_content_tasks[0]!;
 const detail=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:String(created.task_id)});assert.ok(detail);
 const referenceReviewHandoff=buildSocialReferenceReviewHandoff({record:f.tables.trend_videos!.find(row=>row.id==='non-presenter-reference')!,verifiedEnterpriseFactRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>`${ref.type}:${ref.id}@${ref.version}`)});
 return {f,pkg,task,actual,created,report,dispatched,detail,referenceReviewHandoff};
}
