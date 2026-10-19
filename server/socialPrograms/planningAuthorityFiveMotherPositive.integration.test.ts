import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {spawn} from 'node:child_process';
import {promisify} from 'node:util';
import type {AddressInfo} from 'node:net';
import express from 'express';
import ffmpeg from 'ffmpeg-static';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {prepareWeeklyEnterpriseFactFixture,reopenWeeklyEnterpriseFactFixtureStore} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {bindWeeklyPreproductionAuthority,readWeeklyQualifiedDirectorAdmission,runWeeklyPreproductionProducerScan,type WeeklyPreproductionJob,WEEKLY_PREPRODUCTION_JOBS} from '../runtime/weeklyPreproductionProducer.js';
import {PREPRODUCTION_RETRY_ATTEMPTS,type WeeklyPreproductionRetryAttempt} from '../runtime/weeklyPreproductionRetryAttempts.js';
import {ensureWeeklyQualifiedContinuationStage,ensureWeeklyQualifiedContinuationAttempt} from '../runtime/weeklyQualifiedContinuationStage.js';
import {executeApprovedDiscoveryRun} from '../socialDiscovery/service.js';
import type {CrawlVideosInput} from '../routes/videos.js';
import {withExecutionPackageGate} from './weeklyExecutionGate.js';
import {AUTOMATIC_WEEKLY_SCHEDULES} from './weeklyAutomaticSchedule.js';
import {SCHEDULE_PROPOSALS,scheduleHash} from './weeklyScheduleSnapshots.js';
import {WEEKLY_AUTOMATION_TEMPLATE} from '../../shared/weeklyAutomationTemplate.js';
import {createR3CandidateEvidenceAdapter} from '../socialDiscovery/r3CandidateEvidenceAdapter.js';
import {runCandidateEvidenceWorker} from '../socialDiscovery/candidateEvidenceWorker.js';
import {readWeeklyCandidateAdmissionSnapshot} from '../runtime/weeklyCandidateAdmissionSnapshot.js';
import {probeReferenceMediaClock} from '../lib/referenceMediaClock.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {supplementConsumerHash} from './weeklySupplementRequests.js';
import {CANDIDATE_CONTEXT_ASSESSMENTS,type CandidateContextAssessment} from '../socialDiscovery/candidateContextAssessment.js';
import {CANDIDATE_SEMANTIC_ASSESSMENTS,CANDIDATE_SEMANTIC_OPERATIONS,CANDIDATE_SEMANTIC_PROVIDER_RECEIPTS,type CandidateSemanticAssessment} from '../socialDiscovery/candidateSemanticAssessment.js';
import {createCandidateTransferabilityAssessment} from '../socialDiscovery/candidateTransferabilityAssessment.js';
import {createWeeklyPlanningAuthority} from './planningAuthority.js';
import {prepareWeeklyAutomaticProductionPlanning,readWeeklyAutomaticProductionIntent} from './weeklyAutomaticProductionPlanning.js';
import {adoptWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {WEEKLY_INDEPENDENT_ADMISSIONS,independentAdmissionId} from './weeklyIndependentAdmission.js';
import {createSocialOperatingOrchestrationService} from '../socialOperating/orchestration.js';
import {createSocialWeeklyProductionAdapter} from '../runtime/socialWeeklyProductionAdapter.js';
import {createSocialWeeklyPlanningAdapter} from '../runtime/socialWeeklyExecutionRuntime.js';
import {createSocialWeeklyExecutionWorker} from '../runtime/socialWeeklyExecutionWorker.js';
import {readWeeklyCtaContact,saveWeeklyCtaContact} from './weeklyCtaContact.js';
import {auditWeeklyTasks} from './weeklyTaskAudit.js';
import {createPresenterAssetsRouter} from '../routes/presenterAssets.js';
import {HeyGenPresenterClient} from '../lib/heygenPresenters.js';
import {readWeeklyProductionVoice} from '../starter198/socialContentBoundPresenterVoice.js';
import {checkWeeklyMaterialClassification} from '../runtime/socialWeeklyMaterialClassificationAdmission.js';

const tenantId='tenant-a',programId='program-a',packageId='package-a',packageVersion=7;
const timestamp='2026-10-18T00:00:00.000Z';

/** This is a deliberately fictional, isolated provider read. The formal import
 * endpoint, not fixture-authored rights text, must retain the authorization
 * source before a weekly default VoiceIdentity can be read. */
async function importIsolatedDefaultPresenter(store: Parameters<typeof createPresenterAssetsRouter>[0]) {
 const previous=process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;
 process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID=tenantId;
 const look={id:'fixture-owned-look',name:'Fictional fixture presenter',avatar_type:'photo_avatar',group_id:'fixture-owned-group',default_voice_id:'fixture-voice',status:'completed',image_width:1080,image_height:1920};
 let providerReads=0;
 const client=new HeyGenPresenterClient('fixture-only-no-network',async (rawUrl,init)=>{
  providerReads++;
  assert.equal(init?.method,'GET','the fixture must never submit a paid presenter request');
  const url=new URL(String(rawUrl));
  let data:unknown;
  if(url.pathname==='/v3/avatars/looks'&&url.searchParams.get('ownership')==='private')data=[look];
  else if(url.pathname==='/v3/avatars/looks/fixture-owned-look')data=look;
  else if(url.pathname==='/v3/avatars/fixture-owned-group')data={id:look.group_id,status:'completed'};
  else throw Error(`unexpected isolated presenter read: ${url.pathname}`);
  return new Response(JSON.stringify({data}));
 });
 const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals.tenantId=tenantId;next();});
 app.use(createPresenterAssetsRouter(store,async (_key,operation)=>operation(),{client,configured:()=>true,enabled:()=>false}));
 const server=app.listen(0,'127.0.0.1');
 try {
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog=await (await fetch(`${base}/catalog?scope=private`)).json();
  assert.equal(catalog.items?.[0]?.id,look.id);
  const response=await fetch(`${base}/import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lookId:look.id,voiceId:look.default_voice_id,reviewed:true,authorized:true,adultConfirmed:true,makeDefault:true})});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const defaults=await response.json();
  const presenter=defaults.presenters.find((item:any)=>item.id===defaults.defaultPresenterId);
  assert.ok(presenter);
  assert.match(presenter.rightsEvidence.authorizationRef,/^document:\/\/studio_presenter_assets\//);
  assert.equal((await readWeeklyProductionVoice(store,tenantId,[])).voiceId,look.default_voice_id);
  assert.equal(providerReads,3,'catalog, exact look, and group are the only provider reads');
  return presenter;
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  if(previous===undefined)delete process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;else process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID=previous;
 }
}

for(const conversionRoute of ['missing','ready_form'] as const)test(`five distinct real-media mothers stop before unsupported CTA (${conversionRoute})`,async t=>{
 const mediaRoot=await fs.mkdtemp(path.join(os.tmpdir(),'five-mother-director-media-'));
 t.after(()=>fs.rm(mediaRoot,{recursive:true,force:true}));
 const snapshotFile=path.join(mediaRoot,'isolated-store.json');
 const fixture=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:snapshotFile}),{profile}=fixture;
 let store=fixture.store;
 assert.ok(ffmpeg);
 const accountRow=(await store.list<any>('social_owned_accounts',{where:{tenant_id:tenantId,program_id:programId,account_id:'account-a'},perPage:2})).items[0];
 assert.ok(accountRow);
 if(conversionRoute==='missing')await store.update('social_owned_accounts',accountRow.id,{payload:{...accountRow.payload,conversionRoute:null}});
 const outlineAuthority=await createSocialOperatingOrchestrationService(store).resolve(tenantId,'owner',programId,{weekStart:'2026-10-26',desiredOriginalContents:5,desiredAdaptations:0});
 assert.equal(outlineAuthority.goal.status,conversionRoute==='missing'?'blocked':'ready');
 assert.equal(outlineAuthority.goal.blockers.some(item=>item.code==='conversion_route_required'),conversionRoute==='missing');
 const fact=outlineAuthority.snapshot.enterprise.publicFacts.find(item=>item.statement==='Serum');
 assert.ok(fact,'the enterprise fact must be verified, not inferred from video metadata');
 const publication=Array.from({length:5},(_,index)=>({
  publicationTaskId:`publication-${index+1}`,motherContentId:`mother-${index+1}`,adaptationOfPublicationTaskId:null,
  platform:'tiktok' as const,accountId:'account-a',accountPositioning:'B2B factory',businessProposition:'Verified serum packaging',
  cta:'Contact sales',factRefs:[fact.ref],metricTargets:['qualified_inquiry'],publishWindow:`2026-10-${26+index}T10:00:00Z`,status:'planned' as const,
 }));
 const weekly:WeeklyOperatingPackage={
  packageId,programId,version:packageVersion,status:'draft',weekStart:'2026-10-26',weekEnd:'2026-11-01',objective:'B2B product demonstration',
  enterpriseProfileRef:null,monthlyPlanRef:null,workflows:[],workflowTasks:[],appliedWorkflowEvents:[],taskVersionMappings:[],planningBlockers:[],
  businessContentGoalRef:outlineAuthority.snapshot.businessContentGoalRef,operatingDecisionSnapshotRef:{type:'operating_authority_snapshot',id:outlineAuthority.snapshot.snapshotId,version:outlineAuthority.snapshot.version},capacityPlanRef:null,automationPolicyRef:null,discoveryBudgetCny:10,
  socialContentPackage:{contentPackageId:'content-package-a',operatingPackageId:packageId,version:packageVersion,status:'draft',productionIdentityVersion:'shared-original.v1',originalContentTarget:5,adaptationVersionTarget:0,publicationTaskTarget:5,publicationTasks:publication,weeklyBudgetCny:50,perItemBudgetCny:10,capacityNotes:[],authorization:{mode:'bounded',accountIds:['account-a'],maxPublishItems:5,weekStart:'2026-10-26',weekEnd:'2026-11-01',allowRealPublishing:false,authorizedBy:null,authorizedAt:null,revokedBy:null,revokedAt:null}},
  successCriteria:['five distinct external mothers'],changeReason:'isolated positive fixture',previousVersion:6,createdBy:'owner',createdAt:timestamp,updatedAt:timestamp,
 };
 await store.create('social_weekly_operating_packages',{tenant_id:tenantId,program_id:programId,package_id:packageId,version:packageVersion,status:'draft',payload:weekly});
 const packageScope={tenantId,programId,packageId,packageVersion};
 await store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(packageScope),tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion,payload:{...packageScope,actorUserId:'owner',admittedAt:timestamp,mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
 await adoptWeeklyAutomationTemplate(store,packageScope,'owner');
 const outlineTask:WeeklyExecutionTask={...structuredClone(fixture.task),taskId:'outline-task-five',packageVersion,status:'queued',ownBlockingReasons:[],idempotencyKey:'outline-task-five',workflowKind:'readiness',scope:'package',subjectId:packageId,accountId:null,publicationTaskId:null,inputSnapshot:{},schedule:{...fixture.task.schedule,stepKind:'business_outline',estimatedStartAt:timestamp,estimatedFinishAt:'2026-10-18T00:05:00.000Z'}};
 await store.create('social_weekly_execution_tasks',{tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion,task_id:outlineTask.taskId,idempotency_key:outlineTask.idempotencyKey,status:outlineTask.status,payload:outlineTask});
 await bindWeeklyPreproductionAuthority({store,...packageScope,taskId:outlineTask.taskId,actorUserId:'owner',kind:'outline',expectedConsumerInputHash:supplementConsumerHash(outlineTask),now:new Date(timestamp)});
 const outlineScan=await runWeeklyPreproductionProducerScan({store,now:new Date(timestamp)});
 assert.equal(outlineScan.succeeded,1,JSON.stringify(outlineScan));
 const outlineWorker=createSocialWeeklyExecutionWorker(store),outlineClaim=await outlineWorker.claimNext({tenantId,workerId:'isolated-outline-worker',now:new Date(timestamp),scope:packageScope});
 assert.equal(outlineClaim?.task.taskId,outlineTask.taskId);
 const outlineResult=await createSocialWeeklyPlanningAdapter(store).execute(outlineClaim!.task);
 assert.equal(outlineResult.status,'succeeded',JSON.stringify(outlineResult));
 if(outlineResult.status==='succeeded')await outlineWorker.complete(outlineClaim!,outlineResult.resultRefs,new Date(timestamp));
 const outlineCompleted=(await store.list<{payload:WeeklyExecutionTask}>('social_weekly_execution_tasks',{where:{tenant_id:tenantId,task_id:outlineTask.taskId},perPage:2})).items[0]?.payload;
 assert.equal(outlineCompleted?.status,'succeeded');
 assert.ok(outlineCompleted.resultRefs.some(ref=>ref.type==='business_content_goal'&&ref.id===outlineAuthority.goal.goalId&&ref.version===outlineAuthority.goal.version));
 await store.create('social_playbook_versions',{tenant_id:tenantId,program_id:programId,account_id:'account-a',playbook_id:'playbook-a',version:1,status:'active',payload:{playbookId:'playbook-a',version:1,accountId:'account-a',programId,status:'active'}});
 const scopePayload={approval:{status:'approved',scopeVersion:2,approvedBy:'owner'},market:'US',language:'en',keywords:[],keywordSet:{scope:{productRef:'Serum',audienceRole:'brand_buyer'}},keywordRecommendation:{broadTerms:[{term:'serum'}]},discoveryBrief:{discoveryBriefId:'five-brief',keywordSetId:'five-keywords',keywordSetVersion:1,productRef:'Serum',market:'US',audience:'brand buyer',discoverySeedIds:[],trackedSceneIds:[],discoveryModes:['momentum'],platforms:['tiktok'],competitorAccounts:[],lookbackDays:7,resultLimit:5,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['serum'],platforms:['tiktok'],resultLimit:5,refreshIntervalMinutes:60,budgetLimitCny:null}}}};
 const scope=await store.create<any>('social_discovery_scopes',{id:'scope-five',tenant_id:tenantId,version:2,status:'active',payload:scopePayload});
 const presenter=await importIsolatedDefaultPresenter(store);
 const productId=String(profile.products?.items?.[0]?.id||profile.products?.items?.[0]?.productId||profile.products?.items?.[0]?.sku||'product-0');
 const material={id:'image',tenantId,productId,scope:'own',type:'image',sourceType:'enterprise_product_table',rightsStatus:'authorized',commercialUseApproved:true,rightsEvidenceRef:'enterprise_profile:product',contentSha256:'b'.repeat(64)};
 const binding={tenantId,presenterAssetId:presenter.id,assetVersion:presenter.assetVersion,avatarId:presenter.avatarId,voiceId:presenter.voiceId,model:'avatar_iv',accountRef:'isolated-test-account',credentialSha256:'c'.repeat(64),avatarType:'digital_twin',billingCurrency:'USD',billingEvidenceRef:'isolated-billing',authorizationRef:presenter.rightsEvidence.authorizationRef,consentRef:presenter.rightsEvidence.consentRef,providerEvidenceRef:'isolated-provider'};
 const transferabilityPorts={materials:async()=>({items:[material],status:'ready'}),livePresenter:async()=>binding,privateAssetTenantId:()=>tenantId} as any;
 const rootKey='weekly:five-mother-root';
 const rootRunId=`weekly_discovery_${socialRequestHash({tenantId,key:rootKey})}`;
 const task={...structuredClone(fixture.task),taskId:'collection-task-five',packageVersion,status:'blocked' as const,ownBlockingReasons:['weekly_preproduction_authority_required'],idempotencyKey:'collection-task-five',schedule:{...fixture.task.schedule,stepKind:'benchmark_collection' as const,estimatedStartAt:timestamp,estimatedFinishAt:'2026-10-18T01:00:00.000Z'}};
 await store.create('social_weekly_execution_tasks',{tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion,task_id:task.taskId,idempotency_key:task.idempotencyKey,status:task.status,payload:task});
 const rootJobBase={jobId:'root-job-five',tenantId,programId,packageId,packageVersion,consumerTaskId:task.taskId,consumerInputHash:supplementConsumerHash(task),kind:'discovery' as const,status:'blocked' as const,originalRunKey:rootKey,actorUserId:'owner',dueAt:timestamp,boundAt:timestamp,updatedAt:timestamp,sourceHash:socialRequestHash(scopePayload),authority:{scopeId:scope.id,scopeVersion:2,scopeHash:socialRequestHash(scopePayload),requestedModes:['momentum' as const]},code:'weekly_qualified_admission_unverified',resultRefs:[],recordHash:''};
 const rootJob:WeeklyPreproductionJob={...rootJobBase,recordHash:socialRequestHash(rootJobBase)};
 await store.create(WEEKLY_PREPRODUCTION_JOBS,{id:rootJob.jobId,tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion,task_id:task.taskId,input_hash:rootJob.consumerInputHash,kind:'discovery',status:rootJob.status,original_run_key:rootKey,record_hash:rootJob.recordHash,payload:rootJob});
 const rootRun={id:'root-run-row-five',tenant_id:tenantId,runId:rootRunId,status:'partial',startedAt:timestamp,finishedAt:'2026-10-18T00:01:00.000Z',discoveryScopeId:scope.id,discoveryScopeVersion:2,scopeSnapshot:{weeklyProducer:{key:rootKey},modePolicies:{momentum:{platforms:['tiktok']}}},queryBasis:{momentum:['serum']},evidenceOutcomes:{momentum:{acceptedCandidateIds:[] as string[],acceptedEvidenceRefs:[] as string[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
 const accountId='https://www.tiktok.com/@factory';
 await store.create('social_tracked_accounts',{tenant_id:tenantId,accountId,decision:'track',status:'tracked',accountRole:'brand_factory',reasons:['OEM supplier'],evidenceVideoIds:Array.from({length:5},(_,i)=>`video-${i+1}`),relatedSceneIds:[],missingEvidence:[],confidence:.95,businessConfirmation:{status:'confirmed',confirmedBy:'business_agent',decisionRef:'decision-five',reason:null,confirmedAt:timestamp}});
 const prepareCandidate=async(index:number,runId:string,recordRootOutcome:boolean)=>{
  const id=`video-${index}`,sourceUrl=`https://www.tiktok.com/@factory/video/${7696453131495853340+index}`;
  const relative=`tenants/${tenantId}/reference-videos/${id}.mp4`,file=path.join(mediaRoot,relative);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await promisify(execFile)(ffmpeg!,['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=0x${String(index).repeat(6)}:size=160x180:rate=10`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',file]);
  const mediaSha256=createHash('sha256').update(await fs.readFile(file)).digest('hex'),clock=await probeReferenceMediaClock(file);
  const gemini={theme:'verified product still',sourceMediaClock:{...clock,analysisRunId:`exact-${id}`,sourceSha256:mediaSha256},scriptDetails15s:[{time:'0-2',materialType:'product',visual:'静态护肤品瓶身特写',observedFacts:'静态展示Serum护肤品瓶身'}]};
  const aiAnalysis={analysisRunId:`exact-${id}`,analysisQuality:'video',analysisMode:'exact',contentSha256:mediaSha256,discoveryOrigins:[{runId,scopeId:scope.id,scopeVersion:2,mode:'momentum',queryRef:'serum',observedAt:timestamp}],gemini};
  await store.create('trend_videos',{id,tenantId,platform:'tiktok',title:`Serum product still ${id}`,sourceUrl,videoFileId:relative,aiAnalysis:JSON.stringify(aiAnalysis)});
  const evidenceId=`evidence-${id}`;
  if(recordRootOutcome)await store.create('social_candidate_evidence',{tenant_id:tenantId,candidateId:id,evidenceId,version:1,tenantId,inputFingerprint:id,evidence:{inspirationId:id,qualityScore:{ruleVersion:'discovery-score-v1',overall:90,dimensions:{relevance:90,transferability:90,momentum:75,evidence:80,platformPriority:90,businessModelFit:100},decision:'accepted',reasons:['B2B'],blockers:[],scoredAt:timestamp},classification:{businessModel:'b2b',platform:'tiktok',keywordTier:'broad'}},g1:{runId,sourceUrl},completeness:'complete',createdAt:timestamp});
  const handoff={inspirationId:id,readiness:'production_reference',analysisId:`exact-${id}`,version:'1',source:{sourceUrl},rights:{mayAnalyze:true,mayAdapt:true,mayUseOriginalMedia:false},productionImplications:{requiredEvidence:['真实产品实拍画面需要同品授权素材证明'],likelyAssetNeeds:[]},adaptationBoundary:{reusable:['镜头节奏'],mustReplace:['原片产品画面'],prohibited:['直接复用参考原片']}};
  await store.create('starter_social_inspiration_handoff_versions',{id:`handoff-${id}`,tenant_id:tenantId,handoff_version:'1',record_hash:socialRequestHash(handoff),payload:handoff});
  const context:CandidateContextAssessment={schema:'candidate-context-assessment.v1',assessmentId:`context-${id}`,tenantId,candidateId:id,programId,packageId,packageVersion,canonical:{analysisRunId:`exact-${id}`,analysisHash:socialRequestHash(gemini),mediaSha256,sourceUrl,completionReceiptHash:'isolated-completion'},productFacts:[fact],factsHash:socialRequestHash({productFacts:[fact],factVersion:profile.factVersion}),audienceRole:'brand_buyer',keyword:{scopeId:scope.id,scopeVersion:2,queryRef:'serum',tier:'broad',scopeHash:socialRequestHash(scope)},observations:[{shotIndex:1,time:'0-2',materialType:'product',observedFacts:'静态展示Serum护肤品瓶身',visual:'静态护肤品瓶身特写'}],dimensions:{relevance:{value:null,state:'unknown',reasons:[]},transferability:{value:null,state:'unknown',reasons:[]}},decision:'review',gaps:[],actorUserId:'owner',createdAt:timestamp,recordHash:'',newProviderRequests:0,newCostCny:0};
  context.recordHash=socialRequestHash({...context,recordHash:''});
  await store.create(CANDIDATE_CONTEXT_ASSESSMENTS,{id:context.assessmentId,tenant_id:tenantId,candidate_id:id,program_id:programId,package_id:packageId,package_version:packageVersion,record_hash:context.recordHash,payload:context});
  const operation={operationId:`candidate-semantic:${context.assessmentId}`,contextHash:context.recordHash};
  const provider={...operation,response:{id:`isolated-provider-${id}`}};
  await store.create(CANDIDATE_SEMANTIC_OPERATIONS,{id:operation.operationId,tenant_id:tenantId,record_hash:socialRequestHash(operation),payload:operation});
  await store.create(CANDIDATE_SEMANTIC_PROVIDER_RECEIPTS,{id:operation.operationId,tenant_id:tenantId,record_hash:socialRequestHash(provider),payload:provider});
  const semantic:CandidateSemanticAssessment={schema:'candidate-semantic-assessment.v1',assessmentId:`semantic-${id}`,contextAssessmentId:context.assessmentId,contextHash:context.recordHash,tenantId,candidateId:id,operationId:operation.operationId,providerReceiptRef:operation.operationId,dimensions:{relevance:{value:.83,state:'assessed',evidence:[{factRef:`${fact.ref.type}:${fact.ref.id}@${fact.ref.version}`,shotIndex:1,quote:'静态展示Serum护肤品瓶身',reason:'same product'}],reasons:[]},transferability:{value:null,state:'unknown',evidence:[],reasons:['target_production_resource_mapping_required']}},decision:'review',gaps:['target_production_resource_mapping_required'],recordHash:'',costCny:null,costState:'retained_unknown'};
  semantic.recordHash=socialRequestHash({...semantic,recordHash:''});
  await store.create(CANDIDATE_SEMANTIC_ASSESSMENTS,{id:semantic.assessmentId,tenant_id:tenantId,candidate_id:id,context_id:context.assessmentId,record_hash:semantic.recordHash,payload:semantic});
  await createCandidateTransferabilityAssessment({store,context,semantic,mapping:[{shotIndex:1,route:'enterprise_product_still',productId,imageId:'image',factRef:`${fact.ref.type}:${fact.ref.id}@${fact.ref.version}`}],presenterAssetId:presenter.id,ports:transferabilityPorts});
  if(recordRootOutcome){const outcome=rootRun.evidenceOutcomes!.momentum!;outcome.acceptedCandidateIds!.push(id);outcome.acceptedEvidenceRefs!.push(`${evidenceId}@1`);}
  return {id,evidenceId};
 };
 for(let index=1;index<=4;index++)await prepareCandidate(index,rootRunId,true);
 await store.create('social_discovery_runs',rootRun as any);
 const scheduleReceipt={proposalId:'five-preproduction-proposal',source:'automatic_template',templateVersion:WEEKLY_AUTOMATION_TEMPLATE.version,userApproval:null};
 const scheduleProposal={...packageScope,proposalId:scheduleReceipt.proposalId,inputAuthority:'target_graph_with_automatic_template_capacity',automaticAdoption:scheduleReceipt,targetGraph:{tasks:[task]},capacity:{constraints:{[task.taskId]:{availableAt:timestamp}}}};
 const scheduleColumns={tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion};
 await store.create(AUTOMATIC_WEEKLY_SCHEDULES,{id:'five-preproduction-schedule',...scheduleColumns,payload:scheduleReceipt,content_hash:socialRequestHash(scheduleReceipt)});
 await store.create(SCHEDULE_PROPOSALS,{id:scheduleReceipt.proposalId,...scheduleColumns,proposal_id:scheduleReceipt.proposalId,payload:scheduleProposal,content_hash:scheduleHash(scheduleProposal as any)});
 const limits=[{id:'tenant-limit',tenantId,scope:'tenant' as const,scopeKey:'*',maxRunning:3,updatedBy:'owner',createdAt:timestamp,updatedAt:timestamp},{id:'weekly-limit',tenantId,scope:'task_type' as const,scopeKey:'social_content_weekly',maxRunning:3,updatedBy:'owner',createdAt:timestamp,updatedAt:timestamp}];
 for(const limit of limits)await store.create('content_execution_limits',{id:limit.id,tenant_id:tenantId,limit_scope:limit.scope,scope_key:limit.scopeKey,max_running:limit.maxRunning});
 const priorNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='test';
 let staged:Awaited<ReturnType<typeof ensureWeeklyQualifiedContinuationStage>>;
 try{staged=await ensureWeeklyQualifiedContinuationStage({store,job:rootJob,runs:[rootRun],mediaRoot,now:new Date('2026-10-18T00:06:00.000Z'),candidateReader:input=>readWeeklyCandidateAdmissionSnapshot({...input,transferabilityPorts})});}
 finally{if(priorNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNodeEnv;}
 assert(staged.ready&&staged.stage.source.limit===1,'four real post-admission references leave exactly one same-day qualified slot');
 let boundChild:Awaited<ReturnType<typeof ensureWeeklyQualifiedContinuationAttempt>>['attempt']=null;
 process.env.NODE_ENV='test';
 try{await withExecutionPackageGate(store,packageScope,async()=>{boundChild=(await ensureWeeklyQualifiedContinuationAttempt({store,job:rootJob,runs:[rootRun],mediaRoot,now:new Date('2026-10-18T00:06:00.000Z'),candidateReader:input=>readWeeklyCandidateAdmissionSnapshot({...input,transferabilityPorts})})).attempt;});}
 finally{if(priorNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNodeEnv;}
 assert(boundChild,'the original blocked root must bind a real immutable child attempt');
 const childJob=boundChild as WeeklyPreproductionRetryAttempt;
 assert.equal(childJob.retry.parentRunHash,socialRequestHash(rootRun));
 let providerCalls=0;
 process.env.NODE_ENV='test';
 const childResult=await executeApprovedDiscoveryRun({tenantId,triggerType:'manual',expectedScopeId:scope.id,expectedScopeVersion:scope.version,requestedModes:['momentum'],originalRun:{key:childJob.originalRunKey,scopeHash:rootJob.authority!.scopeHash},retry:{kind:'qualified_continuation',continuationStageId:childJob.retry.continuationStageId,parentRunId:childJob.retry.parentRunId,parentRunHash:childJob.retry.parentRunHash,sourceSelection:childJob.retry.sourceSelection,authorization:childJob.retry.authorization},now:new Date('2026-10-18T00:06:00.000Z')},{dataStore:store,qualifiedCandidateReader:(input:Parameters<typeof readWeeklyCandidateAdmissionSnapshot>[0])=>readWeeklyCandidateAdmissionSnapshot({...input,mediaRoot,transferabilityPorts}),async crawl(input:CrawlVideosInput){providerCalls++;assert.equal(input.limit,1);return {platform:'tiktok',keyword:'serum',imported:1,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:1,total:1,source:'r3',message:'',candidateIds:['video-5'],items:[{id:'video-5',sourceUrl:`https://www.tiktok.com/@factory/video/${7696453131495853345}`,title:'B2B OEM factory Serum product still video-5',platform:'tiktok',aiAnalysis:JSON.stringify({analysisQuality:'video',taskRelevance:.95,transferability:.95,currentPerformance:100000,accountPlatformBaseline:1000,mechanisms:['product demonstration']})}]};},candidateEvidenceAdapter:createR3CandidateEvidenceAdapter(store),runCandidateEvidence:(items:Parameters<typeof runCandidateEvidenceWorker>[0])=>runCandidateEvidenceWorker(items)} as any);
 if(priorNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNodeEnv;
 assert.equal(providerCalls,1,'one bounded child submission reaches the controlled provider');
 assert(childResult.run,'the discovery service must persist the child run');
 const childRun=childResult.run;
 assert.equal(childRun.status,'succeeded');
 assert.ok(Date.parse(childJob.boundAt)-Date.parse(rootRun.finishedAt!)>=300000,'the child uses the real same-day five-minute interval');
 assert.equal(childRun.evidenceOutcomes?.momentum?.acceptedCandidateIds?.includes('video-5'),true,'metadata acceptance is written by the discovery service');
 store=reopenWeeklyEnterpriseFactFixtureStore(snapshotFile);
 assert.equal((await readWeeklyProductionVoice(store,tenantId,[])).voiceId,presenter.voiceId,
  'formal private import source and default binding survive a new persistent-store instance');
 const reservationsBefore=(await store.list('social_discovery_daily_reservations',{where:{tenant_id:tenantId},perPage:100})).totalItems;
 const replay=await executeApprovedDiscoveryRun({tenantId,triggerType:'manual',expectedScopeId:scope.id,expectedScopeVersion:scope.version,requestedModes:['momentum'],originalRun:{key:childJob.originalRunKey,scopeHash:rootJob.authority!.scopeHash,recoveryOnly:true},retry:{kind:'qualified_continuation',continuationStageId:childJob.retry.continuationStageId,parentRunId:childJob.retry.parentRunId,parentRunHash:childJob.retry.parentRunHash,sourceSelection:childJob.retry.sourceSelection,authorization:childJob.retry.authorization},now:new Date('2026-10-18T00:06:00.000Z')},{dataStore:store,async crawl(){throw Error('restarted recovery must not call the provider');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){throw Error('restarted recovery must not analyze metadata');}},async runCandidateEvidence(){throw Error('restarted recovery must not analyze metadata');}} as any);
 assert.equal(replay.run?.runId,childRun.runId,'the new DataStore instance recovers the same child run');
 assert.equal((await store.list('social_discovery_daily_reservations',{where:{tenant_id:tenantId},perPage:100})).totalItems,reservationsBefore,'new-instance recovery must not reserve again');
 assert.equal(providerCalls,1,'new-instance recovery must not submit again');
 await prepareCandidate(5,childRun.runId,false);
 // A newer analytical-only row and an old exact-analysis row may coexist in
 // the same legacy handoff collection; neither can replace the admitted
 // production handoff when the Director freezes the five mother references.
 const firstSource=`https://www.tiktok.com/@factory/video/${7696453131495853341}`;
 for(const [id,handoff] of [
  ['candidate-only-newer',{inspirationId:'video-1',readiness:'candidate_analysis_only',analysisId:'exact-video-1',version:'99',source:{sourceUrl:firstSource},rights:{mayAnalyze:true,mayAdapt:false,mayUseOriginalMedia:false}}],
  ['stale-exact-newer',{inspirationId:'video-1',readiness:'production_reference',analysisId:'old-exact-video-1',version:'100',source:{sourceUrl:firstSource},rights:{mayAnalyze:true,mayAdapt:true,mayUseOriginalMedia:false}}],
 ] as const)await store.create('starter_social_inspiration_handoff_versions',{id,tenant_id:tenantId,record_hash:socialRequestHash(handoff),payload:handoff});
 const childMarker=(childRun.scopeSnapshot as unknown as {weeklyProducer:{retry:{parentRunHash:string;sourceSelection:WeeklyPreproductionRetryAttempt['retry']['sourceSelection']}}}).weeklyProducer;
 assert.equal(childMarker.retry.parentRunHash,childJob.retry.parentRunHash);
 assert.equal(socialRequestHash(childMarker.retry.sourceSelection),socialRequestHash(childJob.retry.sourceSelection));
 assert.equal((rootRun.scopeSnapshot as unknown as {weeklyProducer:{key:string}}).weeklyProducer.key,rootJob.originalRunKey);
 const qualified=await readWeeklyQualifiedDirectorAdmission({store,rootJob,job:childJob,run:childRun,mediaRoot,transferabilityPorts});
 assert.deepEqual(qualified.candidateIds,['video-1','video-2','video-3','video-4','video-5']);
 let planner=createWeeklyPlanningAuthority(store,{mediaRoot,transferabilityPorts});
 const outline=await planner.initialize(tenantId,weekly);
 const discoveryAuthority={rootJobId:rootJob.jobId,currentJobId:childJob.jobId,runId:childRun.runId};
 await assert.rejects(planner.pinDirectorReference({tenantId,programId,packageId,packageVersion,expectedPlanningVersion:outline.version,candidateId:'old-tenant-video',selectedBy:'owner',expectedAccountUrl:accountId,discoveryAuthority}),(error:unknown)=>(error as {code?:string}).code==='weekly_pinned_reference_not_admitted');
 await assert.rejects(planner.pinDirectorReference({tenantId,programId,packageId,packageVersion,expectedPlanningVersion:outline.version,candidateId:'video-5',selectedBy:'owner',expectedAccountUrl:'https://www.tiktok.com/@other',discoveryAuthority}),(error:unknown)=>(error as {code?:string}).code==='weekly_pinned_reference_not_admitted');
 const pinned=await planner.pinDirectorReference({tenantId,programId,packageId,packageVersion,expectedPlanningVersion:outline.version,candidateId:'video-5',selectedBy:'owner',expectedAccountUrl:accountId,discoveryAuthority});
 assert.match(pinned.pinnedReference?.mediaSha256??'',/^[a-f0-9]{64}$/);
 await assert.rejects(planner.runDirectorAnalysis({tenantId,programId,packageId,packageVersion,expectedPlanningVersion:pinned.version,actor:'director_agent',eligibleVideoIds:qualified.candidateIds,discoveryAuthority:{...discoveryAuthority,runId:'another-run'}}),(error:unknown)=>(error as {code?:string}).code==='weekly_pinned_reference_invalid');
 store=reopenWeeklyEnterpriseFactFixtureStore(snapshotFile);
 planner=createWeeklyPlanningAuthority(store,{mediaRoot,transferabilityPorts});
 assert.equal((await planner.get(tenantId,programId,packageId,packageVersion)).pinnedReference?.recordHash,pinned.pinnedReference?.recordHash,'the selected reference survives disk restart');
 const analyzed=await planner.runDirectorAnalysis({tenantId,programId,packageId,packageVersion,expectedPlanningVersion:pinned.version,actor:'director_agent',eligibleVideoIds:qualified.candidateIds,discoveryAuthority});
 assert.equal(analyzed.directorGaps?.length,0);
 assert.deepEqual(new Set(analyzed.directorAnalyses.flatMap(item=>item.benchmarkVideoRefs.map(ref=>ref.id))),new Set(qualified.candidateIds));
 assert.equal(analyzed.directorAnalyses.length,5);
 assert.equal(analyzed.directorAnalyses.find(item=>item.benchmarkVideoRefs[0]?.id==='video-1')?.frozenHandoffRefs?.[0]?.version,'1','newer candidate-only or stale exact-analysis rows cannot become a formal handoff');
 assert.equal(analyzed.directorAnalyses.find(item=>item.slotId===pinned.pinnedReference?.slotId)?.benchmarkVideoRefs[0]?.id,'video-5');
 let crawls=0,exactSettlementReads=0;
 const report=await runWeeklyPreproductionProducerScan({store,now:new Date(timestamp),candidatePorts:{mediaRoot,transferabilityPorts,
  exactAnalysisPortsForRun:async()=>{exactSettlementReads++;return null;}},discoveryDependencies:{dataStore:store,async crawl(){crawls++;throw Error('isolated_fixture_must_recover_existing_run');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){throw Error('must_not_analyze');}},async runCandidateEvidence(){throw Error('must_not_analyze');}} as any});
 assert.equal(crawls,0,'persisted child run is recovered without a provider request');
 assert.equal(providerCalls,1,'the producer cannot make a second paid submission');
 assert.ok(exactSettlementReads>=2,'the same exact-settlement resolver reaches both producer admission and Director re-admission');
 assert.equal((await store.list('social_discovery_daily_reservations',{where:{tenant_id:tenantId},perPage:100})).totalItems,reservationsBefore,'the producer cannot reserve a second daily slot');
 assert.equal(report.succeeded,1,JSON.stringify({report,attempt:(await store.getById<any>(PREPRODUCTION_RETRY_ATTEMPTS,childJob.jobId))?.payload}));
 const produced=await planner.get(tenantId,programId,packageId,packageVersion);
 assert.ok(produced.version>analyzed.version,'producer must invoke the director after the direct admission check');
 assert.equal(produced.status,'awaiting_confirmation','producer stops before human confirmation and publication');
 assert.equal(produced.directorAnalyses.length,5);
 assert.equal(new Set(produced.directorAnalyses.flatMap(item=>item.benchmarkVideoRefs.map(ref=>ref.id))).size,5);
 const fifthPath=path.join(mediaRoot,`tenants/${tenantId}/reference-videos/video-5.mp4`);
 const fifthOriginal=await fs.readFile(fifthPath);
 await fs.appendFile(fifthPath,Buffer.from('changed'));
 const drifted=await readWeeklyQualifiedDirectorAdmission({store,rootJob,job:(await store.getById<any>(PREPRODUCTION_RETRY_ATTEMPTS,childJob.jobId))!.payload,run:childRun,mediaRoot,transferabilityPorts});
 assert.deepEqual(drifted.candidateIds,['video-1','video-2','video-3','video-4'],'a changed media hash cannot remain a qualified fifth mother');
 await assert.rejects(planner.runDirectorAnalysis({tenantId,programId,packageId,packageVersion,expectedPlanningVersion:produced.version,actor:'director_agent',eligibleVideoIds:qualified.candidateIds,discoveryAuthority:{rootJobId:rootJob.jobId,currentJobId:childJob.jobId,runId:childRun.runId}}),(error:unknown)=>(error as {code?:string}).code==='weekly_candidate_post_admission_required');
 await fs.writeFile(fifthPath,fifthOriginal);
 const selectedSlotIds=produced.detailedSchedule?.coverage?.selectedSlotIds;
 assert.ok(selectedSlotIds?.length===5,'all five real-media mothers must be covered before automatic handoff');
 const productionSteps=['material_preparation','script','storyboard','asset_generation','video_generation','quality_check'] as const;
 const tasks:WeeklyExecutionTask[]=publication.flatMap((item,index)=>productionSteps.map((stepKind,stepIndex)=>({
  taskId:`production-${index+1}-${stepKind}`,tenantId,programId,packageId,packageVersion,workflowKind:'content',scope:'publication',subjectId:item.publicationTaskId,accountId:item.accountId,publicationTaskId:item.publicationTaskId,
  dependsOnTaskIds:stepIndex?[`production-${index+1}-${productionSteps[stepIndex-1]}`]:[],upstreamVersionRefs:[],inputSnapshot:{rollingDate:item.publishWindow.slice(0,10)},idempotencyKey:`production-${index+1}-${stepKind}`,
  budget:{category:'production',limitCny:10},schedule:{stepKind,responsibleActor:'content_agent',estimatedDurationMinutes:5,estimatedStartAt:item.publishWindow,estimatedFinishAt:item.publishWindow,actualStartedAt:null,actualFinishedAt:null},
  status:'queued',ownBlockingReasons:[],inheritedBlockingTaskIds:[],attempt:0,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:null,recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:timestamp,updatedAt:timestamp,
 })) as WeeklyExecutionTask[]);
 for(const productionTask of tasks)await store.create('social_weekly_execution_tasks',{tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion,task_id:productionTask.taskId,idempotency_key:productionTask.idempotencyKey,status:productionTask.status,payload:productionTask});
 const productionNow='2026-10-26T06:00:00+08:00';
 const prepared=await prepareWeeklyAutomaticProductionPlanning(store,packageScope,productionNow);
 assert.equal(prepared.status,'prepared',JSON.stringify(prepared));
 if(prepared.status!=='prepared')return;
 const dispatched=await planner.get(tenantId,programId,packageId,packageVersion);
 assert.equal(dispatched.status,'dispatched');
 assert.equal(dispatched.userConfirmation,null,'the accepted template cannot be represented as human storyboard approval');
 assert.equal(dispatched.dispatch?.scheduleItems.length,5);
 assert.equal(new Set(dispatched.dispatch?.scheduleItems.map(item=>item.directorAnalysisRef.id)).size,5);
 // Exercise the same read-only material-classification boundary the Content
 // Agent adapter consults before it may create a production task. The five
 // references must remain distinct and byte-bound after Director dispatch.
 for(const scheduleItem of dispatched.dispatch!.scheduleItems){
  const analysis=dispatched.directorAnalyses.find(item=>item.analysisId===scheduleItem.directorAnalysisRef.id);
  assert.ok(analysis);
  assert.equal(analysis.benchmarkVideoRefs.length,1);
  assert.ok(qualified.candidateIds.includes(analysis.benchmarkVideoRefs[0]!.id));
  const source=await store.getById<any>('trend_videos',analysis.benchmarkVideoRefs[0]!.id);
  assert.ok(source);
  const sourcePath=path.join(mediaRoot,String(source.videoFileId));
  assert.equal(createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex'),JSON.parse(source.aiAnalysis).contentSha256);
  const classified=await checkWeeklyMaterialClassification({store,tenantId,programId,packageId,packageVersion,item:scheduleItem,analysis});
  assert.equal(classified.ready,true,JSON.stringify({publicationTaskId:scheduleItem.publicationTaskId,classified}));
  const wrongReference={type:analysis.benchmarkVideoRefs[0]!.type,id:'unrelated-reference-video',version:analysis.benchmarkVideoRefs[0]!.version};
  assert.deepEqual(await checkWeeklyMaterialClassification({store,tenantId,programId,packageId,packageVersion,
   item:{...scheduleItem,benchmarkVideoRefs:[wrongReference]},analysis}),
   {ready:false,code:'weekly_material_classification_lineage_invalid'},'dispatch cannot swap the frozen reference while retaining its material contract');
  assert.deepEqual(await checkWeeklyMaterialClassification({store,tenantId,programId,packageId,packageVersion,
   item:scheduleItem,analysis:{...analysis,benchmarkVideoRefs:[wrongReference]}}),
   {ready:false,code:'weekly_material_classification_lineage_invalid'},'Director cannot swap the frozen reference while retaining its material contract');
  assert.deepEqual(await checkWeeklyMaterialClassification({store,tenantId,programId,packageId,packageVersion,
   item:{...scheduleItem,benchmarkVideoRefs:undefined as any},analysis:{...analysis,benchmarkVideoRefs:undefined as any},requireReferenceBinding:true}),
   {ready:false,code:'weekly_material_classification_lineage_invalid'},'current production cannot omit both video references');
  if(classified.ready){
   assert.equal(classified.contract.items.length,1);
   assert.equal(classified.contract.items[0]?.classification,'human_irreplaceable','the reference product frame is not a target SKU video licence');
   assert.equal(classified.contract.handoffRef?.inspirationId,source.id);
  }
 }
 const bound=await readWeeklyAutomaticProductionIntent(store,packageScope,weekly,publication[0]!.publicationTaskId);
 assert.ok(bound);
 assert.equal(bound.intent.selectedPublicationTaskIds.length,5);
 assert.equal(bound.intent.authorizesPublishing,false);
 assert.equal(bound.intent.authorizesContentAcceptance,false);
 assert.equal(bound.intent.authorizesCustomerMessages,false);
 assert.equal(bound?.authority.proof.deferredOutboundBlockers.includes('conversion_route_required'),conversionRoute==='missing');
 let creates=0,starts=0;
 const adapter=createSocialWeeklyProductionAdapter(store,{now:()=>new Date('2026-10-26T09:00:00+08:00'),create:async()=>{creates++;throw Error('unverified CTA cannot create a content task');},start:async()=>{starts++;throw Error('unverified CTA cannot start paid production');}});
 const persistedScript=(await store.list<{payload:WeeklyExecutionTask}>('social_weekly_execution_tasks',{where:{tenant_id:tenantId,task_id:tasks.find(task=>task.schedule.stepKind==='script')!.taskId},perPage:2})).items[0]?.payload;
 assert.ok(persistedScript,'the adapter consumes the dispatch-updated durable task, not the pre-dispatch fixture');
 const stopped=await adapter.execute(persistedScript);
 assert.equal(stopped.status,'blocked',JSON.stringify(stopped));
 assert.equal(stopped.status==='blocked'?stopped.code:null,'weekly_production_cta_evidence_required');
 assert.equal(creates,0);assert.equal(starts,0);
 assert.equal((await store.list('starter_social_content_tasks',{where:{tenant_id:tenantId}})).totalItems,0);
 assert.equal((await store.list('content_execution_jobs',{where:{tenant_id:tenantId}})).totalItems,0);
 const contactBefore=await readWeeklyCtaContact(store,packageScope);
 assert.equal(contactBefore.status,'missing');
 const contactAfter=await saveWeeklyCtaContact(store,packageScope,'owner',{
  contactChannel:'whatsapp',contactValue:'+8613900000000',expectedContextHash:contactBefore.contextHash,expectedReceiptId:null,
 });
 assert.equal(contactAfter.status,'recorded');
 assert.equal(contactAfter.samplePromiseConfirmed,false,'a contact receipt never certifies the free-sample claim');
 const stoppedAfterContact=await adapter.execute(persistedScript);
 assert.equal(stoppedAfterContact.status,'blocked',JSON.stringify(stoppedAfterContact));
 assert.equal(stoppedAfterContact.status==='blocked'?stoppedAfterContact.code:null,'weekly_production_cta_evidence_required');
 assert.equal(creates,0);assert.equal(starts,0,'recording the number cannot cross the paid-production boundary');
 assert.equal((await store.list('starter_social_content_tasks',{where:{tenant_id:tenantId}})).totalItems,0);
 assert.equal((await store.list('content_execution_jobs',{where:{tenant_id:tenantId}})).totalItems,0);
 const auditStore=reopenWeeklyEnterpriseFactFixtureStore(snapshotFile);
 const stoppedTask={...persistedScript,status:'blocked' as const,ownBlockingReasons:['weekly_production_cta_evidence_required'],lastError:{code:'weekly_production_cta_evidence_required',message:'frozen CTA lacks policy evidence',retryable:false,occurredAt:productionNow}};
 const audit=await auditWeeklyTasks(auditStore,[stoppedTask]);
 assert.equal(audit.items[0]?.ctaContactStatus,'recorded');
 assert.equal(audit.items[0]?.requiredActions.filter(action=>action.code==='weekly_cta_sample_evidence_required').length,1,'one sample-policy intervention survives a new data-store instance');
 assert.ok(!audit.items[0]?.requiredActions.some(action=>action.action==='cta_contact'),'saved number must not be requested again');
 assert.equal((await auditStore.list('social_weekly_cta_contacts',{where:{tenant_id:tenantId,package_id:packageId}})).totalItems,1);
 assert.equal((await auditStore.list('starter_social_content_tasks',{where:{tenant_id:tenantId}})).totalItems,0);
 const snapshotBeforeRestart=createHash('sha256').update(await fs.readFile(snapshotFile)).digest('hex');
 const adapterUrl=new URL('../runtime/socialWeeklyProductionAdapter.ts',import.meta.url).href;
 const fixtureUrl=new URL('../runtime/weeklyEnterpriseFactSupplement.fixture.ts',import.meta.url).href;
 const restartScript=`
   const {reopenWeeklyEnterpriseFactFixtureStore}=await import(${JSON.stringify(fixtureUrl)});
   const {createSocialWeeklyProductionAdapter}=await import(${JSON.stringify(adapterUrl)});
   const store=reopenWeeklyEnterpriseFactFixtureStore(${JSON.stringify(snapshotFile)});
   const rows=await store.list('social_weekly_execution_tasks',{where:{tenant_id:${JSON.stringify(tenantId)},task_id:${JSON.stringify(persistedScript.taskId)}},perPage:2});
   if(rows.totalItems!==1)throw Error('persisted production task missing');
   let creates=0,starts=0;
   const adapter=createSocialWeeklyProductionAdapter(store,{now:()=>new Date('2026-10-26T09:00:00+08:00'),create:async()=>{creates++;throw Error('unverified CTA created task');},start:async()=>{starts++;throw Error('unverified CTA started production');}});
   const result=await adapter.execute(rows.items[0].payload);
   const content=(await store.list('starter_social_content_tasks',{where:{tenant_id:${JSON.stringify(tenantId)}},perPage:2})).totalItems;
   const jobs=(await store.list('content_execution_jobs',{where:{tenant_id:${JSON.stringify(tenantId)}},perPage:2})).totalItems;
   console.log(JSON.stringify({result,creates,starts,content,jobs}));
 `;
 const restarted=await new Promise<{result:{status:string;code?:string};creates:number;starts:number;content:number;jobs:number}>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',restartScript],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
   child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(Error(stderr||stdout));try{resolve(JSON.parse(stdout.trim()));}catch(error){reject(error);}});
 });
 assert.equal(restarted.result.status,'blocked');
 assert.equal(restarted.result.code,'weekly_production_cta_evidence_required');
 assert.deepEqual({creates:restarted.creates,starts:restarted.starts,content:restarted.content,jobs:restarted.jobs},{creates:0,starts:0,content:0,jobs:0});
 assert.equal(createHash('sha256').update(await fs.readFile(snapshotFile)).digest('hex'),snapshotBeforeRestart,'a restarted production scan must not mutate the blocked package');
 if(conversionRoute==='ready_form')assert.equal(bound?.authority.goal.status,'ready','a generic verified form must not establish WhatsApp or free-sample claims');
});
