import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {auditCaptionMaskFrames} from './socialCaptionMaskFrameAudit.js';
import {probeSocialSceneMedia} from './socialSceneMediaHardProbe.js';
import {proveSimpleCaptionPixels} from './socialCaptionSimplePixelProof.js';
import {freezeSocialRenderFrameContract} from './socialRenderFrameContract.js';
import {initialSceneG4Evidence} from './socialContentInitialSceneCache.js';

const sha=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,80,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,2,0,2,20,20,30,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,HELLO\n`;

test('same-graph baseline and actual subtitle pixels produce bounded PTS mask observation; missing subtitle stays unknown',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'caption-mask-real-'));
 try{
  const assPath=path.join(root,'track.ass'),finalPath=path.join(root,'final.mp4'),baselinePath=path.join(root,'baseline.mp4');
  await writeFile(assPath,ass);
  const graph=`[0:v]split=2[base][captioninput];[captioninput]subtitles='${assPath}'[captioned]`;
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=1',
    '-f','lavfi','-i','sine=frequency=440:duration=1','-filter_complex',graph,
    '-map','[captioned]','-map','1:a','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-c:a','aac',finalPath,
    '-map','[base]','-an','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p',baselinePath]);
  assert.equal(made.ok,true,made.stderr);
  const input={finalPath,baselinePath,assPath,expectedFinalSha256:await sha(finalPath),expectedBaselineSha256:await sha(baselinePath),expectedAssSha256:await sha(assPath),durationSeconds:1,width:640,height:360};
  const positive=await auditCaptionMaskFrames(input);
  assert.equal(positive.status,'observed_mask_delta',JSON.stringify(positive));assert.equal(positive.frameCount,30);assert.equal(positive.activeFrameCount,30);
  const frameContract=freezeSocialRenderFrameContract(1),manifest={spec:{duration:1},frameContract,timeline:[{sceneId:'one',targetStart:0,targetEnd:1}],subtitles:{cues:[{start:0,end:1,text:'HELLO'}]}};
  const frameRenderEvidence={schemaVersion:'renderer-frame-attestation.v1' as const,outputSha256:input.expectedFinalSha256,fps:30 as const,durationSeconds:1,expectedFrames:30};
  const integrated=await probeSocialSceneMedia({filePath:finalPath,manifest,frozenVoiceCues:[{start:0,end:1,text:'HELLO'}],frameRenderEvidence,subtitleRenderEvidence:{schemaVersion:'rendered-subtitle-track.v1',outputSha256:input.expectedFinalSha256,assSha256:input.expectedAssSha256,filterApplied:true},captionMaskSources:{baselinePath,baselineSha256:input.expectedBaselineSha256,assPath,assSha256:input.expectedAssSha256}});
  assert.equal(integrated.captionMaskAudit?.status,'observed_mask_delta');
  assert.equal(integrated.captionMaskAudit?.plainCueBinding?.status,'matched');
  assert.equal(integrated.captionMaskAudit?.simplePixelProof?.status,'matched',JSON.stringify(integrated.captionMaskAudit?.simplePixelProof));
  assert.equal(integrated.captionDecodedFrameAudit?.status,'observed_all_decoded_frames',integrated.captionDecodedFrameAudit?.reason);
  assert.equal(integrated.captionDecodedFrameAudit?.checkedFrameCount,30);
  const evidence=(probe:typeof integrated)=>initialSceneG4Evidence({schemaVersion:'initial-scene-quality.v1',visual:{passed:true,failures:[]} as any,scenes:{passed:true,issues:[],checkedScenes:1},audio:{ok:true,error:null},mediaHardProbe:probe},0,1,'a'.repeat(64));
  assert.equal(integrated.captionSpeechAlignment?.status,'matched');
  assert.equal(integrated.finalPrivacyCoverage?.status,'observed');
  assert.equal(evidence(integrated).checks.find(check=>check.code==='caption')?.passed,true,'source, same-render mask, complete frame count and plain pixel template jointly certify only caption');
  assert.equal(evidence(integrated).status,'review_required','lip sync and sensitive data remain unproved');
  assert.equal(evidence({...integrated,captionSpeechAlignment:{...integrated.captionSpeechAlignment!,status:'unknown'}}).checks.find(check=>check.code==='caption')?.passed,false);
  assert.equal(evidence({...integrated,finalPrivacyCoverage:{...integrated.finalPrivacyCoverage!,status:'unknown'}}).checks.find(check=>check.code==='caption')?.passed,false);
  assert.equal(evidence({...integrated,captionMaskAudit:{...integrated.captionMaskAudit!,simplePixelProof:{...integrated.captionMaskAudit!.simplePixelProof!,status:'unknown'}}}).checks.find(check=>check.code==='caption')?.passed,false);
  const noFrameReceipt=await probeSocialSceneMedia({filePath:finalPath,manifest,subtitleRenderEvidence:{schemaVersion:'rendered-subtitle-track.v1',outputSha256:input.expectedFinalSha256,assSha256:input.expectedAssSha256,filterApplied:true}});
  assert.equal(noFrameReceipt.captionDecodedFrameAudit,undefined,'missing independent frame count must not run exhaustive OCR as authoritative coverage');
  const wrongFrozen=await probeSocialSceneMedia({filePath:finalPath,manifest:{spec:{duration:1},timeline:[{sceneId:'one',targetStart:0,targetEnd:1}],subtitles:{cues:[{start:0,end:1,text:'HELL'}]}},subtitleRenderEvidence:{schemaVersion:'rendered-subtitle-track.v1',outputSha256:input.expectedFinalSha256,assSha256:input.expectedAssSha256,filterApplied:true},captionMaskSources:{baselinePath,baselineSha256:input.expectedBaselineSha256,assPath,assSha256:input.expectedAssSha256}});
  assert.equal(wrongFrozen.captionMaskAudit?.status,'unknown');
  assert.equal(wrongFrozen.captionMaskAudit?.plainCueBinding?.status,'mismatch');
  const noCaption=path.join(root,'no-caption.mp4');await copyFile(baselinePath,noCaption);
  const missing=await auditCaptionMaskFrames({...input,finalPath:noCaption,expectedFinalSha256:await sha(noCaption)});
  assert.equal(missing.status,'unknown');assert.ok(missing.missingFrameIndexes.length>0);
  const obscuredPath=path.join(root,'obscured.mp4');
  const covered=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=1',
    '-f','lavfi','-i','sine=frequency=440:duration=1',
    '-vf',`subtitles='${assPath}',drawbox=x=0:y=220:w=640:h=140:color=black:t=fill:enable='between(t,0.3,0.4)'`,
    '-map','0:v','-map','1:a','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-c:a','aac',obscuredPath]);
  assert.equal(covered.ok,true,covered.stderr);
  const obscured=await auditCaptionMaskFrames({...input,finalPath:obscuredPath,expectedFinalSha256:await sha(obscuredPath)});
  assert.equal(obscured.status,'unknown',JSON.stringify(obscured));assert.ok(obscured.missingFrameIndexes.some(index=>index>=9&&index<=12),JSON.stringify(obscured));
  const shortObstruction=await proveSimpleCaptionPixels({finalPath:obscuredPath,baselinePath,assPath,width:640,height:360,expectedFrameCount:30});
  assert.equal(shortObstruction.status,'unknown');assert.ok((shortObstruction.failedFrameIndex??-1)>=9);
  const drift=await auditCaptionMaskFrames({...input,expectedAssSha256:'0'.repeat(64)});assert.equal(drift.status,'unknown');assert.match(drift.reason,/漂移/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('packaging text in both branches cannot masquerade as burned subtitle',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'caption-mask-packaging-'));
 try{
  const assPath=path.join(root,'track.ass'),finalPath=path.join(root,'final.mp4'),baselinePath=path.join(root,'baseline.mp4');await writeFile(assPath,ass);
  const graph="[0:v]drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text=HELLO:fontcolor=white:fontsize=80:x=(w-text_w)/2:y=230,split=2[final][base]";
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=1',
    '-filter_complex',graph,'-map','[final]','-an','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p',finalPath,
    '-map','[base]','-an','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p',baselinePath]);assert.equal(made.ok,true,made.stderr);
  const observed=await auditCaptionMaskFrames({finalPath,baselinePath,assPath,expectedFinalSha256:await sha(finalPath),expectedBaselineSha256:await sha(baselinePath),expectedAssSha256:await sha(assPath),durationSeconds:1,width:640,height:360});
  assert.equal(observed.status,'unknown');assert.ok(observed.missingFrameIndexes.length>0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('one missing character cannot be accepted merely because the other caption glyphs remain',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'caption-mask-one-glyph-'));
 try{
  const assPath=path.join(root,'expected.ass'),actualAssPath=path.join(root,'actual.ass'),finalPath=path.join(root,'final.mp4'),baselinePath=path.join(root,'baseline.mp4');
  await writeFile(assPath,ass);
  await writeFile(actualAssPath,ass.replace(',,HELLO\n',',,HELL\n'));
  const graph=`[0:v]split=2[base][captioninput];[captioninput]subtitles='${actualAssPath}'[captioned]`;
  const made=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=1',
   '-filter_complex',graph,'-map','[captioned]','-an','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p',finalPath,
   '-map','[base]','-an','-t','1','-c:v','libx264','-crf','20','-pix_fmt','yuv420p',baselinePath]);
  assert.equal(made.ok,true,made.stderr);
  const observed=await auditCaptionMaskFrames({finalPath,baselinePath,assPath,expectedFinalSha256:await sha(finalPath),expectedBaselineSha256:await sha(baselinePath),expectedAssSha256:await sha(assPath),durationSeconds:1,width:640,height:360});
  assert.equal(observed.status,'unknown',JSON.stringify(observed));
  const changedCharacter=await proveSimpleCaptionPixels({finalPath,baselinePath,assPath,width:640,height:360,expectedFrameCount:30});
  assert.equal(changedCharacter.status,'unknown');assert.match(changedCharacter.reason,/模板像素不一致/);
 }finally{await rm(root,{recursive:true,force:true});}
});
