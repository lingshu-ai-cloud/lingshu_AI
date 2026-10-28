import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import type {SocialDirectorBrief} from '../../shared/contracts/socialContentAgentContract.js';
import type {PreparedWholeVoice} from './socialContentPreparedWholeVoice.js';
import {readPreparedWholeVoiceScene} from './socialContentPreparedWholeVoice.js';
import {mapMeasuredSceneTimeline} from './socialContentMeasuredSceneTimeline.js';
import {projectMeasuredDirectorScenes, verifyMeasuredSupplyVoice} from './socialContentMeasuredSupplyTimeline.js';

function fixture(root: string) {
  const scope = {tenantId:'fixture', taskId:'task', runId:'run', planHash:'a'.repeat(64)};
  const file = path.join(root, 'whole.wav');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=4','-ac','1','-c:a','pcm_s16le',file]);
  const wholeTrackSha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const scenes = [{shotId:'a', spokenText:'Hello.', durationSeconds:1, startSeconds:0, endSeconds:1},
    {shotId:'b', spokenText:'Buy.', durationSeconds:1, startSeconds:1, endSeconds:2}];
  const directorScenes = scenes.map((scene,index) => ({sceneId:scene.shotId, order:index+1, referenceShotId:'ref-'+scene.shotId,
    targetVisual:'unchanged visual', audioLayers:{voiceover:scene.spokenText}, duration:{startSeconds:scene.startSeconds,endSeconds:scene.endSeconds,targetSeconds:scene.durationSeconds}})) as SocialDirectorBrief['scenes'];
  const cues = [{start:0,end:3,text:'Hello.'},{start:3,end:4,text:'Buy.'}];
  const voice = {ok:true,localPath:file,url:'https://owned.test/audio',duration:4,cues};
  const source = path.join(root,'source.json'), alignment = path.join(root,'alignment.json'), receipt = path.join(root,'prepared.json');
  const nativeVoice = {provider:'heygen',model:'avatar_iv',physicalVoiceId:'original'};
  fs.writeFileSync(source,JSON.stringify({scope,...nativeVoice,voiceId:nativeVoice.physicalVoiceId,operationId:'paid-original'}));
  fs.writeFileSync(alignment,JSON.stringify({state:'completed',scope:{audioSha256:wholeTrackSha256},source:'heygen_native_subtitles',precision:'phrase',independentAsr:false,
    sourceReceiptRef:source,sourceReceiptSha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    result:{transcripts:[{text:'Hello. Buy.',sentences:cues.map(cue=>({text:cue.text,begin_time:cue.start*1000,end_time:cue.end*1000}))}]}}));
  const timeline = mapMeasuredSceneTimeline({scenes,cues,durationSeconds:4});
  const proof = {sourceReceiptRefs:[source],alignmentReceiptRef:alignment,nativeVoice};
  const prepared = {voice,inputHash:'fixture-input',receiptRef:receipt,wholeTrackSha256,...proof,timingPolicy:'voice-driven-slots.v1',measuredSceneTimeline:timeline} as PreparedWholeVoice;
  fs.writeFileSync(receipt,JSON.stringify({status:'completed',inputHash:prepared.inputHash,scope,voice,wholeTrackSha256,scenes,proof,voiceDriven:true,measuredTimeline:timeline}));
  return {scope,prepared,directorScenes,source,alignment,receipt};
}

test('verified measured projection retains slots and expression while real longer audio clips remain usable',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'measured-supply-'));
  try {
    const f=fixture(root), original=JSON.stringify(f.directorScenes);
    const timing=await verifyMeasuredSupplyVoice({prepared:f.prepared,scope:f.scope,scenes:f.directorScenes});
    assert.equal(timing.durationSeconds,4);assert.equal(timing.sourceReceipts[0]!.operationId,'paid-original');
    assert.match(timing.preparedReceiptSha256,/^[a-f0-9]{64}$/);
    const projected=projectMeasuredDirectorScenes({scenes:f.directorScenes,timeline:timing.timeline});
    assert.deepEqual(projected.map(scene=>scene.duration),[{startSeconds:0,endSeconds:3,targetSeconds:3},{startSeconds:3,endSeconds:4,targetSeconds:1}]);
    assert.deepEqual(projected.map(({duration,...rest})=>rest),f.directorScenes.map(({duration,...rest})=>rest));
    assert.equal(JSON.stringify(f.directorScenes),original);
    const clips=await Promise.all(f.directorScenes.map(scene=>readPreparedWholeVoiceScene({prepared:f.prepared,scope:f.scope,shotId:scene.sceneId,spokenText:scene.audioLayers.voiceover!,assertCurrent:async()=>{}})));
    assert.deepEqual(clips.map(clip=>clip.durationSeconds),[3,1]);
    const decode=(file:string)=>execFileSync(ffmpeg!,['-v','error','-i',file,'-f','s16le','-ac','1','-ar','24000','pipe:1']);
    assert.ok(Buffer.concat(clips.map(clip=>decode(clip.filePath))).equals(decode(f.prepared.voice.localPath)));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('supply evidence rejects changed scope, original slots, audio, alignment and paid receipt',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'measured-supply-tamper-'));
  try {
    const f=fixture(root), input={prepared:f.prepared,scope:f.scope,scenes:f.directorScenes};
    await assert.rejects(verifyMeasuredSupplyVoice({...input,scope:{...f.scope,runId:'other'}}),/voice_receipt_changed/);
    await assert.rejects(verifyMeasuredSupplyVoice({...input,scenes:[...f.directorScenes].reverse()}),/original_scenes_changed/);
    await assert.rejects(verifyMeasuredSupplyVoice({...input,prepared:{...f.prepared,measuredSceneTimeline:[]}}),/timeline_changed/);
    const receiptBytes=fs.readFileSync(f.receipt), receipt=JSON.parse(receiptBytes.toString());
    const wrongNative={...f.prepared.nativeVoice,provider:'qwen' as const};receipt.proof.nativeVoice=wrongNative;fs.writeFileSync(f.receipt,JSON.stringify(receipt));
    await assert.rejects(verifyMeasuredSupplyVoice({...input,prepared:{...f.prepared,nativeVoice:wrongNative}}),/original_receipt_changed/);
    fs.writeFileSync(f.receipt,receiptBytes);
    await assert.rejects(verifyMeasuredSupplyVoice({...input,spokenScenes:[{sceneId:'a',voiceover:'Hello. Buy.'},{sceneId:'b',voiceover:''}]}),/original_speech_changed/);
    await verifyMeasuredSupplyVoice({...input,spokenScenes:[{sceneId:'a',voiceover:'Hello.'},{sceneId:'b',narration:'Buy.'}]});
    const audio=fs.readFileSync(f.prepared.voice.localPath);fs.appendFileSync(f.prepared.voice.localPath,'changed');
    await assert.rejects(verifyMeasuredSupplyVoice(input),/bytes_changed/);fs.writeFileSync(f.prepared.voice.localPath,audio);
    const alignment=fs.readFileSync(f.alignment), raw=JSON.parse(alignment.toString());raw.scope.audioSha256='changed';fs.writeFileSync(f.alignment,JSON.stringify(raw));
    await assert.rejects(verifyMeasuredSupplyVoice(input),/alignment_changed/);fs.writeFileSync(f.alignment,alignment);
    const source=JSON.parse(fs.readFileSync(f.source,'utf8'));source.operationId='other-paid';fs.writeFileSync(f.source,JSON.stringify(source));
    await assert.rejects(verifyMeasuredSupplyVoice(input),/original_receipt_changed/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('projection rejects missing, reordered, repeated and discontinuous slot timing',()=>{
  const scenes=[{sceneId:'a'},{sceneId:'b'}] as SocialDirectorBrief['scenes'];
  const timeline=mapMeasuredSceneTimeline({scenes:[{shotId:'a',spokenText:'A',startSeconds:0,endSeconds:1},{shotId:'b',spokenText:'B',startSeconds:1,endSeconds:2}],cues:[{text:'A',start:0,end:1},{text:'B',start:1,end:2}],durationSeconds:2});
  assert.throws(()=>projectMeasuredDirectorScenes({scenes,timeline:timeline.slice(0,1)}),/projection_changed/);
  assert.throws(()=>projectMeasuredDirectorScenes({scenes,timeline:[...timeline].reverse()}),/projection_changed/);
  assert.throws(()=>projectMeasuredDirectorScenes({scenes:[scenes[0]!,scenes[0]!],timeline}),/projection_changed/);
  assert.throws(()=>projectMeasuredDirectorScenes({scenes,timeline:[timeline[0]!,{...timeline[1]!,start:1.5}]}),/projection_changed/);
});
