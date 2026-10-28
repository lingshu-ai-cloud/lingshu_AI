import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildLocalMaterialSegmentProfile} from '../../shared/contracts/localMaterialSegmentProfile.js';
import {normalizeSceneVisualContract} from '../../shared/sceneVisualContract.js';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {themeMaterialRoutingRequests} from './socialContentThemeMaterialRouting.js';
import {prepareMeasuredLocalMaterialSupply, type MeasuredLocalMaterialSupplyInput} from './socialContentMeasuredMaterialPreparation.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import type {SocialWorkflowMaterialClipCandidate} from './socialContentRecords.js';
import type {SocialProductionAsset} from './socialContentProductionPlan.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';

function candidate(assetId: string, seconds: number): SocialWorkflowMaterialClipCandidate {
  const sourceRevision = createHash('sha256').update(`owned:${assetId}`).digest('hex');
  const visualContract = normalizeSceneVisualContract({subjects: ['product'], productPolicy: 'open'});
  const {profile} = buildLocalMaterialSegmentProfile({tenantId: 'tenant', sourceTenantId: 'tenant', assetId,
    segmentId: 'segment', sourceRevision, origin: 'my_materials', mediaType: 'video', synthetic: false,
    productId: null, productRef: null, startSeconds: 0, endSeconds: seconds, materialType: 'product',
    materialRoles: ['product'], visualContract, rightsEvidenceRefs: ['rights'], commercialUseApproved: true,
    commercialUseApprovalEvidenceRefs: ['rights'], derivativeUseAllowed: true, modelInputAllowed: false,
    confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true});
  return {assetId, sourceRef: assetId, segmentId: 'segment', sourceRevision, origin: 'my_materials',
    mediaType: 'video', productRef: null, materialRoles: ['product'], visualContract,
    timeRange: {startSeconds: 0, endSeconds: seconds}, matchScore: 1, segmentProfile: profile} as SocialWorkflowMaterialClipCandidate;
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'measured-local-'));
  const media = async (id: string, duration: number): Promise<SocialProductionAsset> => {
    const localPath = path.join(directory, `${id}.mp4`), bytes = Buffer.from(`owned:${id}`);
    await fs.writeFile(localPath, bytes);
    return {id, sourceId: id, name: id, type: 'video', duration, url: localPath, localPath,
      contentHash: createHash('sha256').update(bytes).digest('hex'), visualObservations: ['产品主题'],
      segments: [{id: 'segment', start: 0, end: duration}]};
  };
  const originalAsset = await media('short', 3);
  const plan = createSocialAssetSupplyPlan({creationMode: 'viral_replication', productionApproach: 'ai_enhanced',
    materialRoutingPolicyVersion: 'type-aware.v3', inventory: {customerVideoIds: ['short']},
    shots: themeMaterialRoutingRequests({tenantId: 'tenant', candidates: [candidate('short', 3)], productRef: null,
      shots: [{shotId: 'slot', function: 'value', materialType: 'product', plannedDurationSeconds: 2}]})});
  const input: MeasuredLocalMaterialSupplyInput = {repository: {} as MeasuredLocalMaterialSupplyInput['repository'],
    tenantId: 'tenant', taskId: 'task', runId: 'run', plan,
    baseline: {schemaVersion: 'social-content-script-baseline.v1', scenes: [{sceneId: 'slot', shotFunction: 'value',
      subject: '', action: '', narration: '介绍产品', voiceover: '介绍产品'}]} as StoredSocialScriptBaseline,
    timeline: [{shotId: 'slot', start: 0, end: 3, timingSource: 'measured_boundary', anchorStart: 0, anchorEnd: 3}],
    voiceSha256: 'a'.repeat(64), materialCandidates: [candidate('short', 3)], availableAssets: [originalAsset],
    outputDirectory: directory, sources: [], productRef: null, themeId: null, productionMode: 'social_ready'};
  return {directory, input, media};
}

test('measured local supply extends a verified window without rewriting frozen source or calling loader', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.input.plan);
    f.input.loadProductionAssets = async () => {throw Error('unexpected material load');};
    const result = await prepareMeasuredLocalMaterialSupply(f.input);
    assert.deepEqual(f.input.plan, original);
    assert.equal(result.effectivePlan.shots[0]!.selectedMaterialSegment!.endSeconds, 3);
    assert.deepEqual(result.sourceResult.assets[0]!.selectedSourceWindow, {startSeconds: 0, endSeconds: 3});
    assert.equal(result.sourceResult.execution.shots[0]!.providerId, 'existing_customer_asset.v1');
    assert.equal(result.evidence.sourceBytes[0]!.sha256, f.input.availableAssets[0]!.contentHash);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('longer measured slot loads only the selected matching replacement and preserves its source proof', async () => {
  const f = await fixture();
  try {
    const replacement = await f.media('long', 8);
    f.input.timeline[0]!.end = 6; f.input.timeline[0]!.anchorEnd = 6;
    f.input.materialCandidates.push(candidate('long', 8));
    let calls = 0;
    f.input.loadProductionAssets = async input => {calls++; assert.deepEqual(input.requiredMaterialIds, ['long']);
      assert.equal(input.allowAuthorizedSharedLibrary, false); assert.equal(input.selectedMaterialSegments![0]!.endSeconds, 6);
      return [replacement];};
    const result = await prepareMeasuredLocalMaterialSupply(f.input);
    assert.equal(calls, 1);
    assert.equal(result.sourceResult.execution.shots[0]!.sourceRef, 'long');
    assert.deepEqual(result.sourceResult.assets[0]!.selectedSourceWindow, {startSeconds: 0, endSeconds: 6});
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('a changed physical file is never accepted on recovery', async () => {
  const f = await fixture();
  try {
    await prepareMeasuredLocalMaterialSupply(f.input);
    await fs.writeFile(f.input.availableAssets[0]!.localPath!, 'changed bytes');
    await assert.rejects(prepareMeasuredLocalMaterialSupply(f.input), /user_input_required:awaiting_theme_material:slot/);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('missing matching footage persists detailed blocked evidence before surfacing user intervention', async () => {
  const f = await fixture();
  try {
    f.input.timeline[0]!.end = 5; f.input.timeline[0]!.anchorEnd = 5;
    let saved: {checkpoints: Record<string, {payload: {status: string; pending: Array<{shotId: string; requiredSeconds: number}>}}>};
    await runWithContentExecutionContext({jobId: 'job', dataStore: {update: async (_table: string, _id: string, patch: typeof saved) => {saved = patch; return {id: 'job'};}} as never, action: async () => {
      await assert.rejects(prepareMeasuredLocalMaterialSupply(f.input), /awaiting_theme_material:slot/);
      const checkpoint = saved!.checkpoints['social.measured_local_materials']!.payload;
      assert.equal(checkpoint.status, 'blocked');
      assert.deepEqual(checkpoint.pending.map(row => [row.shotId, row.requiredSeconds]), [['slot', 5]]);
    }});
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('current rights rejection invalidates a prior completed local match', async () => {
  const f = await fixture();
  try {
    await prepareMeasuredLocalMaterialSupply(f.input);
    const current = f.input.materialCandidates[0]!;
    current.segmentProfile = {...current.segmentProfile!, rejectionReasons: ['rights_evidence_missing']};
    await assert.rejects(prepareMeasuredLocalMaterialSupply(f.input), /awaiting_theme_material:slot/);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('stale but internally consistent loaded bytes cannot impersonate the current candidate revision', async () => {
  const f = await fixture();
  try {
    const current = f.input.materialCandidates[0]!;
    current.sourceRevision = 'b'.repeat(64);
    current.segmentProfile = {...current.segmentProfile!, sourceRevision: current.sourceRevision};
    let reloads = 0;
    f.input.loadProductionAssets = async () => {reloads++; return f.input.availableAssets;};
    await assert.rejects(prepareMeasuredLocalMaterialSupply(f.input), /awaiting_theme_material:slot/);
    assert.equal(reloads, 1);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('one replacement load failure still checkpoints the other ready slot for recovery', async () => {
  const f = await fixture();
  try {
    const second = structuredClone(f.input.plan.shots[0]!);
    second.shotId = 'second';
    second.sourceRefs = ['long'];
    second.selectedMaterialSegment = {...second.selectedMaterialSegment!, sourceRef: 'long'};
    second.materialRouting!.localMatch.sourceRefs = ['long'];
    f.input.plan.shots.push(second);
    f.input.baseline.scenes.push({...f.input.baseline.scenes[0]!, sceneId: 'second'});
    f.input.timeline.push({shotId: 'second', start: 3, end: 7, timingSource: 'measured_boundary', anchorStart: 3, anchorEnd: 7});
    f.input.materialCandidates.push(candidate('long', 8));
    f.input.loadProductionAssets = async () => {throw Error('material temporarily unavailable');};
    let payload: {status: string; pending: Array<{shotId: string; reason: string}>; sourceResult: {execution: {shots: Array<{sceneId: string}>}}} | undefined;
    await runWithContentExecutionContext({jobId: 'job', dataStore: {update: async (_table: string, _id: string,
      patch: {checkpoints: Record<string, {payload: typeof payload}>}) => {
      payload = patch.checkpoints['social.measured_local_materials']!.payload; return {id: 'job'};
    }} as never, action: async () => {
      await assert.rejects(prepareMeasuredLocalMaterialSupply(f.input), /awaiting_theme_material:second/);
      assert.equal(payload!.status, 'blocked');
      assert.deepEqual(payload!.sourceResult.execution.shots.map(row => row.sceneId), ['slot']);
      assert.equal(payload!.pending[0]!.reason, 'material temporarily unavailable');
    }});
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});

test('derived source result replaces local receipts and retains other source results in original order', async () => {
  const f = await fixture();
  try {
    const initial = await prepareMeasuredLocalMaterialSupply(f.input);
    const external = structuredClone(f.input.plan.shots[0]!);
    external.shotId = 'other'; external.sourceStrategy = 'motion_graphics';
    delete external.materialRouting;
    f.input.plan.shots.unshift(external);
    f.input.baseline.scenes.unshift({...f.input.baseline.scenes[0]!, sceneId: 'other'});
    f.input.timeline = [
      {shotId: 'other', start: 0, end: 2, timingSource: 'measured_boundary', anchorStart: 0, anchorEnd: 2},
      {shotId: 'slot', start: 2, end: 5, timingSource: 'measured_boundary', anchorStart: 2, anchorEnd: 5}];
    const otherAsset = await f.media('generated-other', 2);
    const otherReceipt = {...initial.sourceResult.execution.shots[0]!, sceneId: 'other', shotId: 'other',
      assetId: otherAsset.id, sourceStrategy: 'motion_graphics' as const, providerId: 'historical-real-provider'};
    f.input.sourceResult = {...initial.sourceResult, assets: [otherAsset, ...initial.sourceResult.assets],
      execution: {...initial.sourceResult.execution, shots: [otherReceipt, ...initial.sourceResult.execution.shots]}};
    const originalSource = structuredClone(f.input.sourceResult);
    const next = await prepareMeasuredLocalMaterialSupply(f.input);
    assert.deepEqual(next.sourceResult.execution.shots.map(row => row.sceneId), ['other', 'slot']);
    assert.deepEqual(next.sourceResult.execution.shots[0], otherReceipt);
    assert.equal(next.sourceResult.assets.some(asset => asset.id === otherAsset.id), true);
    assert.deepEqual(f.input.sourceResult, originalSource);
  } finally {await fs.rm(f.directory, {recursive: true, force: true});}
});
