import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {enforceVoiceDrivenVideoReview} from './socialVideoQualityReview.js';

test('third-frame subtitle failure resumes only after the user confirms that film, never a failed cut',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'video-human-style-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const outputPath=path.join(root,'film.mp4'),assPath=path.join(root,'film.ass');
 const result=await runVisualFfmpeg(['-f','lavfi','-i','color=c=black:s=64x64:r=5:d=1','-c:v','libx264','-y',outputPath]);assert.equal(result.ok,true,result.stderr);
 const ass='Style: Default,Arial,24,&H00FFFFFF,&H00FFFFFF\n';await writeFile(assPath,ass);
 const mediaSha256=createHash('sha256').update(await readFile(outputPath)).digest('hex');
 const scenes=[{sceneId:'slot1',targetStart:0,targetEnd:1}];let duration=1;
 const input={outputPath,duration:1,scenes,subtitleAssSidecar:{path:assPath,sha256:createHash('sha256').update(ass).digest('hex')},
  inspectSubtitleStyleFrame:async()=>({subtitlePresent:true,font:true,fontSize:true,color:false,reason:'actual pixel adapter fixture'}),
  measureVideoTimeline:async()=>({mediaSha256,durationSeconds:duration,scenes,evidenceRef:'actual-measurement-fixture'})};
 let saved=0;const persist=async(report:any)=>{saved++;assert.equal(report.subtitleStyle.samples.length,3);assert.equal(report.subtitleStyle.status,'blocked');};
 await assert.rejects(enforceVoiceDrivenVideoReview(input,persist,async()=>({decision:'accept_unknown'})),/subtitle_style_blocked/);
 const accepted=await enforceVoiceDrivenVideoReview(input,persist,async()=>({decision:'accept_subtitle_style'}));assert.ok('userAcceptance'in accepted);
 duration=1.301;let callback=false;
 await assert.rejects(enforceVoiceDrivenVideoReview(input,persist,async()=>{callback=true;return{decision:'accept_subtitle_style'};}),/subtitle_style_blocked/);
 assert.equal(callback,false);assert.equal(saved,3);
});
