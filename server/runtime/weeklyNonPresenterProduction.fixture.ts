import {createSocialProgramService} from '../socialPrograms/service.js';
import nodeFs from 'node:fs';
import os from 'node:os';
import {readMaterialLibrary,type MaterialRecord} from '../lib/materialLibrary.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {createStarter198Repository} from '../starter198/repository.js';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import ffmpeg from 'ffmpeg-static';
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

export interface WeeklyNonPresenterFixtureOptions {controlledSourceTone?:boolean;sourceUrl?:string;weeklyBudgetCny?:number;sourceSpeech?:string;ownedReferenceBytes?:boolean;productInventory?:boolean;primaryStructure?:boolean;metricTargets?:string[];successCriteria?:string[];targetCta?:string;confirmedTemplate?:boolean}
/** Real initialize/analyze/merge/confirm/dispatch over owned media and a controlled
 * source-analysis contract; no claim that external search or a live model ran. */
export async function prepareWeeklyNonPresenterPlanningFixture(t:TestContext,options:WeeklyNonPresenterFixtureOptions={ownedReferenceBytes:true}){
 const referenceId=`non-presenter-reference-${randomUUID()}`;
 const sourceUrl=options.sourceUrl??'https://www.tiktok.com/@fixture/video/1';
 const sourceSpeech=options.sourceSpeech??'Hello.';if(!sourceSpeech.trim())throw Error('controlled source speech must be explicit');
 const f=await prepareWeeklyQualityAuditFixture();t.after(f.cleanup);
 f.tables.social_weekly_agent_planning=[];
 const priorHandoff=f.tables.starter_social_inspiration_handoff_versions![0]!;const actualHandoff=structuredClone(priorHandoff.payload) as Record<string,unknown>;actualHandoff.inspirationId=referenceId;actualHandoff.analysisId='non-presenter-analysis';actualHandoff.source={...(actualHandoff.source as Record<string,unknown>),sourceUrl};
 const pkg=f.pkg;if(options.weeklyBudgetCny!==undefined)pkg.socialContentPackage.weeklyBudgetCny=options.weeklyBudgetCny;if(options.targetCta!==undefined)for(const publication of pkg.socialContentPackage.publicationTasks)publication.cta=options.targetCta;pkg.referenceSourcePolicy={profile:'b2b_cold_start',ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'};
 Object.assign(pkg.socialContentPackage,{originalContentTarget:1,adaptationVersionTarget:0,publicationTaskTarget:1});
 Object.assign(pkg.socialContentPackage.publicationTasks[0]!,{motherContentId:'new-mother',adaptationOfPublicationTaskId:null,accountPositioning:'B2B采购产品说明',publishWindow:'2026-10-08T10:00:00Z'});
 if(options.successCriteria)pkg.successCriteria=structuredClone(options.successCriteria);
 if(options.metricTargets)pkg.socialContentPackage.publicationTasks[0]!.metricTargets=structuredClone(options.metricTargets);
  await f.store.create('social_discovery_scopes', {
    tenant_id: 't', program_id: 'p', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await f.store.create('social_candidate_evidence', {
    tenant_id: 't', evidenceId: 'evidence-non-presenter-reference', version: 1, tenantId: 't', candidateId: referenceId, inputFingerprint: 'fp',
    evidence: {
      inspirationId: referenceId, discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await f.store.create('trend_videos', { id: referenceId, tenantId: 't', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl,duration:6,aiAnalysis:JSON.stringify({analysisMode:'exact',analysisQuality:'video',gemini:{scriptDetails15s:[{time:'0-3',purpose:'装饰转场',visual:'纯装饰抽象几何动画，不作企业证据',shot:'图形',camera:'固定',confidence:0.98},{time:'3-6',purpose:'装饰转场',visual:'纯装饰彩色图形动画，不作企业证据',shot:'图形',camera:'固定',confidence:0.98}]}}) });
 if(options.ownedReferenceBytes){assert.ok(ffmpeg);const mediaRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../data/media');const folder=path.join(mediaRoot,'tenants/t/reference-videos');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,`${referenceId}.mp4`);await assert.rejects(fs.access(path.join(mediaRoot,`tenants/t/reference-evidence/${referenceId}`)),'test must not delete existing owned evidence');await assert.rejects(fs.access(file),'test source must not overwrite an existing owned file');const spoken=path.join(folder,`${referenceId}.aiff`);await assert.rejects(fs.access(spoken));await promisify(execFile)('/usr/bin/say',['-o',spoken,sourceSpeech]);t.after(()=>fs.rm(spoken,{force:true}));await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x180:rate=10','-i',spoken,'-af','apad','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',file]);t.after(()=>fs.rm(file,{force:true}));t.after(()=>fs.rm(path.join(mediaRoot,`tenants/t/reference-evidence/${referenceId}`),{recursive:true,force:true}));const record=f.tables.trend_videos!.find(row=>row.id===referenceId)!;const original=JSON.parse(String(record.aiAnalysis));record.videoFileId=`tenants/t/reference-videos/${referenceId}.mp4`;record.aiAnalysis=JSON.stringify({...original,analysisRunId:'actual-local-analysis-run',contentSha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});}
 // Controlled provider-contract output is frozen before actual planning. No live model proof.
 const reference=f.tables.trend_videos!.find(row=>row.id===referenceId)!;
 const observed=JSON.parse(String(reference.aiAnalysis));
 observed.durationSeconds=6;
 observed.gemini.scriptDetails15s=observed.gemini.scriptDetails15s.map((shot:Record<string,unknown>,index:number)=>({...shot,
  observedFacts:'原片图形动画',bgm:'人工核对原片无配乐',voiceover:sourceSpeech,soundEffects:['人工核对原片无音效'],dialogue:'',beats:[{action:'原片图形连续运动'}],
  criticalShot:{classification:'critical',primaryHook:index===0,uniqueVisualMechanism:true,explicitAudioVisualSync:false,confidence:.95,reason:'controlled source provider contract',evidence:['实际原片图形'],model:'controlled-local-contract',provenance:'controlled-source-frames',actionEvents:[],syncPoints:[]}}));
 const frameRows=observed.gemini.scriptDetails15s.flatMap((_shot:unknown,index:number)=>[{shotId:`shot-${index+1}`,seconds:index*3+.1,base64:'controlled-contract-frame',mimeType:'image/jpeg'},{shotId:`shot-${index+1}`,seconds:index*3+1,base64:'controlled-contract-frame',mimeType:'image/jpeg'}]);
 for(const frame of frameRows){const filename=path.resolve('data/media/tenants/t/reference-videos',`${referenceId}-actual-frame-${frame.shotId}-${frame.seconds}.jpg`);await assert.rejects(fs.access(filename));await promisify(execFile)(ffmpeg!,['-hide_banner','-loglevel','error','-ss',String(frame.seconds),'-i',path.resolve('data/media',String(reference.videoFileId)),'-frames:v','1','-y',filename]);frame.base64=(await fs.readFile(filename)).toString('base64');await fs.rm(filename);}
 observed.gemini.scriptDetails15s=validatePresenterContinuity({analysis:observed.gemini,frames:frameRows,sourceSha256:observed.contentSha256,videoId:referenceId}, {shots:[1,2].map((n)=>({shotId:`shot-${n}`,visibility:'no_person',personContinuityId:'',confidence:.95,evidence:['受控原片provider契约：图形动画无人'],frameSeconds:[(n-1)*3+.1,(n-1)*3+1]}))},'controlled-source-model');
 reference.aiAnalysis=JSON.stringify(observed);
 const materializer=createExactShotMaterializationService(f.store);const materialScope={tenantId:'t',recordId:referenceId,expectedSourceSha256:observed.contentSha256,expectedAnalysisRunId:observed.analysisRunId,expectedAnalysisHash:socialRequestHash(observed)};await materializer.materialize(materialScope);const materialAnalysis=await materializer.readVerifiedAnalysis(materialScope);assert.ok(materialAnalysis);const reviewedRecord={...reference,aiAnalysis:materialAnalysis};
 const initialReview=initialReferenceShotReview(reviewedRecord);
 const hooks={camera:'原片固定镜头',visual:'原片图形运动',subject:'原片图形',music:'人工核对无配乐',voiceover:sourceSpeech,soundEffects:'人工核对无音效',spokenWords:'人工核对无口播',subjectAction:'原片图形连续移动'};
 reference.referenceShotReview=JSON.stringify(updateReferenceShotReview(reviewedRecord,{expectedVersion:initialReview.version,sections:initialReview.sections.map((section,index)=>({...section,start:index,end:index+1,confirmed:true})),shots:initialReview.shots.map((shot,index)=>({...shot,reviewStatus:'confirmed',labels:['图形'],content:'原片图形连续移动',purpose:'装饰表达',hookAction:'原片图形从左侧进入画面，随后持续移动到中央位置，不含人物动作。',hookMotionConfirmed:index===0,hookScript:hooks,hookScriptConfirmed:index===0})),selectedHookShotId:'shot-1'}));
 reference.referenceVerifiedSpeech={schemaVersion:1,analysisRunId:observed.analysisRunId,sourceSha256:observed.contentSha256,coverageConfirmed:true,reviewerId:'owner',verifiedAt:'2026-10-01T00:00:00Z',lines:[{start:.1,end:1.5,text:sourceSpeech,visibility:'voiceover'}]};
 // Explicit controlled source-producer contract, persisted only after actual owned-frame/audio review.
 if(options.primaryStructure){actualHandoff.referenceRole='primary_structure';actualHandoff.whySelected=['明确选用已核验原片完整镜头顺序作为本周主结构参考；受控结构分析契约，不是live模型证据'];}
 if(options.controlledSourceTone){
  actualHandoff.readiness='production_reference';actualHandoff.rights={mayAnalyze:true,mayAdapt:true,mayUseOriginalMedia:false};
  actualHandoff.reusableLogic={hookTypes:['原片图形运动开场'],revealOrder:['图形进入','图形持续移动'],proofPlacement:[],pacing:'两段各三秒',emotionalProgression:'观察到理解',ctaPosition:'已核对原片无CTA'};
  actualHandoff.evidenceRefs=[{description:'受控provider契约：已实际抽帧核验图形运动，原片无人物；调性结论仅限该受控样片，原片无CTA',confidence:.95,needsReview:false}];
 }
 await f.store.create('starter_social_inspiration_handoff_versions',{tenant_id:'t',handoff_version:'1',record_hash:socialRequestHash(actualHandoff),payload:actualHandoff});
  await f.store.create('social_tracked_accounts', {
    tenant_id: 't', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: [referenceId, 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });
 await f.store.create('social_programs',{tenant_id:'t',program_id:'p',payload:{version:1}});
 await f.store.create('social_owned_accounts',{tenant_id:'t',program_id:'p',account_id:'account',version:1,status:'active',payload:{accountId:'account',programId:'p',version:1,status:'active',platform:'tiktok'}});
 await createSocialProgramService(f.store).savePlaybook('t','owner','p','account',{expectedAccountVersion:1,activate:true,audience:['企业采购'],pillars:['产品介绍'],evidenceRules:['仅展示已确认产品资料'],visualRules:['保留清晰产品外观'],languageRules:['英文说明'],conversionRoute:{entryType:'direct_message',callToAction:options.targetCta??'Contact sales'}});
 const goalResult=await createSocialOperatingDecisionService(f.store).buildAndSave({tenantId:'t',operator:{type:'user',id:'owner'},input:{programRef:{type:'social_program',id:'p',version:1},enterprise:{ref:{type:'enterprise_profile',id:'profile',version:1},products:['企业产品'],markets:['US'],audiences:['企业采购'],languages:['en'],publicFacts:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>({ref,statement:'已确认的企业产品信息'})),prohibitedClaims:['编造产品性能'],weeklyBudgetCny:options.weeklyBudgetCny??10,salesOwnerId:'owner'},accounts:[{ref:{type:'owned_social_account',id:'account',version:1},accountId:'account',platform:'tiktok',role:'核心账号',status:'active',conversionRouteId:'test-contact'}],conversionRoutes:[{ref:{type:'conversion_route',id:'test-contact',version:1},routeId:'test-contact',kind:'website',target:'https://example.test/contact',verified:true}]}});
 assert.equal(goalResult.goal.status,'ready');pkg.businessContentGoalRef={type:'business_content_goal',id:goalResult.goal.goalId,version:goalResult.goal.version};
 if(options.confirmedTemplate){
  const {fixture}=await import('../socialPrograms/weeklyContentTemplates.fixture.js');const source=await fixture();t.after(source.cleanup);
  const candidate=await source.service.create({tenantId:'t',programId:'p'},source.input);const templateRef={type:'weekly_content_template',id:candidate.templateId,version:1};
  await source.service.confirm({tenantId:'t',programId:'p'},{actorUserId:'owner',templateRef,candidateHash:candidate.recordHash,usage:'trial',reason:'明确用于下一周完整阶段链受控验证'});
  // Preserve actual past production/template records; the new target is a distinct future package.
  for(const [collection,rows] of Object.entries(source.tables)){if(['starter_social_director_plan_versions'].includes(collection))f.tables[collection]=[];if(['users','social_programs','social_owned_accounts'].includes(collection))continue;for(const row of rows){const existing=f.tables[collection]?.findIndex(value=>value.id===row.id)??-1;if(existing>=0)f.tables[collection]![existing]=structuredClone(row);else(f.tables[collection]??=[]).push(structuredClone(row));}}
  pkg.packageId='week2';pkg.version=1;pkg.status='draft';pkg.weekStart='2026-10-19';pkg.weekEnd='2026-10-25';
  for(const pub of pkg.socialContentPackage.publicationTasks)pub.publishWindow='2026-10-20T10:00:00Z';
  const targetRow=f.tables.social_weekly_operating_packages.find(row=>row.package_id==='week2'&&row.version===1);assert.ok(targetRow);targetRow.payload=structuredClone(pkg);
  const {createWeeklyContentTemplateService}=await import('../socialPrograms/weeklyContentTemplates.js');const templates=createWeeklyContentTemplateService(f.store);
  const publication=pkg.socialContentPackage.publicationTasks[0]!;const binding=await templates.bind({tenantId:'t',programId:'p',packageId:'week2',packageVersion:1,publicationTaskId:publication.publicationTaskId},{actorUserId:'owner',templateRef,candidateHash:candidate.recordHash,expectedTargetVersion:2});
  pkg.version=2;const {buildWeeklyWorkflow}=await import('../socialPrograms/weeklyPlanner.js');const targetWorkflow=buildWeeklyWorkflow({packageId:pkg.packageId,version:pkg.version,businessGoal:goalResult.goal,capacity:null,automationPolicy:null,publicationTasks:pkg.socialContentPackage.publicationTasks,discoveryBudgetCny:pkg.discoveryBudgetCny});pkg.workflows=targetWorkflow.workflows;pkg.workflowTasks=targetWorkflow.tasks;publication.contentTemplateBindingRef={type:'weekly_content_template_binding',id:binding.bindingId,version:1};
  await f.store.create('social_weekly_operating_packages',{tenant_id:'t',program_id:'p',package_id:pkg.packageId,version:pkg.version,payload:structuredClone(pkg)});
 }
 const service=createWeeklyPlanningAuthority(f.store);
 const initial=await service.initialize('t',pkg);
 const analysis=await service.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
 assert.equal(analysis.directorAnalyses.length,1);assert.equal(analysis.directorAnalyses[0]!.benchmarkVideoRefs[0]!.id,referenceId);
 const schedule=await service.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analysis.version,actor:'business_agent'});
 const confirmation=await service.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:schedule.version,userId:'owner'});
 const dispatched=await service.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmation.version,actor:'business_agent'});
 assert.equal(dispatched.status,'dispatched');
 pkg.agentPlanning=structuredClone(dispatched);
 // Remove the unrelated already-produced fixture task; production must use actual creation.
 if(!options.confirmedTemplate){f.tables.starter_social_content_tasks=[];f.tables.social_weekly_execution_tasks=[];}
 return {referenceId,repository:f.repository,f,pkg,dispatched};
}

export async function prepareWeeklyNonPresenterProductionFixture(t:TestContext,options:WeeklyNonPresenterFixtureOptions={ownedReferenceBytes:true}){
 const {referenceId,f,pkg,dispatched}=await prepareWeeklyNonPresenterPlanningFixture(t,options);
 const task:WeeklyExecutionTask={...f.task,packageId:pkg.packageId,packageVersion:pkg.version,programId:pkg.programId,taskId:'actual-planning-production',workflowKind:'content',status:'queued',schedule:{...f.task.schedule,stepKind:'material_readiness',responsibleActor:'content_agent'},dependsOnTaskIds:[],upstreamVersionRefs:[],ownBlockingReasons:[],inheritedBlockingTaskIds:[],resultRefs:[],attempt:0,lease:null,nextAttemptAt:null,inputSnapshot:{publicationTask:structuredClone(pkg.socialContentPackage.publicationTasks[0])}};
 f.tables.social_weekly_execution_tasks=[...(options.confirmedTemplate?f.tables.social_weekly_execution_tasks:[]),{id:task.taskId,tenant_id:'t',program_id:'p',package_id:pkg.packageId,package_version:pkg.version,task_id:task.taskId,status:'queued',payload:task}];
 let repository=f.repository;
 if(options.productInventory){
  const inventoryDir=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-product-inventory-'));t.after(()=>fs.rm(inventoryDir,{recursive:true,force:true}));const mediaFolder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../data/media/tenants/t',path.basename(inventoryDir));await fs.mkdir(mediaFolder);t.after(()=>fs.rm(mediaFolder,{recursive:true,force:true}));const image=path.join(mediaFolder,'identity.png');
  await promisify(execFile)(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=white:s=240x320','-vf','drawbox=x=90:y=60:w=60:h=200:color=blue:t=fill','-frames:v','1','-y',image]);
  const imageSha=createHash('sha256').update(await fs.readFile(image)).digest('hex');
  const product:MaterialRecord={id:'actual-owned-product-identity',tenantId:'t',type:'image',name:'企业产品包装身份',productId:'owned-product',productName:'企业产品',productRef:'企业产品',scope:'tenant',url:`/media/tenants/t/${path.basename(inventoryDir)}/identity.png`,contentSha256:imageSha,rightsStatus:'authorized',rightsEvidenceRef:'actual-upload-owner-confirmation',source:'tenant_upload',sourceRevision:imageSha,
   scriptAnalysis:buildMaterialScriptAnalysis({materialId:'actual-owned-product-identity',name:'企业产品包装身份',sourceRevision:imageSha,duration:0,productId:'owned-product',productRef:'企业产品',productPolicy:'locked',productPolicySource:'user_explicit',visualObservations:['白底蓝色矩形包装产品，固定正面产品外观；作为上传者明确选择的产品身份图片'],analyzedAt:'2026-10-01T00:00:00Z'})};
  const catalog=path.join(inventoryDir,'materials.json');await fs.writeFile(catalog,JSON.stringify([product]));
  repository=createStarter198Repository(f.store,{materialLibrary:tenantId=>readMaterialLibrary(tenantId,{local:()=>{const rows=JSON.parse(nodeFs.readFileSync(catalog,'utf8'));for(const row of rows){if(row.contentSha256!==createHash('sha256').update(nodeFs.readFileSync(image)).digest('hex'))throw Error('actual product bytes changed');}return rows;},cloud:async()=>({items:[],source:{source:'database',state:'ready',message:'实际隔离空云素材库'}})})});
 }
 const initialRunCount=f.tables.workflow_runs!.length;
 const report=await runSocialWeeklyExecutionScan({dataStore:f.store,adapters:{material_readiness:createSocialWeeklyProductionAdapter(f.store,{repository})},maxTasksPerTenant:1});
 const actual=f.tables.social_weekly_execution_tasks.find(row=>row.task_id===task.taskId)!.payload as WeeklyExecutionTask;
 assert.equal(report.claimed,1);assert.ok(['pending','blocked','succeeded'].includes(actual.status),JSON.stringify(actual.lastError));
 assert.equal(f.tables.starter_usage_ledger?.length??0,0,'planning and prerequisite checks must not pay a supplier');
 const created=f.tables.starter_social_content_tasks.find(row=>row.create_idempotency_key===`weekly-production:${pkg.packageId}:${pkg.version}:${task.publicationTaskId}`)!;assert.ok(created,JSON.stringify(actual));
 const detail=await readSocialTaskDetail({repository,tenantId:'t',taskId:String(created.task_id)});assert.ok(detail);
 const referenceReviewHandoff=buildSocialReferenceReviewHandoff({record:f.tables.trend_videos!.find(row=>row.id===referenceId)!,verifiedEnterpriseFactRefs:pkg.socialContentPackage.publicationTasks[0]!.factRefs.map(ref=>`${ref.type}:${ref.id}@${ref.version}`)});
 return {referenceId,repository,f,pkg,task,actual,created,report,dispatched,detail,referenceReviewHandoff};
}
