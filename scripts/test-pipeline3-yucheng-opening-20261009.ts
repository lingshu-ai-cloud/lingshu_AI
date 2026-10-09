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
const sourceId = 'trend_videos_192e76d4b21244c4a2922e60672c95f2';
const sourceFile = `tenants/${tenantId}/reference-videos/${sourceId}.mp4`;
const sourcePath = path.join('data/media', sourceFile);
const requestId = 'pipeline3-yucheng-opening-20261009-v1-frame-actions';
const root = path.resolve('data/acceptance/pipeline3-yucheng-opening-20261009');
const stateFile = path.join(root, 'state.json');
fs.mkdirSync(root, { recursive: true });

const parse = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
const defaults = JSON.parse(fs.readFileSync('data/local-store/studio_production_defaults.json', 'utf8'));
const presenter = parse(defaults.find((row: any) => row.tenant_id === tenantId).payload).presenters
  .find((row: any) => row.id === 'presenter-f281e943169413c9b5525072');
const materials = JSON.parse(fs.readFileSync('data/materials.json', 'utf8'));
const target = materials.find((item: any) => item.id === 'target-frame-fd045318316a64ac885bd7ac');
const sourceFrame = materials.find((item: any) => item.id === target?.sourceFrameMaterialId);
if (!target?.seedanceTrustedAsset || target.presenterAssetId !== presenter.id || target.presenterAssetVersion !== presenter.assetVersion
  || sourceFrame?.sourceMaterialId !== sourceId) throw new Error('雨晨开场缺少与当前人物版本匹配的已认证目标首帧');

const sourceMaterial: any = {
  id: sourceId, type: 'video', scope: 'own', tenantId, file: sourceFile, usage: 'analysis', verifyContentSha256: true,
  contentSha256: createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
};
const trendRows = JSON.parse(fs.readFileSync('data/local-store/trend_videos.json', 'utf8'));
const trend = trendRows.find((row: any) => row.id === sourceId);
const detail = parse(trend.aiAnalysis).gemini.scriptDetails15s[0];
detail.motionClass = '走播';
detail.bodyMovement = '人物从画面左侧快速进入并向右行走，开场形成冲击，随后降低步速继续走播';
detail.cameraMovement = '镜头持续向右跟拍，开场移动较快，随后保持平稳跟随';
detail.tempoPhases = [
  { time:'0.12s–0.90s', tempo:'快速冲击', action:'人物从左侧快速进入，面向镜头展开手臂并完成 Hello Boss 问候' },
  { time:'0.90s–5.10s', tempo:'慢速稳定', action:'人物降低步速继续向右走播，以较慢手势完成定制护肤品牌的长句口播' },
];
detail.beats = [
  { time:'0.12s–0.90s', action:'从画面左侧快速进入，向右迈步，展开手臂完成开场问候' },
  { time:'0.90s–2.50s', action:'降低步速继续向右走播，手掌朝镜头做自然说明手势' },
  { time:'2.50s–5.10s', action:'保持慢速走播并转向实验室一侧，用展开手势介绍研发场景' },
];
const { referenceFrameActionPrompt } = await import('../server/starter198/referenceFrameActionPrompt.js');
const action = referenceFrameActionPrompt(detail).prompt;
const cue: any = {
  id:'yucheng-opening-0.12-5.10', start:0.12, end:5.10, generationDurationSeconds:5,
  originalText:'Hello, boss! Do you want to customize your own brand of skincare products?',
  targetText:'Hello, boss! Do you want to customize your own brand of skincare products?',
  personShot:true, shotIds:['slot-1'], compositionClusterId:'yucheng-lab-walk-opening', firstFrameSeconds:0.12,
  sourceFirstFrame:{time:sourceFrame.sourceTime,materialId:sourceFrame.id},
  targetFirstFrame:{state:'ready',materialId:target.id},
};
const state: any = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8'))
  : { requestId, state:'preparing', providerTasks:{}, maxCostCny:5, estimatedCostCny:4.5, action };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state,null,2));
if (state.state === 'completed') { console.log(JSON.stringify({phase:'completed',resumed:true,result:state.result})); process.exit(0); }

const { runProductionSentenceReplication } = await import('../server/lib/sentenceReplicationProduction.js');
const { prepareLocalSeedanceMotionGuide } = await import('../server/lib/seedanceMotionGuide.js');
try {
  const shot: any = { source:'avatar', narration:cue.targetText, digitalHuman:{ workflow:'viral_replication', presenterMode:'video_twin',
    action, scene:'Bright glass-walled skincare R&D corridor; keep the laboratory depth and the R&D CENTER doorway.',
    preserve:'Preserve the left-to-right walk-and-talk path, the fast opening entrance, the later slower delivery, and the rightward camera follow.',
    reference:{materialId:sourceId,cues:[cue],modelInputAuthorized:true,modelInputAuthorizationEvidence:'User-authorized local pipeline 3 test in this session on 2026-10-09; source is converted to an identity-removed motion guide.'} } };
  state.state='running'; state.cue=cue; save();
  state.result=await runProductionSentenceReplication({tenantId,projectId:'pipeline3-yucheng-test-20261009',assemblyId:'opening-preview',shotId:cue.id,
    fingerprint:sourceMaterial.contentSha256,shot,presenter,cues:[cue],requestId,maxCostCny:5,targetLanguage:'en',sourceMaterial,
    existingProviderTasks:state.providerTasks,onProviderTaskSubmitted:async(cueId,taskId)=>{state.providerTasks[cueId]=taskId;save();console.log(JSON.stringify({phase:'supplier_submitted',cueId,taskId}));},
    prepareMotionGuide:async value=>prepareLocalSeedanceMotionGuide({tenantId,cueId:value.cue.id,sourceVideoPath:value.sourceVideoPath})});
  state.state='completed';save();console.log(JSON.stringify({phase:'completed',result:state.result}));
} catch(error) {
  state.state=Object.keys(state.providerTasks).length?'uncertain':'failed';state.error=error instanceof Error?error.message:String(error);save();
  console.log(JSON.stringify({phase:state.state,error:state.error,providerTasks:state.providerTasks}));process.exitCode=1;
}
