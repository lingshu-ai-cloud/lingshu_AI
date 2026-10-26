import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { persistGraphEvidenceSnapshot, readGraphEvidenceSnapshot } from './socialContentGraphContextSnapshots.js';
import { copyInitialSceneMedia } from './socialContentInitialSceneCache.js';
import { socialObject, socialRequestHash, socialText } from './socialContentValidation.js';
import { verifyPrivateAssSidecar, verifyPrivateCaptionBaseline, verifySocialSubtitleRenderAttestation,
  verifySocialFrameRenderAttestation, type SocialRenderStageReceipt } from './socialContentProductionStages.js';
import { SOCIAL_MEDIA_PROBE_CACHE_POLICY } from './socialSceneMediaProbeCache.js';
import type { Starter198Repository } from './repository.js';

export const SOCIAL_TECHNICAL_REVIEW_POLICY = `social-technical-quality.v3:${SOCIAL_MEDIA_PROBE_CACHE_POLICY}`;
type Scope = {tenantId:string;taskId:string;runId:string};
type Media = {localPath:string;sha256:string};
export interface SocialTechnicalReplayEvidence {
  schemaVersion:'social-technical-replay.v1'; scope:Scope; outputSha256:string;
  manifest:Record<string,unknown>; renderReceipt:SocialRenderStageReceipt;
  frozenVoiceCues:unknown[]; voice:Media; bgm:Media|null;
}
const fail=(code:string):never=>{throw Error(`social_technical_reevaluation_${code}`);};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const socialTechnicalRenderDirectory=(scope:Scope)=>path.resolve('data/content-execution-render',
  createHash('sha256').update(JSON.stringify([scope.tenantId,scope.taskId,scope.runId])).digest('hex'));

/** Freeze existing render inputs into the same content-addressed evidence stores.
 * No generation, provider or render port is reachable from technical replay. */
export async function persistSocialTechnicalReplay(input:{scope:Scope;manifest:Record<string,unknown>;
  renderReceipt:SocialRenderStageReceipt;frozenVoiceCues?:unknown[]}):Promise<string|null>{
  const voiceUrl=socialObject(input.manifest.voiceover)?.url;
  const bgmUrl=typeof input.manifest.bgm==='string'?input.manifest.bgm:socialObject(input.manifest.bgm)?.url;
  if(typeof voiceUrl!=='string'||!voiceUrl||!input.frozenVoiceCues?.length)return null;
  const local=(url:unknown)=>typeof url==='string'&&url.length>0&&!/^[a-z][a-z0-9+.-]*:/i.test(url);
  if(!local(voiceUrl)||bgmUrl&&!local(bgmUrl)&&!(typeof bgmUrl==='string'&&/^data:[^;]+;base64,/.test(bgmUrl)))return null;
  const root=socialTechnicalRenderDirectory(input.scope);
  const voice=await copyInitialSceneMedia({root,source:voiceUrl,extension:'voice'});
  const bgm=typeof bgmUrl==='string'&&bgmUrl?await copyInitialSceneMedia({root,source:bgmUrl,extension:'bgm'}):null;
  return persistGraphEvidenceSnapshot({schemaVersion:'social-technical-replay.v1',scope:input.scope,
    outputSha256:input.renderReceipt.sha256,manifest:input.manifest,renderReceipt:input.renderReceipt,
    frozenVoiceCues:input.frozenVoiceCues,voice,bgm} satisfies SocialTechnicalReplayEvidence);
}

export async function loadSocialTechnicalReplay(input:{repository:Starter198Repository;scope:Scope;
  parentArtifactId:string;parentContent:Record<string,unknown>;outputSha256:string}):Promise<SocialTechnicalReplayEvidence>{
  const report=socialObject(input.parentContent.technicalQualityReport);
  const evidenceHash=socialText(report?.replayEvidenceHash);
  if(evidenceHash){try{return readGraphEvidenceSnapshot<SocialTechnicalReplayEvidence>(evidenceHash);}catch{return fail('evidence_missing_or_changed');}}
  // Legacy migration uses the existing verified scene cache and original job,
  // never an inferred manifest or today's mutable production plan.
  if(!input.repository.dataStore)return fail('evidence_missing');
  const {createSocialSceneReworkService}=await import('./socialContentSceneReworkService.js');
  const {readContentExecutionJob}=await import('../contentExecution/durableQueue.js');
  const cache=(await createSocialSceneReworkService(input.repository).readCache({...input.scope,parentArtifactId:input.parentArtifactId})).cache;
  const job=await readContentExecutionJob(input.repository.dataStore,input.scope.tenantId,input.scope.taskId,input.scope.runId);
  const render=job?.checkpoints['social.graph_render'];
  if(render?.version!=='2')return fail('evidence_missing');
  const manifest=cache.renderInput.sourceManifest,cues=socialObject(manifest.subtitles)?.cues;
  const alignment=socialObject(socialObject(report?.mediaHardProbe)?.captionSpeechAlignment);
  if(!Array.isArray(cues)||alignment?.status!=='matched'||alignment.frozenVoiceCueHash!==socialRequestHash(cues))return fail('frozen_voice_evidence_missing');
  return {schemaVersion:'social-technical-replay.v1',scope:input.scope,outputSha256:input.outputSha256,
    manifest,renderReceipt:render.payload as unknown as SocialRenderStageReceipt,frozenVoiceCues:cues,
    voice:cache.renderInput.voice,bgm:cache.renderInput.bgm};
}

/** Validate original scope, manifest and sidecar bytes before local QA. */
export async function verifySocialTechnicalReplay(input:{evidence:SocialTechnicalReplayEvidence;scope:Scope;
  parentContent:Record<string,unknown>;outputSha256:string}){
  const e=input.evidence,source=socialObject(input.parentContent.productionWorkspaceSource);
  if(e.schemaVersion!=='social-technical-replay.v1'||socialRequestHash(e.scope)!==socialRequestHash(input.scope)
    ||e.outputSha256!==input.outputSha256||source?.runId!==input.scope.runId
    ||source.outputSha256!==input.outputSha256||source.manifestHash!==socialRequestHash(e.manifest)
    ||e.renderReceipt.sha256!==input.outputSha256)return fail('lineage_changed');
  const receipt=e.renderReceipt,directory=socialTechnicalRenderDirectory(input.scope);
  const attestation=verifySocialSubtitleRenderAttestation({raw:{subtitleRenderEvidence:receipt.rendererAttestation},outputSha256:input.outputSha256,manifest:e.manifest});
  if(!attestation?.rendererAttestation||!await verifyPrivateAssSidecar({directory,sidecar:receipt.subtitleAssSidecar,attestation:attestation.rendererAttestation,outputSha256:input.outputSha256})
    ||!await verifyPrivateCaptionBaseline({directory,sidecar:receipt.captionBaselineSidecar,attestation:attestation.rendererAttestation,outputSha256:input.outputSha256}))return fail('sidecar_evidence_missing_or_changed');
  const frame=verifySocialFrameRenderAttestation({raw:receipt,outputSha256:input.outputSha256,manifest:e.manifest});
  if(!frame)return fail('frame_evidence_missing');
  for(const media of [e.voice,e.bgm])if(media){
    if(!path.isAbsolute(media.localPath)||!/^([a-f0-9]{64})$/.test(media.sha256)||hash(await readFile(media.localPath).catch(()=>fail('audio_missing')))!==media.sha256)return fail('audio_changed');
  }
  const oldProbe=socialObject(socialObject(input.parentContent.technicalQualityReport)?.mediaHardProbe);
  if(oldProbe?.frozenVoiceSha256!==e.voice.sha256||socialObject(oldProbe.captionSpeechAlignment)?.frozenVoiceCueHash!==socialRequestHash(e.frozenVoiceCues))return fail('frozen_voice_changed');
  const manifest=structuredClone(e.manifest);manifest.voiceover={...socialObject(manifest.voiceover),url:e.voice.localPath};
  if(e.bgm)manifest.bgm=typeof manifest.bgm==='string'?e.bgm.localPath:{...socialObject(manifest.bgm),url:e.bgm.localPath};
  return {manifest,receipt,frame};
}
