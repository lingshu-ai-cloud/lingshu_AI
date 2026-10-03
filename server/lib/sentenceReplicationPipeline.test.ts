import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import ffmpegStatic from 'ffmpeg-static';
import { runSentenceReplicationPipeline } from './sentenceReplicationPipeline.js';

test('rebuilds target frames, generates every sentence clip and concatenates them in cue order', async () => {
  assert.ok(ffmpegStatic); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-replication-')); let videoInputs: string[] = [];
  const cues = [0, 1].map(index => ({ id: `c${index}`, start: index, end: index + 1, originalText: `原句${index}`, targetText: `目标句${index}`, shotIds: ['s1'], sourceFirstFrame: { time: index, materialId: `source-${index}` } }));
  const result = await runSentenceReplicationPipeline({ cues, outputPath: path.join(dir, 'joined.mp4'), ffmpegPath: String(ffmpegStatic),
    createTargetFrame: async cue => { const filePath = path.join(dir, `${cue.id}.jpg`); execFileSync(String(ffmpegStatic), ['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=${cue.id === 'c0' ? 'red' : 'blue'}:s=180x320`,'-frames:v','1','-y',filePath]); return { materialId: `target-${cue.id}`, filePath }; },
    createSentenceVideo: async (cue, frame) => { videoInputs.push(frame.materialId); const filePath = path.join(dir, `${cue.id}.mp4`); execFileSync(String(ffmpegStatic), ['-hide_banner','-loglevel','error','-loop','1','-i',frame.filePath,'-f','lavfi','-i',`sine=frequency=${cue.id === 'c0' ? 440 : 880}:duration=4`,'-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',filePath]); return { materialId: `clip-${cue.id}`, filePath }; } });
  assert.deepEqual(videoInputs, ['target-c0','target-c1']); assert.ok(fs.statSync(result.outputPath).size > 1000); assert.ok(result.cues.every(cue => cue.targetFirstFrame?.state === 'ready' && cue.generatedClip?.state === 'ready'));
  const inspected = spawnSync(String(ffmpegStatic), ['-hide_banner','-i',result.outputPath,'-f','null','-'], { encoding:'utf8' });
  const match = String(inspected.stderr).match(/Duration:\s+(\d+):(\d+):([\d.]+)/); assert.ok(match);
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]); assert.ok(duration >= 1.9 && duration <= 2.1, `expected 2s, got ${duration}s`);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('non-person cues bypass first-frame and video generation suppliers', async () => {
  assert.ok(ffmpegStatic); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sentence-mixed-')); let firstFrames=0; let generatedVideos=0; let broll=0;
  const makeVideo=(filePath:string,color:string)=>execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=${color}:s=180x320:d=2`,'-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',filePath]);
  const cues:any[]=[{id:'person',start:0,end:1,originalText:'人',targetText:'人',shotIds:['s'],personShot:true,compositionClusterId:'front',sourceFirstFrame:{time:0,materialId:'frame'}},{id:'factory',start:1,end:2,originalText:'厂',targetText:'厂',shotIds:['s'],personShot:false,nonPersonMaterialId:'factory-video'}];
  await runSentenceReplicationPipeline({cues,outputPath:path.join(dir,'joined.mp4'),ffmpegPath:String(ffmpegStatic),createTargetFrame:async cue=>{firstFrames+=1;const filePath=path.join(dir,`${cue.id}.jpg`);execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=red:s=180x320','-frames:v','1','-y',filePath]);return{materialId:'target',filePath};},createSentenceVideo:async cue=>{generatedVideos+=1;const filePath=path.join(dir,`${cue.id}.mp4`);makeVideo(filePath,'red');return{materialId:'generated',filePath};},createNonPersonClip:async cue=>{broll+=1;const filePath=path.join(dir,`${cue.id}.mp4`);makeVideo(filePath,'blue');return{materialId:'factory-video',filePath};}});
  assert.equal(firstFrames,1); assert.equal(generatedVideos,1); assert.equal(broll,1); fs.rmSync(dir,{recursive:true,force:true});
});

test('repair runs reuse accepted clips and regenerate only failed cues',async()=>{
  assert.ok(ffmpegStatic);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sentence-repair-'));let frames=0;let videos=0;let reused=0;
  const makeVideo=(filePath:string,color:string)=>execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=${color}:s=180x320:d=2`,'-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',filePath]);
  const cues:any[]=[0,1].map(i=>({id:`c${i}`,start:i,end:i+1,originalText:'x',targetText:'y',shotIds:['s'],personShot:true,compositionClusterId:`cluster-${i}`,sourceFirstFrame:{time:i,materialId:`source-${i}`},targetFirstFrame:{materialId:`target-${i}`,state:'ready'},generatedClip:{materialId:`old-${i}`,state:'ready'}}));
  await runSentenceReplicationPipeline({cues,outputPath:path.join(dir,'joined.mp4'),ffmpegPath:String(ffmpegStatic),reuseCompletedClip:async cue=>{if(cue.id!=='c0')return null;reused+=1;const filePath=path.join(dir,'reused.mp4');makeVideo(filePath,'green');return{materialId:'old-c0',filePath};},createTargetFrame:async cue=>{assert.equal(cue.targetFirstFrame?.state,'ready');frames+=1;const filePath=path.join(dir,`${cue.id}.jpg`);execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=red:s=180x320','-frames:v','1','-y',filePath]);return{materialId:`new-target-${cue.id}`,filePath};},createSentenceVideo:async cue=>{videos+=1;const filePath=path.join(dir,`${cue.id}.mp4`);makeVideo(filePath,'red');return{materialId:`new-${cue.id}`,filePath};}});
  assert.equal(reused,1);assert.equal(frames,1);assert.equal(videos,1);fs.rmSync(dir,{recursive:true,force:true});
});
