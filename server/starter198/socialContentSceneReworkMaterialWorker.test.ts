import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setup} from './socialContentSceneReworkAdmission.fixture.js';
import {previewSocialSceneReworkAdmission,admitSocialSceneRework} from './socialContentSceneReworkAdmission.js';
import {runSocialSceneReworkJob} from './socialContentSceneReworkWorker.js';
import {existingAssetSupplyAdapters} from './socialContentProductionSupport.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {createSocialSceneReworkOutputPort} from './socialContentSceneReworkOutput.js';
import {verifyStoredSceneReworkMeasuredVoice} from './socialContentSceneReworkMeasuredVoice.js';

test('v3 worker freezes selected real material before render and rejects changed source on resume',async()=>{
 const f=await setup(false,true,true,true);
 try{
  const bytes=await readFile(f.local),sha=createHash('sha256').update(bytes).digest('hex');
  const replacementPath=f.local+'.replacement';await writeFile(replacementPath,bytes);
  const analysis=buildMaterialScriptAnalysis({materialId:'replacement',name:'产品展示',sourceRevision:sha,duration:8,
   segments:[{start:0,end:8,observedFacts:'产品展示',subject:'产品',confidence:.95}],visualObservations:['产品展示']});
  const material={id:'replacement',type:'video',tenantId:'t',name:'产品展示',duration:8,sourceRevision:sha,
   scriptAnalysis:analysis,materialRoles:['product'],rightsStatus:'owned',rightsEvidenceRef:'ownership:replacement',
   commercialUseApproved:true,derivativeUseAllowed:true,visualObservations:['产品展示'],segments:[{start:0,end:8}]};
  const asset={id:'replacement',sourceId:'replacement',type:'video',name:'产品展示',duration:8,contentHash:sha,
   localPath:replacementPath,url:replacementPath,visualObservations:['产品展示'],scriptAnalysis:analysis,
   segments:[{id:analysis.shots[0]!.segmentId,start:0,end:8}]};
  const repository={...f.repository,materialLibrary:async()=>({status:'ready',items:[material]} as any)};
  const preview=await previewSocialSceneReworkAdmission(f.input);
  assert.deepEqual(preview.gaps,[]);
  const admitted=await admitSocialSceneRework({...f.input,expectedPreviewHash:preview.previewHash});
  const job=admitted.job,expiry=new Date(Date.now()+180000).toISOString();
  Object.assign(job,{status:'running',workerId:'worker',leaseExpiresAt:expiry});
  Object.assign(f.tables.content_execution_jobs!.find(row=>row.id===job.id)!,{status:'running',worker_id:'worker',lease_expires_at:expiry});
  (f.tables.durable_operation_leases??=[]).push({id:'live',tenant_id:'t',lease_scope:'content_execution_job',subject_id:job.id,
   owner_id:'worker',lease_token:'secret',expires_at:expiry});
  let calls=0;const input={repository,job,outputDirectory:f.local+'.rework',materialPorts:{
   readTaskDetail:async()=>({brief:{productRef:null,productionMode:'social_ready'},sources:[],theme:null}) as any,
   loadProductionAssets:async()=>{calls++;return [asset] as any;}},ports:{assertBudget:async()=>{},
   adapters:async()=>existingAssetSupplyAdapters(),persistOutput:async()=>{throw Error('unexpected output');},
   render:async()=>({ok:false,error:'intentional'})}};
  await assert.rejects(runSocialSceneReworkJob(input),/scene_rework_render_failed/);
  const row=f.tables.starter_social_scene_rework_intents![0]!, checkpoint=row.execution as any;
  assert.equal(checkpoint.materialSelection.frozen['scene-cta'].sourceRef,'replacement');
  assert.equal(checkpoint.supply.execution.shots.find((shot:any)=>shot.sceneId==='scene-cta').sourceRef,'replacement');
  assert.equal(calls,1);
  await assert.rejects(runSocialSceneReworkJob(input),/scene_rework_render_failed/);
  assert.equal(calls,2);
  const outputs=new Map<string,Buffer>();
  const backendFilePort={attach:async(a:any)=>{outputs.set(a.recordId,await readFile(a.path));return a.name;},
   fetch:async(a:any)=>{const buf=outputs.get(a.recordId);return buf?{buf,contentType:'video/mp4'}:null;}};
  const task=f.tables.starter_social_content_tasks![0]!;
  delete (task.brief as Record<string,unknown>)._weeklyAuthority;
  Object.assign(task.brief as Record<string,unknown>,{programRef:{objectType:'social_program',id:'p',version:'1'},
   title:'产品视频',objective:'局部重新匹配',markets:[],languages:['zh'],platforms:['tiktok'],formats:['video'],restrictions:[],requestedOutputCount:1});
  Object.assign(task,{status:'producing',source_count:0,knowledge_source_count:0,material_source_count:0,artifact_count:1,
   approved_artifact_count:1,delivery_package_count:0,publication_count:0,metric_submission_count:0,
   package_selection:['industry_launch','content_rocket','task_express'].map(kind=>({kind,packageKey:kind,version:'1',name:kind})),
   version:'1',created_at:'2026-10-01T00:00:00.000Z',updated_at:'2026-10-01T00:00:00.000Z'});
  const outputPath=f.local+'.rework-output.mp4';
  const rendered=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=128x128:r=24:d=6',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6','-shortest','-c:v','libx264',
   '-c:a','aac','-pix_fmt','yuv420p',outputPath]);assert.equal(rendered.ok,true,rendered.stderr);
  (input.ports as any).render=async()=>({ok:true,outputPath});
  (input.ports as any).inspectVisuals=async()=>({passed:true,failures:[],metrics:{sampleCount:2},evidenceFrames:[]});
  (input.ports as any).inspectScenes=async()=>({passed:true,issues:[],checkedScenes:2});
  (input.ports as any).runFfmpeg=async()=>({ok:true,stderr:''});
  input.ports.persistOutput=createSocialSceneReworkOutputPort({repository,backendFilePort,
   accessResolver:{resolve:async()=>({kind:'subscription',subscription:{status:'active',plan:'customer',expiresAt:null}})} as any}) as any;
  const result=await runSocialSceneReworkJob(input);
  const child=await f.service.readCache({tenantId:'t',taskId:'content',runId:job.runId,parentArtifactId:result.artifactId});
  assert.equal(child.plan.shots.find(shot=>shot.shotId==='scene-cta')!.sourceRefs[0],'replacement');
  await verifyStoredSceneReworkMeasuredVoice(repository,child.cache);
  f.tables.workflow_runs!.find(row=>row.id===job.runId)!.status='succeeded';
  const nextInput={...f.input,sourceRunId:job.runId,parentArtifactId:result.artifactId};
  const next=await previewSocialSceneReworkAdmission(nextInput);
  assert.deepEqual(next.gaps,[]);
  const nextAdmitted=await admitSocialSceneRework({...nextInput,expectedPreviewHash:next.previewHash});
  assert.equal(nextAdmitted.intent.sourceRunId,job.runId);
  f.tables.workflow_runs!.find(row=>row.id===job.runId)!.status='running';
  await rm(outputPath,{force:true});
  await writeFile(replacementPath,'changed bytes');
  await assert.rejects(runSocialSceneReworkJob(input),/voice_bytes_changed|scene_rework_parent_bytes|media_hash_changed|awaiting_theme_material/);
  await rm(replacementPath,{force:true});
 }finally{await f.cleanup();}
});
