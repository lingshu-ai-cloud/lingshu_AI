import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { LangGraphTestStore } from './langgraphTestStore.js';
import { buildMaterialScriptAnalysis } from '../shared/materialScriptAnalysis.js';
import { normalizeSceneVisualContract } from '../shared/sceneVisualContract.js';
import { paidProductionHash, type PaidStageRequirement } from '../server/starter198/socialContentPaidOperationPlan.js';
import { parseStoredSocialScriptBaseline } from '../server/starter198/socialContentScriptBaseline.js';
import type { MaterialRecord } from '../server/lib/materialLibrary.js';

test('actual local media production through graph stages retains real QA and canonical human review', { timeout: 180_000, skip: process.platform !== 'darwin' ? 'controlled speech fixture requires macOS /usr/bin/say' : false }, async t => {
  const cwd = process.cwd(), root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'langgraph-local-production-')));
  const keys = ['NODE_ENV', 'SOCIAL_CONTENT_FORCE_BACKEND_FILES', 'OBJECT_STORAGE_DRIVER', 'DISABLE_LOCAL_AUTH_FALLBACK', 'PB_URL', 'DASHSCOPE_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_API_TOKEN'];
  const prior = new Map(keys.map(key => [key, process.env[key]]));
  t.after(async () => { process.chdir(cwd); for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); });
  process.chdir(root); process.env.NODE_ENV = 'test'; process.env.SOCIAL_CONTENT_FORCE_BACKEND_FILES = 'false'; process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false'; process.env.PB_URL = 'http://127.0.0.1:1';
  for (const key of ['DASHSCOPE_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_API_TOKEN']) delete process.env[key];
  const [{ createStarter198Repository, STARTER_COLLECTIONS }, { STARTER_198_CAPABILITIES }, { createSocialContentTask, startSocialContentTask }, { parseCreateSocialTask }, { readSocialTaskDetail }, { CONTENT_GRAPH_VERSION }, context, { decideSocialContentArtifact }] = await Promise.all([
    import('../server/starter198/repository.js'), import('../shared/contracts/starter198.js'), import('../server/starter198/socialContentTasks.js'), import('../server/starter198/socialContentValidation.js'), import('../server/starter198/socialContentRecords.js'), import('../server/contentExecution/langgraphIdentity.js'), import('../server/contentExecution/context.js'), import('../server/starter198/socialContentOutputs.js'),
  ]);
  const materials: MaterialRecord[] = [];
  const store = new LangGraphTestStore(path.join(root, 'business.json')), repository = createStarter198Repository(store,{materialLibrary:async()=>({items:materials,status:'ready'})});
  const tenantId = 'langgraph-local-tenant', userId = 'local-human-reviewer', now = new Date();
  await store.create(STARTER_COLLECTIONS.access, { tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1', entitlement_snapshot_id: 'local-entitlement', feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })), resource_limits: (await import('../server/starter198/provisioning.js')).STARTER_198_DEFAULT_LIMITS, status: 'active', cycle_started_at: new Date(now.getTime() - 86_400_000).toISOString(), cycle_ends_at: new Date(now.getTime() + 86_400_000).toISOString(), updated_at: now.toISOString() });
  const created = await createSocialContentTask({ repository, tenantId, userId, idempotencyKey: 'langgraph-local-create', value: parseCreateSocialTask({ title: '实际本地视频链路', objective: '验证真实渲染与审核，不调用云供应商', mode: 'weekly', themeId: 'product_value',productRef:'SKU-1',languages:['zh'],platforms:['tiktok'],perItemBudgetCny:10 }) });
  const ffmpeg = (await import('ffmpeg-static')).default; assert.ok(ffmpeg);
  const stored=(await repository.list(STARTER_COLLECTIONS.socialContentTasks,tenantId,{where:{task_id:created.taskId},perPage:1})).items[0]!;
  const baseline=parseStoredSocialScriptBaseline(stored.script_baseline)!;
  const {MEDIA_ROOT}=await import('../server/starter198/socialContentProductionMaterials.js');
  const materialDirectory=path.join(MEDIA_ROOT,`local-capture-${path.basename(root)}`);
  await mkdir(materialDirectory,{recursive:true});
  t.after(()=>rm(materialDirectory,{recursive:true,force:true}));
  for(const scene of baseline.scenes){
    const file=path.join(materialDirectory,`${scene.sceneId}.mp4`),duration=4;
    await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=320x568:r=24','-t',String(duration),'-c:v','libx264','-pix_fmt','yuv420p','-y',file]);
    const type=/消费者|使用|试用|生活/.test(scene.action)?'person_usage':'product';
    const interaction=type==='person_usage'?'person_using_product':/手持|手握|拿/.test(scene.action)?'person_holding_product':'product_only_display';
    const visual=normalizeSceneVisualContract({subjects:interaction==='product_only_display'?['product']:['person','product'],interaction:{kind:interaction,description:scene.action},action:{path:scene.action},productRef:'SKU-1',productPolicy:'locked'});
    const analysis=buildMaterialScriptAnalysis({materialId:scene.sceneId,name:scene.subject,sourceRevision:'fixture-v1',duration,productRef:'SKU-1',segments:[{id:scene.sceneId,start:0,end:duration,confidence:.99,boundaryConfidence:.99,cleanEntry:true,cleanExit:true,subject:[scene.subject],action:scene.action,observedFacts:[scene.subject,scene.action,scene.voiceover,scene.narration],visualContract:visual}]});
    analysis.shots[0]!.visualContract=visual;analysis.shots[0]!.materialRoles=[type as never];
    materials.push({id:scene.sceneId,tenantId,type:'video',sourceType:'social_task_upload',name:scene.subject,url:`/media/${path.relative(MEDIA_ROOT,file)}`,file:path.relative(MEDIA_ROOT,file),duration,productRef:'SKU-1',productName:'SKU-1',sourceRevision:'fixture-v1',scriptAnalysis:analysis,visualObservations:[scene.subject,scene.action],segments:[{id:scene.sceneId,start:0,end:duration,confidence:.99,boundaryConfidence:.99,cleanEntry:true,cleanExit:true,subject:[scene.subject],action:scene.action,observedFacts:[scene.subject,scene.action,scene.voiceover,scene.narration],visualContract:visual}],rightsStatus:'owned',width:320,height:568,contentSha256:createHash('sha256').update(await readFile(file)).digest('hex'),commercialUseApproved:true,licenseEvidence:`fixture-owned:${scene.sceneId}`} as MaterialRecord);
  }
  assert.equal(created.brief.managementMode, 'one_click_managed', 'managed production must still require explicit human approval in graph mode');
  const preparedDetail=await readSocialTaskDetail({repository,tenantId,taskId:created.taskId});
  assert.equal(preparedDetail?.agentWorkflow?.executionPlanReview.approved,true,JSON.stringify({review:preparedDetail?.agentWorkflow?.executionPlanReview,candidates:(await import('../server/starter198/socialContentRecords.js')).buildSocialWorkflowMaterialCandidates({records:materials,tenantId,selectedProductRef:'SKU-1',voiceoverRows:[]})}));
  const queued: unknown[] = [];
  const started = await startSocialContentTask({ repository, tenantId, userId, taskId: created.taskId, expectedVersion: created.version, idempotencyKey: 'langgraph-local-start', orchestratorQueue: { enqueue: async input => { queued.push(input); return { queueItemId: 'local-orchestrator', runId: 'local-production-run' }; } } });
  assert.equal(started.status, 'producing'); assert.ok(started.runId); assert.equal(queued.length, 1);
  const runId = started.runId!;
  if (!await store.getById(STARTER_COLLECTIONS.runs, runId)) await store.create(STARTER_COLLECTIONS.runs, { id: runId, tenant_id: tenantId, status: 'running' });
  const { executeSocialProductionGraph, createSocialProductionExecutorCheckpoint, socialProductionExecutor, loadSocialProductionGraphApproval,socialProductionGraphInput } = await import('../server/starter198/socialContentProductionGraph.js');
  const { admitContentExecutionJob, readContentExecutionJob, controlContentExecutionJob } = await import('../server/contentExecution/durableQueue.js');
  const admitted = await admitContentExecutionJob({ dataStore: store, tenantId, userId, taskId: created.taskId, runId, taskType: 'social_content_test', initialCheckpoints: { 'social.executor': createSocialProductionExecutorCheckpoint(started, { SOCIAL_CONTENT_EXECUTOR: 'langgraph' }) } });
  await store.update('content_execution_jobs', admitted.id, { status: 'running' });
  const identity = { tenantId, taskId: created.taskId, runId, jobId: admitted.id, planVersion: started.version, inputHash: 'actual-local-production-frozen-plan', graphVersion: CONTENT_GRAPH_VERSION };
  const bgm = path.join(root, 'licensed-test-bgm.wav'); await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=24000', '-t', '60', '-y', bgm]);
  const voiceLines=baseline.scenes.map(scene=>(scene.voiceover||scene.narration||'').trim()).filter(Boolean);
  const preparedCues:Array<{start:number;end:number;text:string}>=[];
  const preparedPieces:string[]=[];let preparedDuration=0;
  for(const[index,scene]of started.agentWorkflow!.directorBrief.scenes.entries()){
    const text=baseline.scenes.find(item=>item.sceneId===scene.sceneId)?.voiceover||baseline.scenes.find(item=>item.sceneId===scene.sceneId)?.narration||'';
    const seconds=scene.duration.endSeconds-scene.duration.startSeconds;
    const spoken=path.join(root,`prepared-${index}.aiff`),piece=path.join(root,`prepared-${index}.wav`);
    await promisify(execFile)('/usr/bin/say',['-r','240','-o',spoken,text]);
    await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-i',spoken,'-af','apad','-t',String(seconds),'-ar','24000','-ac','1','-y',piece]);
    preparedCues.push({start:preparedDuration,end:preparedDuration+seconds,text});preparedDuration+=seconds;preparedPieces.push(piece);
  }
  await mkdir(path.join(root,'data/tts'),{recursive:true});
  const preparedAudio=path.join(root,'data/tts/spoken.wav');
  await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error',...preparedPieces.flatMap(piece=>['-i',piece]),'-filter_complex',`${preparedPieces.map((_,index)=>`[${index}:a]`).join('')}concat=n=${preparedPieces.length}:v=0:a=1[out]`,'-map','[out]','-y',preparedAudio]);
  const voiceSha=createHash('sha256').update(await readFile(preparedAudio)).digest('hex');
  const voiceReceipt=`controlled-local-voice:${voiceSha}`;
  const budgetScope={tenantId,taskId:created.taskId,runId,planHash:socialProductionGraphInput(started).inputHash};
  let capturedAssets:Awaited<ReturnType<typeof import('../server/starter198/socialContentProductionSupport.js').taskProductionAssets>>=[];
  const runtime = {
    loadProductionAssets:async(input:Parameters<typeof import('../server/starter198/socialContentProductionSupport.js').taskProductionAssets>[0])=>{
      const assets=await (await import('../server/starter198/socialContentProductionSupport.js')).taskProductionAssets(input);
      assert.equal(assets.length,baseline.scenes.length,JSON.stringify({assets:assets.map(asset=>asset.id),input}));
      capturedAssets=assets;
      return assets;
    },
    productionBudgetReadPorts:{
      readVoicePlan:async()=>({mode:'reuse' as const,lines:voiceLines,requiresClone:false,allowFallback:false,requiresAsr:false,reuseReceiptRef:voiceReceipt}),
      readVerifiedLocalExecution:async(requirement:PaidStageRequirement)=>{
        if(requirement.stage==='local_supply_selection'){
          const reader=(await import('../server/starter198/socialContentLocalSupplyBudgetProof.js')).createSocialContentLocalSupplyBudgetProofReader({scope:budgetScope,supplyPlan:started.assetSupplyPlan!,baseline,assets:capturedAssets,repository,assertCurrent:async()=>{assert.equal((await readContentExecutionJob(store,tenantId,created.taskId,runId))?.status,'running');}});
          const proof=await reader(requirement);
          assert.ok(proof,JSON.stringify({requirement,shot:started.assetSupplyPlan!.shots.find(shot=>shot.shotId===requirement.shotId),asset:capturedAssets.find(asset=>asset.id===requirement.shotId)}));
          return proof;
        }
        if(requirement.stage!=='render_audio_reuse'||requirement.sourceRef!==voiceReceipt)return null;
        assert.equal(requirement.text?.replace(/\s+/g,''),voiceLines.join('').replace(/\s+/g,''));
        assert.equal(createHash('sha256').update(await readFile(preparedAudio)).digest('hex'),voiceSha);
        return{kind:'existing_audio' as const,scopeHash:paidProductionHash(budgetScope),inputContractHash:requirement.inputContractHash,receiptRef:voiceReceipt,sourceSha256:voiceSha,sourceRef:preparedAudio};
      },
    },
    selectDirectorBgm: async () => ({ primary: { trackId: 'controlled-local-bgm', name: '本地合成测试配乐', mood: '平稳', authorization: { status: 'authorized' as const, basis: 'lingshu_builtin_library' as const, license: '受控验收测试', evidence: 'test:local-generated-tone' } }, fallbacks: [], fallbackPolicy: 'ordered_preapproved_tracks_only' as const, volume: 18 }),
    resolveBgm: async () => ({ id: 'controlled-local-bgm', url: bgm }),
    synthesizeVoice: async (input: { text: string; targetDuration?: number }) => {
      assert.equal(input.text.replace(/\s+/g,''),voiceLines.join('').replace(/\s+/g,''));
      return {ok:true,source:'controlled_local_system_voice_not_cloud',localPath:preparedAudio,duration:preparedDuration,text:input.text,cues:preparedCues};
    },
  };
  const run = async () => {
    const job = await readContentExecutionJob(store, tenantId, created.taskId, runId); assert.ok(job); assert.equal(socialProductionExecutor(job), 'langgraph');
    return context.runWithContentExecutionContext({ dataStore: store, jobId: job.id, checkpoints: job.checkpoints, providerReceipts: job.providerReceipts,
      action: () => executeSocialProductionGraph({ repository, dataStore: store, job, runtime }),
    });
  };
  const waiting = await run(); assert.equal(waiting.status, 'waiting_review');
  assert.equal((await store.list(STARTER_COLLECTIONS.socialDeliveryPackages)).totalItems, 0);
  const detail = await readSocialTaskDetail({ repository, tenantId, taskId: created.taskId }); assert.ok(detail);
  const artifact = detail.artifacts.find(item => item.kind === 'short_video'); assert.ok(artifact); assert.equal(artifact.status, 'review_required');
  assert.match(JSON.stringify(artifact.content), /actual_social_render/); assert.match(JSON.stringify(artifact.content), /technicalQualityReport/);
  const files = await store.list<Record<string, unknown>>(STARTER_COLLECTIONS.socialContentFiles, { where: { tenant_id: tenantId, task_id: created.taskId } });
  assert.ok(files.items.some(file => file.mime_type === 'video/mp4'), 'real archived MP4 required');
  const { readSocialContentFile } = await import('../server/starter198/socialContentFiles.js');
  for (const file of files.items) {
    const actual = await readSocialContentFile({ repository, tenantId, fileId: String(file.file_id) }); assert.ok(actual);
    const chunks: Uint8Array[] = [];
    if (actual.object) for await (const chunk of actual.object.body) chunks.push(chunk);
    const bytes = actual.localPath ? await readFile(actual.localPath) : actual.backend?.buf ?? Buffer.concat(chunks);
    assert.equal(bytes.length, Number(file.byte_size));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.content_sha256);
    if (file.mime_type === 'video/mp4') {
      const decode = path.join(root, `${String(file.file_id)}.mp4`); await (await import('node:fs/promises')).writeFile(decode, bytes);
      await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', decode, '-f', 'null', '-']);
    }
  }
  const decision = { repository, tenantId, userId, taskId: created.taskId, artifactId: artifact.artifactId, idempotencyKey: 'actual-human-local-review', value: { decision: 'approved' as const, expectedVersion: artifact.version, note: '受控本地验收：人工检查实际视频和检测报告' } };
  const approved = await decideSocialContentArtifact(decision); assert.equal(approved.artifact.status, 'approved');
  await decideSocialContentArtifact(decision);
  const reviewedJob = await readContentExecutionJob(store, tenantId, created.taskId, runId); assert.ok(reviewedJob);
  assert.ok(await loadSocialProductionGraphApproval(repository, reviewedJob));
  assert.equal((reviewedJob.checkpoints['runtime.pause']?.payload as { origin: string }).origin, 'workflow_review');
  const { resumeApprovedSocialProductionGraph } = await import('../server/starter198/socialContentProductionGraph.js');

  const changedSubject = structuredClone(reviewedJob);
  const changedPayload = changedSubject.checkpoints['social.graph_review']!.payload as Record<string, unknown>;
  changedPayload.contentHash = 'changed-artifact-content';
  await assert.rejects(loadSocialProductionGraphApproval(repository, changedSubject), /review_subject_changed/);
  const changedVersion = structuredClone(reviewedJob);
  (changedVersion.checkpoints['social.graph_review']!.payload as Record<string, unknown>).version = '999';
  await assert.rejects(loadSocialProductionGraphApproval(repository, changedVersion), /review_version_changed/);
  await assert.rejects(loadSocialProductionGraphApproval(repository, { ...reviewedJob, tenantId: 'other-tenant' }), /artifact_not_unique/);
  assert.equal(await resumeApprovedSocialProductionGraph({repository,tenantId,userId,taskId:created.taskId,artifactId:artifact.artifactId}),admitted.id,'canonical approval resume must update both job and business run');
  assert.equal((await run()).status, 'completed');
  assert.equal((await store.list(STARTER_COLLECTIONS.socialDeliveryPackages)).totalItems, 1);
  assert.equal((await run()).status, 'completed');
  assert.equal((await store.list(STARTER_COLLECTIONS.socialDeliveryPackages)).totalItems, 1);
  const { completeSocialContentGraphRun } = await import('../server/starter198/socialContentGraphCompletion.js');
  await store.update('content_execution_jobs', admitted.id, { status: 'succeeded' });
  const settled = await readContentExecutionJob(store, tenantId, created.taskId, runId); assert.ok(settled);
  const packages = await store.list<Record<string, unknown>>(STARTER_COLLECTIONS.socialDeliveryPackages);
  const prepared = packages.items[0]; assert.ok(prepared);
  await store.update(STARTER_COLLECTIONS.socialDeliveryPackages, String(prepared.id), { package_hash: 'corrupt-manifest-hash' });
  await assert.rejects(completeSocialContentGraphRun(repository, settled), /completion_delivery_invalid/);
  await store.update(STARTER_COLLECTIONS.socialDeliveryPackages, String(prepared.id), { package_hash: prepared.package_hash });
  assert.equal(await completeSocialContentGraphRun(repository, settled), true);
  assert.equal((await store.getById<Record<string, unknown>>(STARTER_COLLECTIONS.runs, runId))?.status, 'completed');
  const projected = JSON.stringify(await store.list(STARTER_COLLECTIONS.events));
  assert.equal(await completeSocialContentGraphRun(repository, settled), true);
  assert.equal(JSON.stringify(await store.list(STARTER_COLLECTIONS.events)), projected, 'replayed completion must not duplicate events');

});
