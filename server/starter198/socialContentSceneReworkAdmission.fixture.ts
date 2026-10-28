import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mapMeasuredSceneTimeline } from './socialContentMeasuredSceneTimeline.js';
import { sealSocialSceneMediaCache, sceneReworkHash } from './socialContentSceneRework.js';
import { socialRequestHash } from './socialContentValidation.js';
import { alignSocialAssetSupplyPlanToBaseline } from './socialContentAssetSupplyExecution.js';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import type { Starter198AccessSnapshot } from './profile.js';
import { createStarter198Repository } from './repository.js';
import { prepared } from './socialContentSceneReworkService.fixture.js';
const access = (): Starter198AccessSnapshot => ({ recordId: 'access', tenantId: 't', productProfile: 'starter_198',
  profileVersion: 'starter_198.v1', entitlementSnapshotId: 'actual-access', status: 'active',
  cycleStartedAt: new Date(Date.now() - 60_000).toISOString(), cycleEndsAt: new Date(Date.now() + 60_000).toISOString(),
  updatedAt: new Date().toISOString(), entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resourceLimits: { workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1, productCount: 1,
    marketCount: 1, buyerPersonaCount: 2, languageCount: 2, primaryPlatformCount: 2, concurrentRunCount: 1,
    contentArtifactCountPerCycle: 7, contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
    assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20, highCostVideoCount: 0,
    budgetCnyPerCycle: 100, agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 } } });

export async function setup(paid = false, voiceDriven = false, withProof = true, withRenderManifest = false) {
  const f = await prepared(paid);
  f.tables.workflow_runs = f.tables.workflow_runs!.filter(row => row.id !== 'rework-run');
  const original = f.tables.workflow_runs!.find(row => row.id === 'run')!;
  original.status = 'succeeded';
  const user = f.tables.users!.find(row => row.id === 'owner')!;
  Object.assign(user, { tenantId: 't', role: 'social_operator', active: true });
  if (voiceDriven) {
    f.tables.starter_social_content_tasks![0]!.created_at='2026-10-28T00:00:00Z';
    f.context.plan.materialRoutingPolicyVersion = 'type-aware.v3';
    for (const shot of f.context.plan.shots) shot.materialRouting = {
      schemaVersion:'social-material-routing.v1',materialType:'product', policy:'local_only',
      localMatch:{state:'matched',sourceRefs:shot.sourceRefs,evidenceRef:'fixture-evidence'},
    } as any;
    const transition = f.context.plan.shots.find(shot=>shot.shotId==='scene-transition');
    if (transition) transition.fallbackSourceStrategy='non_evidentiary_ai_visual';
    f.context.plan = alignSocialAssetSupplyPlanToBaseline({plan:f.context.plan,baseline:f.context.baseline});
    const planHash = sceneReworkHash(f.context.plan);
    const artifact = f.tables.starter_social_content_artifacts![0]!;
    const content = artifact.content as Record<string, any>;
    content.initialSceneCacheInput.planHash = planHash;
    let measuredVoiceProof: any;
    let manifest = f.context.cache.renderInput.manifest;
    if (withProof) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-voice-proof-'));
      const cleanup = f.cleanup;
      f.cleanup = async () => { fs.rmSync(dir, {recursive:true, force:true}); await cleanup(); };
      const scope = {tenantId:'t',taskId:'content',runId:'run',planHash:'a'.repeat(64)};
      const nativeVoice = {provider:'heygen',model:'avatar_iv',physicalVoiceId:'fixture'};
      const digest = (bytes:Buffer) => createHash('sha256').update(bytes).digest('hex');
      const wholeTrackSha256 = digest(fs.readFileSync(f.local));
      const source = path.join(dir,'source.json'), alignment = path.join(dir,'alignment.json'), receiptRef = path.join(dir,'prepared.json');
      fs.writeFileSync(source, JSON.stringify({scope,provider:'heygen',model:'avatar_iv',voiceId:'fixture',operationId:'voice'}));
      const duration = f.context.baseline.scenes.length * 3;
      const text = f.context.baseline.scenes.map(()=>'产品').join(' ');
      const cues = [{start:0,end:duration,text}];
      fs.writeFileSync(alignment, JSON.stringify({state:'completed',scope:{audioSha256:wholeTrackSha256},source:'heygen_native_subtitles',precision:'phrase',independentAsr:false,sourceReceiptRef:source,sourceReceiptSha256:digest(fs.readFileSync(source)),result:{transcripts:[{text,sentences:[{text,begin_time:0,end_time:duration*1000}]}]}}));
      const original = f.context.baseline.scenes.map((scene,index)=>({shotId:scene.sceneId,spokenText:'产品',startSeconds:index*3,endSeconds:(index+1)*3,durationSeconds:3}));
      const timeline = mapMeasuredSceneTimeline({scenes:original,cues,durationSeconds:duration});
      const voice = {ok:true,localPath:f.local,url:f.local,duration,cues};
      const prepared = {voice,inputHash:'fixture',receiptRef,wholeTrackSha256,sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice,timingPolicy:'voice-driven-slots.v1',measuredSceneTimeline:timeline};
      fs.writeFileSync(receiptRef,JSON.stringify({status:'completed',inputHash:'fixture',scope,voice,wholeTrackSha256,scenes:original,voiceDriven:true,measuredTimeline:timeline,proof:{sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice}}));
      measuredVoiceProof={prepared,scope,scenes:original.map(s=>({sceneId:s.shotId,duration:{startSeconds:s.startSeconds,endSeconds:s.endSeconds}}))};
      manifest=withRenderManifest ? {jobId:'original',spec:{duration},voiceover:{url:f.local},
        subtitles:{cues},timeline:timeline.map(t=>({sceneId:t.shotId,type:'video',url:f.local,
          trimStart:0,trimEnd:t.end-t.start,speed:1,targetStart:t.start,targetEnd:t.end}))}
        : {timeline:timeline.map(t=>({sceneId:t.shotId,targetStart:t.start,targetEnd:t.end}))};
      content.initialSceneCacheInput.manifestHash=sceneReworkHash(manifest);
    }
    artifact.content_hash = socialRequestHash({resourceRef:artifact.resource_ref,content});
    const {recordHash: _recordHash, ...body} = f.context.cache;
    f.context.cache = sealSocialSceneMediaCache({...body, planHash, parentArtifactHash:String(artifact.content_hash),
      ...(measuredVoiceProof ? {measuredVoiceProof} : {}), renderInput:{...body.renderInput,manifest,sourceManifest:manifest},
      scenes:body.scenes.map((scene,index)=>({...scene,shotHash:sceneReworkHash(f.context.plan.shots[index])}))});
  }
  await f.service.saveCache(f.context);
  const repository = createStarter198Repository(f.store);
  repository.access = async () => access();
  return { ...f, repository, original, user, input: { repository, tenantId: 't', actorUserId: 'owner', taskId: 'content',
    sourceRunId: 'run', parentArtifactId: 'artifact',
    affectedSceneIds: [paid ? 'scene-transition' : 'scene-cta'] } };
}

export const tariff = () => ({ QWEN_IMAGE_MODEL: 'qwen-image-3.0', SCENE_REWORK_QWEN_TARIFF_MODEL: 'qwen-image-3.0',
  SCENE_REWORK_QWEN_MAX_BILLED_CNY_PER_IMAGE: '0.25',
  SCENE_REWORK_QWEN_TARIFF_SOURCE_REF: 'server-approved-contract-v1', SCENE_REWORK_QWEN_TARIFF_VERSION: '1',
  SCENE_REWORK_QWEN_TARIFF_VALID_UNTIL: new Date(Date.now() + 3_600_000).toISOString() });
