import type { SocialDirectorBrief } from '../../shared/contracts/socialContentAgentContract.js';
import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import type { PreparedWholeVoice } from './socialContentPreparedWholeVoice.js';
import type { SocialSceneMediaCache } from './socialContentSceneRework.js';
import { verifyMeasuredSupplyVoice } from './socialContentMeasuredSupplyTimeline.js';
import { socialObject } from './socialContentValidation.js';
import {socialJson, socialRequestHash} from './socialContentValidation.js';
import type {Starter198Repository} from './repository.js';
import type {Record_} from '../storage/datastore.js';

/** Private evidence retained from the original production, never supplied by a client. */
export interface SceneReworkMeasuredVoiceProof {
  prepared: PreparedWholeVoice;
  scope: SocialTaskBudgetScope;
  scenes: SocialDirectorBrief['scenes'];
}

/** Verify the original audio and alignment receipts and bind each render slot
 * to the resulting measured timeline. The manifest alone is never evidence. */
export async function verifySceneReworkMeasuredVoice(cache: SocialSceneMediaCache, proof: SceneReworkMeasuredVoiceProof, inheritedOriginVerified = false) {
  if (proof.scope.tenantId !== cache.tenantId || proof.scope.taskId !== cache.taskId || (!inheritedOriginVerified && proof.scope.runId !== cache.runId))
    throw Error('scene_rework_measured_voice_scope_changed');
  const measured = await verifyMeasuredSupplyVoice(proof);
  if (cache.renderInput.voice.sha256 !== measured.wholeTrackSha256)
    throw Error('scene_rework_measured_voice_audio_changed');
  const timeline = cache.renderInput.manifest.timeline;
  if (!Array.isArray(timeline) || timeline.length !== measured.timeline.length || timeline.length !== cache.scenes.length)
    throw Error('scene_rework_measured_voice_timeline_changed');
  for (let index = 0; index < timeline.length; index++) {
    const clip = socialObject(timeline[index]), time = measured.timeline[index]!;
    if (!clip || clip.sceneId !== time.shotId || cache.scenes[index]!.sceneId !== time.shotId
      || clip.targetStart !== time.start || clip.targetEnd !== time.end)
      throw Error('scene_rework_measured_voice_timeline_changed');
  }
  return measured;
}

/** Follow actual parent artifacts and immutable source caches, never an
 * arbitrary caller-provided original run. Each step retains the same proof. */
export async function verifyStoredSceneReworkMeasuredVoice(repository:Starter198Repository, cache:SocialSceneMediaCache) {
  const proof=cache.measuredVoiceProof;
  if(!proof)throw Error('scene_rework_measured_voice_proof_missing');
  const store=repository.dataStore;if(!store)throw Error('scene_rework_persistent_store_required');
  let current=cache;const visited=new Set<string>();
  while(current.runId!==proof.scope.runId){
    if(visited.has(current.parentArtifactId)||visited.size>=32)throw Error('scene_rework_voice_lineage_invalid');
    visited.add(current.parentArtifactId);
    const rows=await store.list<Record_>('starter_social_content_artifacts',{where:{tenant_id:cache.tenantId,task_id:cache.taskId,artifact_id:current.parentArtifactId},perPage:2});
    const row=rows.items[0], content=socialObject(socialJson(row?.content)), lineage=socialObject(content?.sceneRework);
    if(rows.totalItems!==1||rows.items.length!==1||!row||!content||!lineage
      ||row.content_hash!==socialRequestHash({resourceRef:row.resource_ref,content})||row.content_hash!==current.parentArtifactHash
      ||lineage.executionRunId!==current.runId||lineage.parentArtifactId!==row.parent_artifact_id
      ||typeof lineage.parentArtifactId!=='string'||typeof lineage.sourceRunId!=='string')throw Error('scene_rework_voice_lineage_invalid');
    const parents=await store.list<Record_>('starter_social_scene_media_caches',{where:{tenant_id:cache.tenantId,task_id:cache.taskId,
      run_id:lineage.sourceRunId,parent_artifact_id:lineage.parentArtifactId},perPage:2});
    const saved=parents.items[0], payload=socialObject(socialJson(saved?.payload)), parent=socialObject(payload?.cache);
    if(parents.totalItems!==1||parents.items.length!==1||!saved||!payload||!parent
      ||saved.content_hash!==socialRequestHash(payload)||parent.recordHash!==lineage.sourceCacheHash
      ||parent.parentArtifactHash!==lineage.parentArtifactHash||socialRequestHash(parent.measuredVoiceProof)!==socialRequestHash(proof))
      throw Error('scene_rework_voice_lineage_invalid');
    const {recordHash,...body}=parent;if(recordHash!==socialRequestHash(body))throw Error('scene_rework_voice_lineage_invalid');
    current=parent as unknown as SocialSceneMediaCache;
  }
  await verifySceneReworkMeasuredVoice(current,proof);
  return verifySceneReworkMeasuredVoice(cache,proof,true);
}
