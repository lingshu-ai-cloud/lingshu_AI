import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {recognizeProductImageLocally} from '../lib/localProductOcr.js';
import {auditCaptionSpeechAlignment,auditCaptionTimeline,auditSensitiveFrozenSpeech,planCaptionSampleTimes,planSensitiveScreenSampleTimes,probeSocialSceneMedia,shouldRunDefaultCaptionDecodedFrameAudit} from './socialSceneMediaHardProbe.js';
import {initialSceneG4Evidence,type InitialSceneQualityReport} from './socialContentInitialSceneCache.js';
import {inspectSensitiveScreenText} from './socialSceneSensitiveScreenAudit.js';

test('default exhaustive caption OCR is restricted to independently counted short renders',()=>{
 const eligible={subtitleRendered:true,coverageStatus:'observed' as const,coverageSha256:'a'.repeat(64),mediaSha256:'a'.repeat(64),decodedFrames:300,expectedDurationSeconds:10,cueCount:1,manifestValid:true};
 assert.equal(shouldRunDefaultCaptionDecodedFrameAudit(eligible),true);
 assert.equal(shouldRunDefaultCaptionDecodedFrameAudit({...eligible,decodedFrames:301}),false);
 assert.equal(shouldRunDefaultCaptionDecodedFrameAudit({...eligible,expectedDurationSeconds:10.001}),false);
 assert.equal(shouldRunDefaultCaptionDecodedFrameAudit({...eligible,coverageSha256:'b'.repeat(64)}),false);
 assert.equal(shouldRunDefaultCaptionDecodedFrameAudit({...eligible,coverageStatus:'unknown'}),false);
 assert.equal(shouldRunDefaultCaptionDecodedFrameAudit({...eligible,subtitleRendered:false}),false);
});

test('screen-text alarm detects high-confidence secrets without treating a contact number as private data',()=>{
 const prefix='11010119900101001',weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
 const check='10X98765432'[weights.reduce((total,weight,index)=>total+Number(prefix[index])*weight,0)%11];
 const syntheticIdentity=prefix+check;
 assert.deepEqual(inspectSensitiveScreenText(`身份证 ${syntheticIdentity}`),['resident_identity_number']);
 assert.deepEqual(inspectSensitiveScreenText(`身份证 ${prefix}${check==='0'?'1':'0'}`),[]);
 assert.deepEqual(inspectSensitiveScreenText('-----BEGIN PRIVATE KEY-----'),['private_key_marker']);
 assert.deepEqual(inspectSensitiveScreenText('Contact us on WhatsApp +8619653282176'),[]);
});

test('frozen speech alarm blocks high-confidence planned disclosure but never clears final audio',()=>{
 const prefix='11010119900101001',weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
 const check='10X98765432'[weights.reduce((total,weight,index)=>total+Number(prefix[index])*weight,0)%11];
 const syntheticIdentity=prefix+check;
 const hit=auditSensitiveFrozenSpeech([{start:0,end:1,text:`请联系 ${syntheticIdentity}`},{start:1,end:2,text:'-----BEGIN PRIVATE KEY-----'}]);
 assert.equal(hit.status,'hit');assert.deepEqual(hit.findingCodes,['private_key_marker','resident_identity_number']);assert.deepEqual(hit.findingCueIndexes,[0,1]);
 assert.ok(!JSON.stringify(hit).includes(syntheticIdentity),'quality evidence must not persist sensitive text');
 const contact=auditSensitiveFrozenSpeech([{start:0,end:1,text:'Contact us on WhatsApp +8619653282176'}]);
 assert.equal(contact.status,'not_observed');assert.match(contact.reason,/未检查最终音频/);
 assert.equal(auditSensitiveFrozenSpeech([]).status,'unknown');
 assert.equal(auditSensitiveFrozenSpeech([{text:''}]).status,'unknown');
});

test('privacy sampling covers short-lived overlays between old anchors and stays bounded',()=>{
 const short=planSensitiveScreenSampleTimes(0,2);
 assert.ok(short.includes(0.5),'a transient at 0.5 seconds was missed by 10/50/90% anchors');
 assert.ok(short.includes(1.5));
 assert.ok(short.length>3);
 const long=planSensitiveScreenSampleTimes(0,120);
 assert.ok(long.length<=32);
 assert.ok(long[0]!<15&&long.at(-1)!>105);
 assert.deepEqual(planSensitiveScreenSampleTimes(2,1),[]);
});

test('caption sampling covers interior gaps without silently downsampling over-budget cues',()=>{
 assert.deepEqual(planCaptionSampleTimes(0,2),[0.2,0.5,1,1.5,1.8]);
 assert.equal(planCaptionSampleTimes(0,20),null);
 assert.equal(planCaptionSampleTimes(1,1.1),null);
});

test('caption timeline audits omissions and cross-scene cues without promoting OCR to G4 pass',()=>{
 const timeline=[{targetStart:0,targetEnd:1},{targetStart:1,targetEnd:2}];
 const crossing=auditCaptionTimeline({duration:2,timeline,rawCues:[{start:0.2,end:1.4,text:'HELLO'}]});
 assert.equal(crossing.status,'valid');assert.deepEqual(crossing.crossSceneCueIndexes,[0]);assert.deepEqual(crossing.uncoveredSceneIndexes,[]);
 const missing=auditCaptionTimeline({duration:2,timeline,rawCues:[{start:0.2,end:0.8,text:'HELLO'}]});
 assert.deepEqual(missing.uncoveredSceneIndexes,[1]);
 const malformed=auditCaptionTimeline({duration:2,timeline,rawCues:[{start:0.2,end:2.4,text:'HELLO'}]});
 assert.equal(malformed.status,'invalid');
 const reverse=auditCaptionTimeline({duration:2,timeline,rawCues:[{start:1.1,end:1.4,text:'LATER'},{start:0.1,end:0.4,text:'EARLIER'}]});
 assert.equal(reverse.status,'invalid');
 const noSceneClock=auditCaptionTimeline({duration:2,timeline:[{targetStart:0,targetEnd:0.9},{targetStart:1,targetEnd:2}],rawCues:[]});
 assert.equal(noSceneClock.status,'unknown');
});

test('measured master speech and every frozen caption remain one-to-one without promoting pixels to pass',()=>{
 const voice=[{start:0.1,end:0.8,text:'Hello world'},{start:1.1,end:1.8,text:'Free sample'}];
 const matched=auditCaptionSpeechAlignment({duration:2,rawVoiceCues:voice,rawCaptions:structuredClone(voice)});
 assert.equal(matched.status,'matched');assert.equal(matched.mismatchIndexes.length,0);assert.match(matched.frozenVoiceCueHash??'',/^[a-f0-9]{64}$/);
 const omitted=auditCaptionSpeechAlignment({duration:2,rawVoiceCues:voice,rawCaptions:[voice[0]]});assert.equal(omitted.status,'mismatch');assert.deepEqual(omitted.mismatchIndexes,[1]);
 const changed=auditCaptionSpeechAlignment({duration:2,rawVoiceCues:voice,rawCaptions:[voice[0],{...voice[1],text:'Call today'}]});assert.equal(changed.status,'mismatch');assert.deepEqual(changed.mismatchIndexes,[1]);
 const drifted=auditCaptionSpeechAlignment({duration:2,rawVoiceCues:voice,rawCaptions:[voice[0],{...voice[1],start:1.15}]});assert.equal(drifted.status,'mismatch');assert.ok(drifted.maxBoundaryErrorSeconds!>0.02);
 const missing=auditCaptionSpeechAlignment({duration:2,rawCaptions:voice});assert.equal(missing.status,'unknown');
});

test('byte-bound MP4 format and both frozen scene windows pass; unmeasured checks remain pending',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'scene-g4-probe-'));
 try{
  const filePath=path.join(root,'media.mp4');const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',filePath]);assert.equal(made.ok,true,made.stderr);
  const manifest={spec:{duration:2},timeline:[{sceneId:'a',targetStart:0,targetEnd:1},{sceneId:'b',targetStart:1,targetEnd:2}]};
  const mediaHardProbe=await probeSocialSceneMedia({filePath,manifest});assert.equal(mediaHardProbe.mediaSha256,createHash('sha256').update(await readFile(filePath)).digest('hex'));assert.equal(mediaHardProbe.formatPassed,true,mediaHardProbe.formatReason);assert.ok(mediaHardProbe.scenes.every(s=>s.durationPassed&&s.audioWindowDecoded===true),JSON.stringify(mediaHardProbe.scenes));
  assert.equal(mediaHardProbe.finalPrivacyCoverage?.status,'unknown','formal manifest has no independently frozen frame count');
  assert.equal(mediaHardProbe.finalPrivacyCoverage?.video.decodedFrames,50,'the probe still records actual decoded coverage without self-certifying it');
  assert.ok(mediaHardProbe.scenes.every(s=>(s.sensitiveScreenEvidence?.samples.length??0)>=3));
  const report:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[],metrics:{sampleCount:2,contentFrameCount:2,nonBackgroundFrameRatio:1,meanBrightness:100,meanLumaDeviation:20,meanEdgeRatio:1,meanFrameDifference:1,maxFrameDifference:1,motionDetected:false,estimatedDistinctFrames:2,nearDuplicateFrameRatio:0,sharpFrameRatio:1},evidenceFrames:[]},scenes:{passed:true,issues:[],checkedScenes:2},audio:{ok:true,error:null},mediaHardProbe};
  const evidence=initialSceneG4Evidence(report,1,2,'a'.repeat(64));assert.equal(evidence.status,'review_required');assert.deepEqual(evidence.checks.filter(c=>c.passed).map(c=>c.code),['format','duration','linked_assets','render']);assert.deepEqual(evidence.checks.filter(c=>!c.passed).map(c=>c.code),['audio_visual_sync','caption','sensitive_data']);
  const sensitive={status:'hit' as const,samples:[{atSeconds:1.5,frameSha256:'a'.repeat(64),ocrSha256:'b'.repeat(64),findingCodes:['resident_identity_number' as const]}],reason:'最终 MP4 抽样帧 OCR 出现疑似身份证号'};
  const alarm=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,scenes:mediaHardProbe.scenes.map((scene,index)=>index===1?{...scene,sensitiveScreenEvidence:sensitive}:scene)}},1,2,'a'.repeat(64));
  assert.equal(alarm.status,'failed');assert.equal(alarm.checks.find(c=>c.code==='sensitive_data')?.passed,false);assert.match(alarm.checks.find(c=>c.code==='sensitive_data')?.message??'',/疑似身份证号/);
  const speechAlarm=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,sensitiveFrozenSpeechEvidence:auditSensitiveFrozenSpeech([{start:0,end:1,text:'-----BEGIN PRIVATE KEY-----'}])}},1,2,'a'.repeat(64));
  assert.equal(speechAlarm.status,'failed');assert.match(speechAlarm.checks.find(c=>c.code==='sensitive_data')?.message??'',/冻结主音轨/);
  const transientAlarm=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,finalSensitiveFrameAudit:{schemaVersion:'final-sensitive-frame-audit.v1',status:'hit',mediaSha256:mediaHardProbe.mediaSha256,expectedFrameCount:50,checkedFrameCount:50,findingFrameIndexes:[13],findingCodes:['resident_identity_number'],frameEvidence:[],reason:'真实单帧命中'}}},1,2,'a'.repeat(64));
  assert.equal(transientAlarm.status,'failed');assert.match(transientAlarm.checks.find(c=>c.code==='sensitive_data')?.message??'',/单帧命中/);
  const wrongAss=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,captionMaskAudit:{status:'unknown',finalSha256:mediaHardProbe.mediaSha256,baselineSha256:'a'.repeat(64),assSha256:'b'.repeat(64),frameCount:0,activeFrameCount:0,missingFrameIndexes:[],reason:'wrong ASS cue',plainCueBinding:{status:'mismatch',reason:'wrong ASS cue'}}}},1,2,'a'.repeat(64));
  assert.equal(wrongAss.status,'failed');assert.match(wrongAss.checks.find(c=>c.code==='caption')?.message??'',/wrong ASS cue/);
  const drift=await probeSocialSceneMedia({filePath,manifest:{...manifest,spec:{duration:2.6}}});assert.equal(drift.formatPassed,true);assert.ok(drift.scenes.every(s=>!s.durationPassed));
  const driftEvidence=initialSceneG4Evidence({...report,mediaHardProbe:drift},0,2,'a'.repeat(64));assert.equal(driftEvidence.status,'failed');assert.equal(driftEvidence.checks.find(c=>c.code==='duration')?.passed,false);
  const wrongFormat=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,videoCodec:'vp9',formatPassed:false}},0,2,'a'.repeat(64));assert.equal(wrongFormat.status,'failed');assert.equal(wrongFormat.checks.find(c=>c.code==='format')?.passed,false);
  const invalidDimensions=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,width:32,formatPassed:false}},0,2,'a'.repeat(64));assert.equal(invalidDimensions.status,'failed');
  const missingSceneAudio=initialSceneG4Evidence({...report,mediaHardProbe:{...mediaHardProbe,scenes:mediaHardProbe.scenes.map((scene,index)=>index===1?{...scene,audioWindowDecoded:false}:scene)}},1,2,'a'.repeat(64));assert.equal(missingSceneAudio.status,'failed');assert.equal(missingSceneAudio.checks.find(c=>c.code==='audio_visual_sync')?.passed,false);assert.match(missingSceneAudio.checks.find(c=>c.code==='audio_visual_sync')?.message??'',/没有可解码音频采样/);
  const videoOnly=path.join(root,'video-only.mp4');const madeWithoutAudio=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-c:v','libx264','-pix_fmt','yuv420p','-an',videoOnly]);assert.equal(madeWithoutAudio.ok,true,madeWithoutAudio.stderr);const noAudioProbe=await probeSocialSceneMedia({filePath:videoOnly,manifest});assert.equal(noAudioProbe.formatPassed,false);assert.ok(noAudioProbe.scenes.every(s=>s.audioWindowDecoded===false));
  const cutAudio=path.join(root,'cut-audio.mp4');const cut=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.75','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',cutAudio]);assert.equal(cut.ok,true,cut.stderr);const cutProbe=await probeSocialSceneMedia({filePath:cutAudio,manifest});assert.equal(cutProbe.formatPassed,true);assert.equal(cutProbe.scenes[0]?.audioWindowDecoded,true);assert.equal(cutProbe.scenes[1]?.audioWindowDecoded,false,'last scene midpoint is audible, but its end must not silently pass');const cutEvidence=initialSceneG4Evidence({...report,mediaHardProbe:cutProbe},1,2,'a'.repeat(64));assert.equal(cutEvidence.status,'failed');
  await appendFile(filePath,Buffer.from([0x51]));const reprobed=await probeSocialSceneMedia({filePath,manifest});assert.notEqual(reprobed.mediaSha256,mediaHardProbe.mediaSha256);assert.equal(reprobed.timelineHash,mediaHardProbe.timelineHash);assert.ok(reprobed.scenes.every(s=>s.audioWindowDecoded===true));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('frozen voice and final MP4 are compared on actual scene windows without claiming lip sync',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'scene-g4-voice-'));
 try{
  const voice=path.join(root,'voice.wav'),output=path.join(root,'output.mp4'),wrong=path.join(root,'wrong.mp4');
  const madeVoice=await runVisualFfmpeg(['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:a','pcm_s16le',voice]);assert.equal(madeVoice.ok,true,madeVoice.stderr);
  for(const [target,tone]of [[output,440],[wrong,880]] as const){const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=128x128:r=25:d=2','-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000:duration=2`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',target]);assert.equal(made.ok,true,made.stderr);}
  const manifest={spec:{duration:2},timeline:[{sceneId:'a',targetStart:0,targetEnd:1},{sceneId:'b',targetStart:1,targetEnd:2}],voiceover:{url:voice}};
  const matched=await probeSocialSceneMedia({filePath:output,manifest}),mismatched=await probeSocialSceneMedia({filePath:wrong,manifest});
  assert.equal(matched.frozenVoiceSha256,createHash('sha256').update(await readFile(voice)).digest('hex'));
  assert.ok(matched.scenes.every(scene=>scene.audioIdentity?.status==='passed'),JSON.stringify(matched.scenes));
  assert.ok(mismatched.scenes.every(scene=>scene.audioIdentity?.status==='failed'),JSON.stringify(mismatched.scenes));
  assert.equal(matched.fullFrozenAudioIdentity?.status,'matched',matched.fullFrozenAudioIdentity?.reason);
  assert.equal(matched.fullFrozenAudioIdentity?.checkedWindows,2);
  assert.equal(mismatched.fullFrozenAudioIdentity?.status,'failed');
  assert.deepEqual(mismatched.fullFrozenAudioIdentity?.failedWindowIndexes,[0,1]);
  const report:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[],metrics:{sampleCount:2,contentFrameCount:2,nonBackgroundFrameRatio:1,meanBrightness:100,meanLumaDeviation:20,meanEdgeRatio:1,meanFrameDifference:1,maxFrameDifference:1,motionDetected:false,estimatedDistinctFrames:2,nearDuplicateFrameRatio:0,sharpFrameRatio:1},evidenceFrames:[]},scenes:{passed:true,issues:[],checkedScenes:2},audio:{ok:true,error:null},mediaHardProbe:matched};
  const good=initialSceneG4Evidence(report,0,2,'a'.repeat(64));assert.equal(good.status,'review_required');assert.equal(good.checks.find(c=>c.code==='audio_visual_sync')?.passed,false);
  const bad=initialSceneG4Evidence({...report,mediaHardProbe:mismatched},0,2,'a'.repeat(64));assert.equal(bad.status,'failed');assert.match(bad.checks.find(c=>c.code==='audio_visual_sync')?.message??'',/明显不一致/);
  const withMusic=await probeSocialSceneMedia({filePath:wrong,manifest:{...manifest,bgm:'music.mp3'}});assert.ok(withMusic.scenes.every(scene=>scene.audioIdentity?.status==='unknown'));assert.equal(withMusic.fullFrozenAudioIdentity,undefined,'mixing requires an independent component-aware audit');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('frozen caption text is only a byte-bound sampled OCR observation, never a complete G4 caption pass',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'scene-g4-caption-'));
 try{
  const filePath=path.join(root,'caption.mp4');
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-vf','drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text=HELLO:fontcolor=white:fontsize=90:x=(w-text_w)/2:y=(h-text_h)/2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',filePath]);
  assert.equal(made.ok,true,made.stderr);
  const manifest={spec:{duration:2},timeline:[{sceneId:'a',targetStart:0,targetEnd:2}],subtitles:{cues:[{start:0,end:2,text:'HELLO'}]}};
  const probe=await probeSocialSceneMedia({filePath,manifest});
  assert.equal(probe.scenes[0]?.captionEvidence?.status,'observed',JSON.stringify(probe.scenes[0]?.captionEvidence));
  assert.equal(probe.scenes[0]?.captionEvidence?.cueCount,1);
  assert.equal(probe.scenes[0]?.captionEvidence?.sampledFrames?.length,5);
  assert.equal(probe.subtitleTrack?.status,'unknown','OCR alone cannot prove actual renderer subtitle provenance');
  assert.equal(probe.captionSpeechAlignment?.status,'unknown','OCR alone cannot prove frozen spoken-text mapping');
  const spoken=await probeSocialSceneMedia({filePath,manifest,frozenVoiceCues:[{start:0,end:2,text:'HELLO'}]});
  assert.equal(spoken.captionSpeechAlignment?.status,'matched');
  assert.equal(spoken.sensitiveFrozenSpeechEvidence?.status,'not_observed');
  const wrongSpeech=await probeSocialSceneMedia({filePath,manifest,frozenVoiceCues:[{start:0,end:2,text:'WORLD'}]});
  assert.equal(wrongSpeech.captionSpeechAlignment?.status,'mismatch');
  const rendered=await probeSocialSceneMedia({filePath,manifest,subtitleRenderEvidence:{schemaVersion:'rendered-subtitle-track.v1',outputSha256:probe.mediaSha256,assSha256:'a'.repeat(64),filterApplied:true}});
  assert.equal(rendered.subtitleTrack?.status,'rendered');
  const drifted=await probeSocialSceneMedia({filePath,manifest,subtitleRenderEvidence:{schemaVersion:'rendered-subtitle-track.v1',outputSha256:'b'.repeat(64),assSha256:'a'.repeat(64),filterApplied:true}});
  assert.equal(drifted.subtitleTrack?.status,'unknown');
  const report:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[],metrics:{sampleCount:1,contentFrameCount:1,nonBackgroundFrameRatio:1,meanBrightness:100,meanLumaDeviation:20,meanEdgeRatio:1,meanFrameDifference:1,maxFrameDifference:1,motionDetected:false,estimatedDistinctFrames:1,nearDuplicateFrameRatio:0,sharpFrameRatio:1},evidenceFrames:[]},scenes:{passed:true,issues:[],checkedScenes:1},audio:{ok:true,error:null},mediaHardProbe:probe};
  const evidence=initialSceneG4Evidence(report,0,1,'a'.repeat(64));assert.equal(evidence.status,'review_required');assert.equal(evidence.checks.find(c=>c.code==='caption')?.passed,false);assert.match(evidence.checks.find(c=>c.code==='caption')?.message??'',/完整烧录字幕仍待复核/);
  const failedSpeech=initialSceneG4Evidence({...report,mediaHardProbe:wrongSpeech},0,1,'a'.repeat(64));assert.equal(failedSpeech.status,'failed');assert.match(failedSpeech.checks.find(c=>c.code==='caption')?.message??'',/不一致/);
  const wrong=await probeSocialSceneMedia({filePath,manifest:{...manifest,subtitles:{cues:[{start:0,end:2,text:'WORLD'}]}}});assert.equal(wrong.scenes[0]?.captionEvidence?.status,'unknown');
  const brieflyHidden=path.join(root,'briefly-hidden.mp4');
  const hidden=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-vf',"drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text=HELLO:fontcolor=white:fontsize=90:x=(w-text_w)/2:y=(h-text_h)/2,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0.35,0.65)'",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',brieflyHidden]);
  assert.equal(hidden.ok,true,hidden.stderr);
  const hiddenProbe=await probeSocialSceneMedia({filePath:brieflyHidden,manifest});
  assert.equal(hiddenProbe.scenes[0]?.captionEvidence?.status,'unknown','a missing interior subtitle at 0.5 seconds must not be reported as observed');
  assert.equal(hiddenProbe.scenes[0]?.captionEvidence?.sampledFrames?.length,1,'0.2 second anchor is observed, 0.5 second grid check catches the omission');
  const betweenSamples=path.join(root,'between-samples.mp4');
  const gap=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-vf',"drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text=HELLO:fontcolor=white:fontsize=90:x=(w-text_w)/2:y=(h-text_h)/2,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0.28,0.32)'",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',betweenSamples]);
  assert.equal(gap.ok,true,gap.stderr);
  const gapProbe=await probeSocialSceneMedia({filePath:betweenSamples,manifest,frozenVoiceCues:[{start:0,end:2,text:'HELLO'}]});
  assert.equal(gapProbe.scenes[0]?.captionEvidence?.status,'observed','sampled OCR can miss a subtitle-free frame between its anchors');
  const gapFrame=await runVisualFfmpeg(['-ss','0.300','-i',betweenSamples,'-frames:v','1','-an','-vf','scale=960:-2','-f','image2pipe','-vcodec','png','pipe:1'],true);
  assert.equal(gapFrame.ok,true,gapFrame.stderr);
  assert.doesNotMatch(await recognizeProductImageLocally({bytes:gapFrame.stdout,mimeType:'image/png'}),/HELLO/i);
  const gapEvidence=initialSceneG4Evidence({...report,mediaHardProbe:gapProbe},0,1,'a'.repeat(64));
  assert.equal(gapEvidence.status,'review_required');
  assert.equal(gapEvidence.checks.find(c=>c.code==='caption')?.passed,false,'a sampled OCR observation is not full-frame subtitle coverage');
 }finally{await rm(root,{recursive:true,force:true});}
});
