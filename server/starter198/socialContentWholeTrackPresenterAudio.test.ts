import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {measuredWholeTrackSceneRanges,createWholeTrackPresenterAudioPort} from './socialContentWholeTrackPresenterAudio.js';
test('scene clipping validates full transcript and permits words across frozen visual cuts',()=>{
 const scenes=[{shotId:'s1',spokenText:'Hello world.',durationSeconds:2,startSeconds:0,endSeconds:2},{shotId:'s2',spokenText:'Choose your product.',durationSeconds:2,startSeconds:2,endSeconds:4}];
 const cues=[{start:.1,end:1.4,text:'Hello world.'},{start:2.1,end:3.6,text:'Choose your product.'}];
 assert.deepEqual([...measuredWholeTrackSceneRanges({scenes,cues,durationSeconds:4})],[['s1',{start:0,end:2}],['s2',{start:2,end:4}]]);
 assert.throws(()=>measuredWholeTrackSceneRanges({scenes,cues:[{...cues[0]!,text:'Other speech.'}],durationSeconds:4}),/not_unique/);
 assert.equal(measuredWholeTrackSceneRanges({scenes:[{...scenes[0]!,durationSeconds:.5,endSeconds:.5}],cues:[cues[0]!],durationSeconds:4}).get('s1')?.end,.5);
 assert.equal(measuredWholeTrackSceneRanges({scenes,cues:[cues[0]!,{...cues[1]!,start:1.6,end:1.9}],durationSeconds:4}).get('s2')?.start,2);
});
test('actual FFmpeg slice/upload proof persists and unknown upload cannot repeat after workspace cleanup',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whole-track-presenter-'));
 try {
  const file=path.join(root,'track.wav');execFileSync(ffmpeg||'ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','1','-ac','1','-c:a','pcm_s16le',file],{stdio:'ignore'});
  const wholeTrackSha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),scope={tenantId:'t',taskId:'task',runId:'run',planHash:'a'.repeat(64)},nativeVoice={provider:'qwen' as const,model:'qwen3-tts-flash',physicalVoiceId:'LockedVoice'};
  const sourceReceiptRef=path.join(root,'source.json'),alignmentReceiptRef=path.join(root,'alignment.json');
  fs.writeFileSync(sourceReceiptRef,JSON.stringify({scope,provider:'qwen',model:nativeVoice.model,voiceId:nativeVoice.physicalVoiceId}));
  fs.writeFileSync(alignmentReceiptRef,JSON.stringify({state:'completed',scope:{audioSha256:wholeTrackSha256},result:{transcripts:[{text:'Hello.',sentences:[{begin_time:100,end_time:600,text:'Hello.'}]}]}}));
  const request:any={tenantId:'t',taskId:'task',shotId:'s1',script:'Hello.',presenter:{presenterAssetId:'person',assetVersion:4,providerPresenterId:'actual-avatar'}};
  const options={scope,taskVersion:'1',filePath:file,wholeTrackSha256,durationSeconds:1,scenes:[{shotId:'s1',spokenText:'Hello.',durationSeconds:.8,startSeconds:0,endSeconds:.8}],cues:[{start:.1,end:.6,text:'Hello.'}],nativeVoice,sourceReceiptRef,alignmentReceiptRef,assertCurrent:async()=>{},root:path.join(root,'durable')};
  let uploads=0;const port=createWholeTrackPresenterAudioPort({...options,client:{uploadAudio:async()=>{uploads++;return 'controlled-audio-id';}}});
  const audio=await port.resolve(request);assert.ok(Math.abs(audio.durationSeconds-.8)<.001);assert.equal(audio.operationRole,'production_scene');assert.equal(uploads,1);
  assert.deepEqual(await port.resolve(request),audio);assert.equal(uploads,1);
  const silentPort=createWholeTrackPresenterAudioPort({...options,root:path.join(root,'silent'),scenes:[...options.scenes,{shotId:'s2',spokenText:'',durationSeconds:1,startSeconds:2,endSeconds:3}],client:{uploadAudio:async()=> 'controlled-silent-audio'}});
  const silent=await silentPort.resolve({...request,shotId:'s2',script:''});
  assert.ok(Math.abs(silent.durationSeconds-1)<.001);
  const silentFiles=fs.readdirSync(path.join(root,'silent'),{recursive:true}).map(String).filter(f=>f.endsWith('.wav'));
  assert.equal(silentFiles.length,1);
  const silentPcm=execFileSync(ffmpeg||'ffmpeg',['-v','error','-i',path.join(root,'silent',silentFiles[0]!),'-f','s16le','-ac','1','-ar','24000','pipe:1']);
  assert.equal(silentPcm.length,48000);assert.ok(silentPcm.every(x=>x===0),'presenter window after original EOF is real one-second silence');
  const unknownRoot=path.join(root,'unknown');const unknown=createWholeTrackPresenterAudioPort({...options,root:unknownRoot,client:{uploadAudio:async()=>{uploads++;throw Error('controlled ambiguous upload');}}});
  await assert.rejects(unknown.resolve(request),/ambiguous upload/);
  const restarted=createWholeTrackPresenterAudioPort({...options,root:unknownRoot,client:{uploadAudio:async()=>assert.fail('must not upload twice')}});
  await assert.rejects(restarted.resolve(request),/unknown_no_repost/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
