import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';

const legacyRoot = path.resolve('../local-preview-1002');
dotenv.config({ path: path.join(legacyRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(legacyRoot, '.env.local'), override: true, quiet: true });
if (process.env.PIPELINE3_PUBLIC_BASE_URL) process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL = process.env.PIPELINE3_PUBLIC_BASE_URL;
process.env.SEEDANCE_SENTENCE_RESOLUTION = '480p';

const tenantId = 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const sourceId = 'trend_videos_c9733f10519249eb92a9dbac5b8bc7e8';
const sourceFile = `tenants/${tenantId}/reference-videos/${sourceId}.mp4`;
const sourcePath = path.join('data/media', sourceFile);
const frameDriven = process.argv.includes('--frame-actions');
const requestId = frameDriven ? 'pipeline3-one-shot-20261009-v2-frame-actions' : 'pipeline3-one-shot-20261009-v1';
const root = path.resolve('data/acceptance/pipeline3-one-shot-20261009');
const stateFile = path.join(root, frameDriven ? 'state-frame-actions.json' : 'state.json');
fs.mkdirSync(root, { recursive: true });

const parse = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
const defaults = JSON.parse(fs.readFileSync('data/local-store/studio_production_defaults.json', 'utf8'));
const presenter = parse(defaults.find((row: any) => row.tenant_id === tenantId).payload).presenters
  .find((row: any) => row.id === 'presenter-f281e943169413c9b5525072');
const sourceMaterial: any = {
  id: sourceId,
  type: 'video',
  scope: 'own',
  tenantId,
  file: sourceFile,
  usage: 'analysis',
  verifyContentSha256: true,
  contentSha256: createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
};
const cue: any = {
  id: 'lighting-opening-shot-1',
  start: 0.08,
  end: 3.4,
  generationDurationSeconds: 4,
  originalText: 'Hello Boss!!',
  targetText: 'Hello boss! Need reliable indoor lighting?',
  personShot: true,
  shotIds: ['slot-1'],
  compositionClusterId: 'lighting-showroom-opening-medium',
  firstFrameSeconds: 0.08,
};
const state: any = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  : { requestId, state: 'preparing', providerTasks: {}, maxCostCny: 5, estimatedCostCny: 3.82 };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

if (state.state === 'completed') {
  console.log(JSON.stringify({ phase: 'completed', resumed: true, result: state.result }));
  process.exit(0);
}

const { extractSentenceFirstFrames } = await import('../server/lib/sentenceFirstFramePipeline.js');
const { runProductionSentenceReplication } = await import('../server/lib/sentenceReplicationProduction.js');
const { prepareLocalSeedanceMotionGuide } = await import('../server/lib/seedanceMotionGuide.js');
const { readLocalMaterials, saveLocalMaterials } = await import('../server/lib/materialLibrary.js');
const { referenceFrameActionPrompt } = await import('../server/starter198/referenceFrameActionPrompt.js');

try {
  state.cues = await extractSentenceFirstFrames({ tenantId, referenceMaterialId: sourceId, sourceMaterial, cues: [cue] });
  const materials = readLocalMaterials();
  const presenterPhoto = materials.find((item: any) => item.id === 'presenter-photo-12cf020ecb9ed8b35225bc88');
  if (!presenterPhoto?.file || !presenterPhoto.seedanceTrustedAsset) throw new Error('已认证本人照片不可用');
  const certifiedTargetId = 'target-frame-pipeline3-one-shot-certified-photo';
  const sourceFrameMaterialId = state.cues[0].sourceFirstFrame?.materialId;
  const certifiedTarget = {
    ...presenterPhoto,
    id: certifiedTargetId,
    name: '管道3单镜测试 · 已认证本人首帧',
    sourceType: 'digital-human-target-first-frame',
    sourceFrameMaterialId,
    presenterAssetId: presenter.id,
    presenterAssetVersion: presenter.assetVersion,
    createdAt: new Date().toISOString(),
  };
  saveLocalMaterials([...materials.filter((item: any) => item.id !== certifiedTargetId), certifiedTarget]);
  state.cues = state.cues.map((item: any) => ({ ...item, targetFirstFrame: { state: 'ready', materialId: certifiedTargetId } }));
  state.estimatedCostCny = 3.6;
  save();
  const shot: any = {
    source: 'avatar',
    narration: cue.targetText,
    digitalHuman: {
      workflow: 'viral_replication',
      presenterMode: 'video_twin',
      action: frameDriven
        ? referenceFrameActionPrompt((() => {
            const rows = JSON.parse(fs.readFileSync('data/local-store/trend_videos.json', 'utf8'));
            const source = rows.find((row: any) => row.id === sourceId);
            const analysis = parse(source?.aiAnalysis || '{}');
            return analysis?.gemini?.scriptDetails15s?.find((item: any) => String(item.time || '').startsWith('0.00')) || {};
          })()).prompt
        : 'The presenter faces the camera in a fixed medium shot, smiles, waves once, and lifts the green pendant lamp naturally while speaking.',
      scene: 'A bright indoor lighting showroom with warm hanging lamps and a clean commercial display.',
      preserve: 'Fixed medium framing, direct eye contact, brisk opening pace, and the source shot camera angle.',
      reference: {
        materialId: sourceId,
        cues: state.cues,
        modelInputAuthorized: true,
        modelInputAuthorizationEvidence: 'User-authorized local preview test in this session on 2026-10-09; motion guide is identity-removed before supplier submission.',
      },
    },
  };
  state.state = 'running';
  save();
  state.result = await runProductionSentenceReplication({
    tenantId,
    projectId: 'pipeline3-test-20261009',
    assemblyId: 'one-shot-preview',
    shotId: cue.id,
    fingerprint: sourceMaterial.contentSha256,
    shot,
    presenter,
    cues: state.cues,
    requestId,
    maxCostCny: 5,
    targetLanguage: 'en',
    sourceMaterial,
    existingProviderTasks: state.providerTasks,
    onProviderTaskSubmitted: async (cueId, taskId) => {
      state.providerTasks[cueId] = taskId;
      save();
      console.log(JSON.stringify({ phase: 'supplier_submitted', cueId, taskId }));
    },
    prepareMotionGuide: async value => prepareLocalSeedanceMotionGuide({
      tenantId,
      cueId: value.cue.id,
      sourceVideoPath: value.sourceVideoPath,
    }),
  });
  state.state = 'completed';
  save();
  console.log(JSON.stringify({ phase: 'completed', result: state.result }));
} catch (error) {
  state.state = Object.keys(state.providerTasks).length ? 'uncertain' : 'failed';
  state.error = (error instanceof Error ? error.message : String(error)).replace(/assetToken=[^\s"\\]+/g, 'assetToken=[redacted]');
  save();
  console.log(JSON.stringify({ phase: state.state, error: state.error, providerTasks: state.providerTasks }));
  process.exitCode = 1;
}
