import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Record_} from '../storage/datastore.js';
import type {InitialSceneQualityReport} from '../starter198/socialContentInitialSceneCache.js';
import {admitSocialSceneRework,previewSocialSceneReworkAdmission} from '../starter198/socialContentSceneReworkAdmission.js';
import {executeSocialSceneReworkSupply} from '../starter198/socialContentSceneRework.js';
import {createSocialSceneReworkOutputPort} from '../starter198/socialContentSceneReworkOutput.js';
import {reworkFrozenRenderManifest} from '../starter198/socialContentSceneReworkWorker.js';
import {createSocialSceneG4ReviewService} from '../starter198/socialSceneG4ReviewService.js';
import {SCENE_G4_CHECK_CODES} from '../../shared/contracts/socialSceneG4Review.js';
import {acquireDurableOperationLease} from '../runtime/durableLease.js';
import {inspectRenderedVisuals,inspectRenderedScenes,runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {g5FixtureScope,passedDirectorChecks} from '../starter198/socialDirectorG5ReviewService.fixture.js';
import {createWeeklyContentQualityRecoveryService,WEEKLY_QUALITY_REVIEW_BLOCK} from './weeklyContentQualityRecovery.js';

/** Real persisted source, media, G4 and weekly quality consumer; G5 remains explicit. */
export async function prepareWeeklyQualityRecoveryFixture(options:{hardFailure?:boolean;initialQualityReport?:InitialSceneQualityReport;initialG4Outcomes?:Array<'passed'|'failed'|'unknown'>;controlledRenderManifest?:boolean}={}){
 const f=await prepareWeeklyQualityAuditFixture(undefined,options);
 f.tables.starter_social_content_tasks![0]!.weekly_plan_id='week1';
 const task:WeeklyExecutionTask={...f.task,taskId:'original-weekly-quality',scope:'content',subjectId:'pub',status:'blocked',dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{publicationTask:structuredClone(f.pkg.socialContentPackage.publicationTasks[0])},idempotencyKey:'weekly-quality-week1-v1-pub',budget:{category:'production',limitCny:10},schedule:{stepKind:'quality_check',responsibleActor:'content_agent',estimatedDurationMinutes:15,estimatedStartAt:'2026-10-01T00:00:00Z',estimatedFinishAt:'2026-10-01T00:15:00Z',actualStartedAt:null,actualFinishedAt:null},ownBlockingReasons:[WEEKLY_QUALITY_REVIEW_BLOCK],inheritedBlockingTaskIds:[],attempt:1,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:{code:WEEKLY_QUALITY_REVIEW_BLOCK,message:'待独立审核',retryable:false,occurredAt:'2026-10-01T00:00:00Z'},recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
 f.tables.social_weekly_execution_tasks=[{id:'quality-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:task.taskId,idempotency_key:task.idempotencyKey,payload:task}];
 if(options.hardFailure){task.ownBlockingReasons=['weekly_quality_audit_actual_repair_required'];task.lastError={code:'weekly_quality_audit_actual_repair_required',message:'实际技术检测要求修复原产物',retryable:false,occurredAt:task.updatedAt};}
 const current=()=>f.tables.social_weekly_execution_tasks!.find(row=>row.task_id===task.taskId)!.payload as WeeklyExecutionTask;
 const completeG5=async()=>{await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});const ctx=await f.g5.context(g5FixtureScope,'owner');return f.g5.human(g5FixtureScope,'owner',{requestId:'quality-recovery-human-g5-0001',expectedContextHash:ctx.contextHash,checks:passedDirectorChecks(ctx)});};
 return {...f,serviceCache:f.service,task,scope:g5FixtureScope,current,completeG5,service:createWeeklyContentQualityRecoveryService(f.store)};
}

/** Controlled original detector fixture; child output is produced and inspected locally,
 * while the real admission, intent, cache, output and independent human audit services run. */
export async function prepareWeeklyHardQualityRepairFixture(){
 const originalReport:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[],metrics:{sampleCount:2,contentFrameCount:2,nonBackgroundFrameRatio:1,meanBrightness:100,meanLumaDeviation:20,meanEdgeRatio:1,meanFrameDifference:1,maxFrameDifference:1,motionDetected:true,estimatedDistinctFrames:2,nearDuplicateFrameRatio:0,sharpFrameRatio:1},evidenceFrames:[]},scenes:{passed:false,issues:[{sceneIndex:1,start:3,end:6,code:'blur',reason:'受控原始检测失败：第二镜清晰度不足'}],checkedScenes:2},audio:{ok:true,error:null}};
 const f=await prepareWeeklyQualityRecoveryFixture({hardFailure:true,initialQualityReport:originalReport,initialG4Outcomes:['passed','failed'],controlledRenderManifest:true});
 // Discard the shared fixture's unused hand-written repair authorization; this test
 // creates its own independent run through formal admission instead.
 f.tables.workflow_runs=f.tables.workflow_runs!.filter(row=>row.id!=='rework-run');
 const scope={tenantId:'t',taskId:'content',runId:'run',parentArtifactId:'artifact'};
 const original=await f.serviceCache.readCache(scope);
 const failed=original.cache.scenes.filter(s=>s.status==='failed');if(failed.length!==1)throw Error('hard_recovery_fixture_failed_scene_missing');
 const admissionInput={repository:f.repository,tenantId:'t',actorUserId:'owner',taskId:'content',sourceRunId:'run',parentArtifactId:'artifact',affectedSceneIds:failed.map(s=>s.sceneId),expectedCacheHash:original.cache.recordHash};
 const admissionPreview=await previewSocialSceneReworkAdmission(admissionInput);
 const admission=await admitSocialSceneRework({...admissionInput,expectedPreviewHash:admissionPreview.previewHash});
 const lease=await acquireDurableOperationLease({dataStore:f.store,tenantId:'t',scope:'content_execution_job',subjectId:admission.job.id,ownerId:'controlled-repair-worker',leaseDurationMs:60000});if(!lease)throw Error('hard_recovery_fixture_job_lease_missing');
 const expires=lease.expiresAt,job={...admission.job,status:'running' as const,workerId:'controlled-repair-worker',leaseExpiresAt:expires};
 await f.store.update('content_execution_jobs',job.id,{status:'running',worker_id:job.workerId,lease_expires_at:expires});
 const context=await f.serviceCache.readForJob({tenantId:'t',taskId:'content',runId:job.runId,operationId:admission.intent.operationId,actorUserId:'owner'});
 let supplierCalls=0;
 const supply=await executeSocialSceneReworkSupply({...context,actorUserId:'owner',parentArtifactHash:context.cache.parentArtifactHash,outputDirectory:f.local+'.repair-supply',adapters:[{adapterId:'controlled-local-repair',sourceStrategies:['customer_real_asset'],execute:async()=>{supplierCalls++;const scene=failed[0]!;return {...scene.result,asset:{...scene.result.asset,id:'actual-repaired-scene',localPath:f.local,url:f.local}};}}]});
 const assetHashes=await Promise.all(supply.assets.map(async asset=>{if(!asset.localPath)throw Error('fixture_asset_path_missing');return {id:asset.id,sha256:createHash('sha256').update(await readFile(asset.localPath)).digest('hex')};}));
 const intentRows=await f.store.list<Record_>('starter_social_scene_rework_intents',{where:{operation_id:admission.intent.operationId},perPage:2});if(intentRows.totalItems!==1)throw Error('fixture_intent_not_unique');
 const checkpoint={operationId:admission.intent.operationId,cacheHash:context.cache.recordHash,supply,assetHashes};await f.store.update('starter_social_scene_rework_intents',intentRows.items[0]!.id,{execution:{...checkpoint,hash:socialRequestHash(checkpoint)}});
 const outputPath=f.local+'.actual-repair.mp4';
 const rendered=await runVisualFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=360x640:rate=30:duration=6','-f','lavfi','-i','sine=frequency=440:duration=6','-vf',"hue=h='if(gte(t,3),90,0)'",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',outputPath]);if(!rendered.ok)throw Error('fixture_repair_render_failed:'+rendered.stderr);
 const visual=await inspectRenderedVisuals({outputPath,expectedDuration:6,expectedUniqueScenes:2,evidenceDir:f.local+'.repair-evidence'}),scenes=await inspectRenderedScenes({outputPath,scenes:[{start:0,end:3},{start:3,end:6}],requireDistinct:true});const audio=await runVisualFfmpeg(['-i',outputPath,'-map','0:a:0','-t','2','-f','null','-']);
 if(!visual.passed||!scenes.passed||!audio.ok)throw Error('fixture_repair_actual_quality_failed:'+JSON.stringify({visual,scenes,audio:audio.ok}));
 const manifest=reworkFrozenRenderManifest(context.cache.renderInput.manifest,admission.intent,supply,context.baseline.scenes.map(s=>s.sceneId));
 const output=createSocialSceneReworkOutputPort({repository:f.repository,accessResolver:{resolve:async()=>({kind:'subscription',subscription:{status:'active',plan:'customer',expiresAt:null}})}});
 const result=await output({job,intent:admission.intent,outputPath,sha256:createHash('sha256').update(await readFile(outputPath)).digest('hex'),manifest,supply,quality:{visual,scenes,audioDecoded:audio.ok}});
 const childScope={tenantId:'t',taskId:'content',runId:job.runId,artifactId:result.artifactId};
 const g4=createSocialSceneG4ReviewService(f.repository);await g4.assign(childScope,'owner',{reviewerUserId:'owner'});
 const auditChildG4=async()=>{for(const scene of await g4.context(childScope,'owner'))await g4.submit(childScope,'owner',{requestId:`repair-human-g4-${scene.sceneId}-0001`,sceneId:scene.sceneId,expectedContextHash:scene.contextHash,checks:SCENE_G4_CHECK_CODES.map(code=>({code,outcome:'passed',observation:`受控本地新片明确逐镜审核 ${code}`}))});};
 const auditChildG5=async()=>{await f.g5.assign(childScope,'owner',{reviewerUserId:'owner'});const ctx=await f.g5.context(childScope,'owner');return f.g5.human(childScope,'owner',{requestId:'repair-independent-human-g5-0001',expectedContextHash:ctx.contextHash,checks:passedDirectorChecks(ctx)});};
 return {...f,childScope,result,job,lease,auditChildG4,auditChildG5,supplierCalls:()=>supplierCalls};
}
