import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mapMeasuredSceneTimeline } from './socialContentMeasuredSceneTimeline.js';
import { verifySceneReworkMeasuredVoice, verifyStoredSceneReworkMeasuredVoice, type SceneReworkMeasuredVoiceProof } from './socialContentSceneReworkMeasuredVoice.js';
import {sealSocialSceneMediaCache} from './socialContentSceneRework.js';
import {socialRequestHash} from './socialContentValidation.js';
import type { SocialSceneMediaCache } from './socialContentSceneRework.js';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test('rework timing is bound to original audio and independently checked alignment, not just manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scene-measured-proof-'));
  try {
    const scope = {tenantId:'tenant', taskId:'task', runId:'run', planHash:'a'.repeat(64)};
    const audio = path.join(root, 'audio.wav'), source = path.join(root, 'source.json');
    const alignment = path.join(root, 'alignment.json'), receiptRef = path.join(root, 'prepared.json');
    await writeFile(audio, 'original audio bytes');
    const audioHash = hash(await readFile(audio));
    const nativeVoice = {provider:'heygen', model:'avatar_iv', physicalVoiceId:'voice'} as const;
    await writeFile(source, JSON.stringify({scope, provider:'heygen', model:'avatar_iv', voiceId:'voice', operationId:'source'}));
    await writeFile(alignment, JSON.stringify({state:'completed', scope:{audioSha256:audioHash},
      source:'heygen_native_subtitles', precision:'phrase', independentAsr:false, sourceReceiptRef:source,
      sourceReceiptSha256:hash(await readFile(source)), result:{transcripts:[{text:'Hello.',
        sentences:[{text:'Hello.', begin_time:0, end_time:4000}]}]}}));
    const cues = [{start:0, end:4, text:'Hello.'}];
    const original = [{shotId:'slot', spokenText:'Hello.', startSeconds:0, endSeconds:2, durationSeconds:2}];
    const timeline = mapMeasuredSceneTimeline({scenes:original, cues, durationSeconds:4});
    const voice = {ok:true, localPath:audio, url:audio, duration:4, cues};
    const prepared = {voice, inputHash:'frozen', receiptRef, wholeTrackSha256:audioHash,
      sourceReceiptRefs:[source], alignmentReceiptRef:alignment, nativeVoice,
      timingPolicy:'voice-driven-slots.v1', measuredSceneTimeline:timeline};
    await writeFile(receiptRef, JSON.stringify({status:'completed', inputHash:'frozen', scope, voice,
      wholeTrackSha256:audioHash, scenes:original, voiceDriven:true, measuredTimeline:timeline,
      proof:{sourceReceiptRefs:[source], alignmentReceiptRef:alignment, nativeVoice}}));
    const proof = {prepared, scope, scenes:[{sceneId:'slot', duration:{startSeconds:0, endSeconds:2}}]} as unknown as SceneReworkMeasuredVoiceProof;
    const cache = {tenantId:'tenant', taskId:'task', runId:'run', scenes:[{sceneId:'slot'}],
      renderInput:{voice:{sha256:audioHash}, manifest:{timeline:[{sceneId:'slot', targetStart:0, targetEnd:4}]}}} as unknown as SocialSceneMediaCache;
    assert.deepEqual((await verifySceneReworkMeasuredVoice(cache, proof)).timeline, timeline);
    const parent=sealSocialSceneMediaCache({...cache,runId:'run',parentArtifactId:'parent',parentArtifactHash:'original',measuredVoiceProof:proof});
    const parentPayload={cache:parent};
    const content={sceneRework:{sourceRunId:'run',executionRunId:'repair',parentArtifactId:'parent',parentArtifactHash:'original',sourceCacheHash:parent.recordHash}};
    const row={resource_ref:'file',content,parent_artifact_id:'parent',content_hash:socialRequestHash({resourceRef:'file',content})};
    const child={...cache,runId:'repair',parentArtifactId:'child',parentArtifactHash:row.content_hash,measuredVoiceProof:proof};
    const store={list:async (collection:string)=>collection==='starter_social_content_artifacts'
      ? {totalItems:1,items:[row]} : {totalItems:1,items:[{payload:parentPayload,content_hash:socialRequestHash(parentPayload)}]}};
    const repository={dataStore:store} as never;
    assert.deepEqual((await verifyStoredSceneReworkMeasuredVoice(repository,child)).timeline,timeline);
    content.sceneRework.sourceCacheHash='changed';
    row.content_hash=socialRequestHash({resourceRef:'file',content});child.parentArtifactHash=row.content_hash;
    await assert.rejects(verifyStoredSceneReworkMeasuredVoice(repository,child),/voice_lineage_invalid/);
    (cache.renderInput.manifest.timeline as Array<{targetEnd:number}>)[0]!.targetEnd = 2;
    await assert.rejects(verifySceneReworkMeasuredVoice(cache, proof), /timeline_changed/);
    (cache.renderInput.manifest.timeline as Array<{targetEnd:number}>)[0]!.targetEnd = 4;
    await writeFile(audio, 'altered audio bytes');
    await assert.rejects(verifySceneReworkMeasuredVoice(cache, proof), /voice_bytes_changed/);
  } finally { await rm(root, {recursive:true, force:true}); }
});
