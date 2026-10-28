import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {themeMaterialRoutingRequests} from './socialContentThemeMaterialRouting.js';
import {buildSocialWorkflowMaterialCandidates} from './socialContentRecordProjection.js';
import {prepareMeasuredMaterialForExecution} from './socialContentMeasuredMaterialExecution.js';
import {mapMeasuredSceneTimeline} from './socialContentMeasuredSceneTimeline.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import {MATERIAL_RECOVERY_STAGE, materialRecoveryScopeHash} from './socialContentMaterialRecovery.js';
import {socialRequestHash} from './socialContentValidation.js';
import {buildSocialProductionPlan, type SocialProductionAsset} from './socialContentProductionPlan.js';
import {buildSocialDirectorPlan, socialDirectorContentHandoff, socialDirectorRenderTimeline} from './socialContentDirectorPlan.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
import type {PreparedWholeVoice} from './socialContentPreparedWholeVoice.js';
import type {MaterialRecord} from '../lib/materialLibrary.js';
import {prepareSceneReworkMaterial} from './socialContentSceneReworkMaterialExecution.js';

type WrapperInput = Parameters<typeof prepareMeasuredMaterialForExecution>[0];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'measured-material-entry-'));
  const createdAt = '2026-10-28T00:00:00.000Z';
  const media = async (id: string, duration: number) => {
    const localPath = path.join(directory, `${id}.mp4`);
    execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `color=c=blue:s=160x120:r=10:d=${duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', localPath]);
    const contentHash = hash(await fs.readFile(localPath));
    const analysis = buildMaterialScriptAnalysis({materialId: id, name: '产品展示', sourceRevision: contentHash,
      duration, segments: [{start: 0, end: duration, observedFacts: '产品展示', subject: '产品',
        confidence: .95}], visualObservations: ['产品展示']});
    const record: MaterialRecord = {id, type: 'video', tenantId: 'fixture', name: '产品展示', duration,
      sourceRevision: contentHash, scriptAnalysis: analysis, materialRoles: ['product'],
      rightsStatus: 'owned', rightsEvidenceRef: `ownership:${id}`, commercialUseApproved: true,
      derivativeUseAllowed: true, visualObservations: ['产品展示'], segments: [{start: 0, end: duration}]};
    const asset: SocialProductionAsset = {id, sourceId: id, type: 'video', name: '产品展示', duration,
      contentHash, localPath, url: localPath, visualObservations: ['产品展示'],
      segments: [{id: analysis.shots[0]!.segmentId, start: 0, end: duration}]};
    return {record, asset};
  };
  const short = await media('short', 3), long = await media('long', 6);
  const sourceTiming = {startSeconds: 0, endSeconds: 2, durationSeconds: 2};
  const baseline: StoredSocialScriptBaseline = {schemaVersion: 'social-content-script-baseline.v1', version: '1',
    source: 'inspiration_script', formulaReference: null, themeId: 'product_value', language: 'en',
    lockedAt: createdAt, createdBeforeMaterialAdaptation: true,
    scenes: [{sceneId: 'slot', formulaNodeId: null, shotFunction: 'value', subject: '产品', action: '展示',
      script: '展示产品', narration: 'Hello product.', voiceover: 'Hello product.', caption: 'Hello product.',
      referenceStructure: {sourceTiming, shotScale: '中景', cameraMovement: '固定镜头', pace: '紧凑', transition: '自然衔接'}}]};
  const scenes = [{sceneId: 'slot', order: 1, referenceShotId: 'reference-slot', targetVisual: '产品展示',
    audioLayers: {voiceover: 'Hello product.'}, duration: {...sourceTiming, targetSeconds: 2}}] as unknown as WrapperInput['scenes'];
  const candidates = buildSocialWorkflowMaterialCandidates({records: [short.record], tenantId: 'fixture',
    themeOnly: true, deferVideoSkuFilter: true, voiceoverRows: [{cueId: 'slot', text: 'Hello product.'}]}).candidates;
  assert.equal(candidates.length, 1, 'real material builder must admit the initial authorized product segment');
  const plan = createSocialAssetSupplyPlan({creationMode: 'viral_replication', productionApproach: 'ai_enhanced',
    materialRoutingPolicyVersion: 'type-aware.v3', inventory: {customerVideoIds: ['short']},
    shots: themeMaterialRoutingRequests({tenantId: 'fixture', productRef: null, candidates,
      shots: [{shotId: 'slot', function: 'value', materialType: 'product', plannedDurationSeconds: 2}]})});
  const scope = {tenantId: 'fixture', taskId: 'task', runId: 'run', planHash: 'a'.repeat(64)};
  const audioFile = path.join(directory, 'whole.wav');
  execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=24000:duration=4', '-ac', '1', '-c:a', 'pcm_s16le', audioFile]);
  const wholeTrackSha256 = hash(await fs.readFile(audioFile));
  const source = path.join(directory, 'source.json'), alignment = path.join(directory, 'alignment.json');
  const receiptRef = path.join(directory, 'prepared.json');
  const nativeVoice = {provider: 'heygen', model: 'avatar_iv', physicalVoiceId: 'original'};
  await fs.writeFile(source, JSON.stringify({scope, ...nativeVoice, voiceId: 'original', operationId: 'paid-original'}));
  const cues = [{start: 0, end: 4, text: 'Hello product.'}];
  await fs.writeFile(alignment, JSON.stringify({state: 'completed', scope: {audioSha256: wholeTrackSha256},
    source: 'heygen_native_subtitles', precision: 'phrase', independentAsr: false, sourceReceiptRef: source,
    sourceReceiptSha256: hash(await fs.readFile(source)), result: {transcripts: [{text: 'Hello product.',
      sentences: [{text: 'Hello product.', begin_time: 0, end_time: 4000}]}]}}));
  const originalScenes = [{shotId: 'slot', spokenText: 'Hello product.', ...sourceTiming}];
  const timeline = mapMeasuredSceneTimeline({scenes: originalScenes, cues, durationSeconds: 4});
  const voice = {ok: true, localPath: audioFile, url: audioFile, duration: 4, cues};
  const proof = {sourceReceiptRefs: [source], alignmentReceiptRef: alignment, nativeVoice};
  const prepared = {voice, inputHash: 'prepared-input', receiptRef, wholeTrackSha256, ...proof,
    timingPolicy: 'voice-driven-slots.v1', measuredSceneTimeline: timeline} as PreparedWholeVoice;
  await fs.writeFile(receiptRef, JSON.stringify({status: 'completed', inputHash: prepared.inputHash, scope,
    voice, wholeTrackSha256, scenes: originalScenes, proof, voiceDriven: true, measuredTimeline: timeline}));
  let inventoryReads = 0, loads = 0;
  const input: WrapperInput = {execution: {tenantId: 'fixture', userId: 'owner', taskId: 'task', runId: 'run',
    repository: {materialLibrary: async () => {inventoryReads++; return {status: 'ready', items: [short.record, long.record]};}},
    runtime: {loadProductionAssets: async (request: {requiredMaterialIds?: string[]}) => {
      loads++; assert.deepEqual(request.requiredMaterialIds, ['long']); return [long.asset];
    }}} as unknown as WrapperInput['execution'],
    detail: {brief: {materialRoutingPolicyVersion: 'type-aware.v3', productionMode: 'social_ready', productRef: null},
      sources: [], theme: {themeId: 'product_value'}} as unknown as WrapperInput['detail'],
    budget: {status: 'reserved', scope, maximumCny: 15, paidCny: 1} as unknown as WrapperInput['budget'],
    plan, baseline, scenes, prepared, assets: [short.asset], sourceResult: null, outputDirectory: directory};
  return {directory, input, short, long, timeline, createdAt, counts: () => ({inventoryReads, loads})};
}

test('normal measured-material entry validates real voice receipts and routes a longer local file into the exact timeline', async () => {
  const f = await fixture();
  try {
    const originalPlan = structuredClone(f.input.plan), originalBudget = structuredClone(f.input.budget);
    const result = await prepareMeasuredMaterialForExecution(f.input);
    assert.ok(result);
    assert.deepEqual(f.counts(), {inventoryReads: 1, loads: 1});
    assert.equal(result.sourceResult.execution.shots[0]!.sourceRef, 'long');
    assert.equal(result.sourceResult.execution.shots[0]!.providerId, 'existing_customer_asset.v1');
    assert.deepEqual(result.sourceResult.assets[0]!.selectedSourceWindow, {startSeconds: 0, endSeconds: 4});
    assert.equal(result.evidence.sourceBytes[0]!.sha256, f.long.asset.contentHash);
    assert.deepEqual(f.input.plan, originalPlan);
    assert.deepEqual(f.input.budget, originalBudget);
    const plan = buildSocialProductionPlan({baseline: f.input.baseline, assets: result.assets,
      measuredSceneTimeline: f.timeline, routedSceneAssets: result.sourceResult.execution.shots.map(shot =>
        ({sceneId: shot.sceneId, assetId: shot.assetId}))});
    assert.equal(plan.ok, true, plan.message);
    assert.equal(plan.maxDuration, 4);
    assert.equal(plan.scenes[0]!.clip.end - plan.scenes[0]!.clip.start, 4);
    const director = buildSocialDirectorPlan({taskId: 'task', baseline: f.input.baseline, productionPlan: plan,
      productionAssets: result.assets, outputSpec: {aspectRatio: '9:16', resolution: '720p'}, createdAt: f.createdAt,
      bgmSelection: {primary: {trackId: 'builtin-tech-pulse', name: '曲库配乐', mood: '稳定',
        authorization: {status: 'authorized', basis: 'lingshu_builtin_library', license: '内置商用曲库',
          evidence: 'authenticated_catalog:builtin-tech-pulse'}}, fallbacks: [],
        fallbackPolicy: 'ordered_preapproved_tracks_only', volume: 18}});
    const handoff = socialDirectorContentHandoff(director);
    const timeline = socialDirectorRenderTimeline(handoff, 4, f.input.prepared!.voice.cues, false, true);
    assert.deepEqual(timeline.map(row => [row.targetStart, row.targetEnd, row.targetDuration]), [[0, 4, 4]]);
    assert.deepEqual(f.input.baseline.scenes[0]!.referenceStructure!.sourceTiming,
      {startSeconds: 0, endSeconds: 2, durationSeconds: 2});
    const legacyPlan = buildSocialProductionPlan({baseline: f.input.baseline, assets: result.assets,
      routedSceneAssets: result.sourceResult.execution.shots.map(shot =>
        ({sceneId: shot.sceneId, assetId: shot.assetId}))});
    const legacyDirector = buildSocialDirectorPlan({taskId: 'task', baseline: f.input.baseline,
      productionPlan: legacyPlan, productionAssets: result.assets, outputSpec: director.outputSpec,
      createdAt: f.createdAt, bgmSelection: director.bgmSelection});
    assert.equal(legacyDirector.qualityGates.find(gate => gate.gateId === 'material_coverage')!.status, 'blocked');
    assert.throws(() => socialDirectorContentHandoff(legacyDirector), /director_plan_not_ready/);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('rework freezes the actual replacement, rejects changed bytes or rights on recovery', async () => {
  const f = await fixture();
  try {
    const proof={prepared:f.input.prepared!,scope:(f.input.budget as any).scope,scenes:f.input.scenes};
    const cache={tenantId:'fixture',taskId:'task',runId:'run',measuredVoiceProof:proof,
      scenes:[{sceneId:'slot',result:{sourceRef:'short'}}],renderInput:{voice:{sha256:proof.prepared.wholeTrackSha256},
        manifest:{timeline:[{sceneId:'slot',targetStart:0,targetEnd:4}]}}};
    const context={cache,plan:f.input.plan,baseline:f.input.baseline,
      intent:{tenantId:'fixture',taskId:'task',sourceRunId:'run',executionRunId:'repair',affectedSceneIds:['slot']}} as any;
    const request={repository:{...f.input.execution.repository,dataStore:{} as any},context,outputDirectory:f.directory,
      readTaskDetail:async()=>({...f.input.detail,sources:[]}) as any,
      loadProductionAssets:async()=>[f.long.asset]};
    const first=await prepareSceneReworkMaterial(request);
    assert.equal(first!.frozen.slot!.sourceRef,'long');
    assert.deepEqual(first!.assets.find(asset=>asset.id==='long')!.localPath,f.long.asset.localPath);
    const recovered=await prepareSceneReworkMaterial({...request,frozen:first!.frozen});
    assert.deepEqual(recovered!.frozen,first!.frozen);
    const originalBytes=await fs.readFile(f.long.asset.localPath!);
    await fs.appendFile(f.long.asset.localPath!,'changed');
    await assert.rejects(prepareSceneReworkMaterial({...request,frozen:first!.frozen}),/awaiting_theme_material/);
    await fs.writeFile(f.long.asset.localPath!,originalBytes);
    f.long.record.commercialUseApproved=false;
    await assert.rejects(prepareSceneReworkMaterial({...request,frozen:first!.frozen}),/awaiting_theme_material|selection_changed/);
  } finally {await fs.rm(f.directory,{recursive:true,force:true});}
});

test('normal measured-material entry rejects altered voice evidence before inventory or file loading', async () => {
  const f = await fixture();
  try {
    await fs.appendFile(f.input.prepared!.voice.localPath, 'changed');
    await assert.rejects(prepareMeasuredMaterialForExecution(f.input), /prepared_whole_voice_bytes_changed/);
    assert.deepEqual(f.counts(), {inventoryReads: 0, loads: 0});
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('worker enforces the persisted user selection and blocks if it cannot fill the measured slot', async () => {
  const f = await fixture();
  try {
    const selection = (materialId: string) => ({version: '1', inputHash: materialRecoveryScopeHash('fixture', 'task', 'run'),
      updatedAt: '2026-10-28T00:00:00.000Z', payload: {tenantId: 'fixture', taskId: 'task', runId: 'run',
        selections: {slot: {materialId, originalPlanHash: socialRequestHash(f.input.plan), phase: 'measured' as const,
          sourceRevision: materialId === 'short' ? f.short.record.sourceRevision : f.long.record.sourceRevision}}}});
    const run = (materialId: string) => runWithContentExecutionContext({jobId: 'job',
      dataStore: {update: async () => ({id: 'job'})} as never, checkpoints: {[MATERIAL_RECOVERY_STAGE]: selection(materialId)},
      action: () => prepareMeasuredMaterialForExecution(f.input)});
    await assert.rejects(run('short'), /awaiting_theme_material:slot/);
    assert.equal(f.counts().loads, 0, 'must not silently use the eligible long material');
    const result = await run('long');
    assert.equal(result!.sourceResult.execution.shots[0]!.sourceRef, 'long');
    assert.equal(f.counts().loads, 1);
    const corrupted = {...selection('long'), inputHash: 'wrong'};
    await assert.rejects(runWithContentExecutionContext({jobId: 'job',
      dataStore: {update: async () => ({id: 'job'})} as never, checkpoints: {[MATERIAL_RECOVERY_STAGE]: corrupted},
      action: () => prepareMeasuredMaterialForExecution(f.input)}), /content_execution_checkpoint_mismatch/);
    f.long.record.rightsStatus = 'unknown'; f.long.record.commercialUseApproved = false;
    f.long.record.derivativeUseAllowed = false;
    await assert.rejects(run('long'), /awaiting_theme_material:slot/);
    f.long.record.rightsStatus = 'owned'; f.long.record.commercialUseApproved = true;
    f.long.record.derivativeUseAllowed = true;
    assert.ok(f.long.asset.localPath);
    await fs.appendFile(f.long.asset.localPath, 'changed');
    await assert.rejects(run('long'), /awaiting_theme_material:slot/);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});
