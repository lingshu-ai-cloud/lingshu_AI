import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { probeSocialSceneMediaCached } from './socialSceneMediaProbeCache.js';
import type { SocialSceneMediaHardProbe } from './socialSceneMediaHardProbe.js';
const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(passed=true){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'media-hard-probe-cache-'));
 const file=(name:string)=>{const p=path.join(root,name);fs.writeFileSync(p,name);return p;};
 const output=file('final.mp4'),voice=file('voice.wav'),baseline=file('baseline.mp4'),ass=file('captions.ass');
 const input={filePath:output,manifest:{voiceover:{url:voice},timeline:[{sceneId:'scene',start:0,end:1}]},frozenVoiceCues:[{start:0,end:1,text:'hello'}],
  subtitleRenderEvidence:{schemaVersion:'rendered-subtitle-track.v1' as const,outputSha256:sha(output),assSha256:sha(ass),filterApplied:true},
  frameRenderEvidence:{schemaVersion:'renderer-frame-attestation.v1' as const,outputSha256:sha(output),fps:30 as const,durationSeconds:1,expectedFrames:30},
  captionMaskSources:{baselinePath:baseline,baselineSha256:sha(baseline),assPath:ass,assSha256:sha(ass)}};
 const scope={tenantId:'tenant',taskId:'task',runId:'run'};
 type Ports=NonNullable<Parameters<typeof probeSocialSceneMediaCached>[2]>;
 const records=new Map<string,any>();let calls=0;
 const ports:Ports={read:key=>records.get(key.inputHash)||null,write:async key=>{records.set(key.inputHash,structuredClone(key.payload));},
  probe:async current=>{calls++;return {version:'scene-media-hard-probe.v1',mediaSha256:sha(current.filePath),frozenVoiceSha256:sha(voice),timelineHash:'fixture',
   formatPassed:passed,formatReason:passed?'fixture passed':'fixture failed',scenes:[{audioIdentity:{status:'unknown',correlation:null,reason:'not measured'}}]} as SocialSceneMediaHardProbe;}};
 return {root,input,scope,ports,records,calls:()=>calls,clean:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('complete same-byte probe is checkpointed once and cloned without changing unknown findings',async()=>{
 const f=fixture();try{const first=await probeSocialSceneMediaCached(f.input,f.scope,f.ports);const second=await probeSocialSceneMediaCached(f.input,f.scope,f.ports);
 assert.equal(f.calls(),1);assert.deepEqual(second,first);second.formatPassed=false;
 assert.equal((await probeSocialSceneMediaCached(f.input,f.scope,f.ports)).formatPassed,true);
 assert.equal(second.scenes[0]?.audioIdentity?.status,'unknown');}finally{f.clean();}
});
test('a failed report remains failed on cache hits',async()=>{
 const f=fixture(false);try{assert.equal((await probeSocialSceneMediaCached(f.input,f.scope,f.ports)).formatPassed,false);
 assert.equal((await probeSocialSceneMediaCached(f.input,f.scope,f.ports)).formatPassed,false);assert.equal(f.calls(),1);}finally{f.clean();}
});
test('media, manifest, cues, renderer, master audio, baseline, ASS and policy changes require fresh probes',async()=>{
 const mutations=[(f:ReturnType<typeof fixture>)=>fs.appendFileSync(f.input.filePath,'changed'),
  (f:ReturnType<typeof fixture>)=>{f.input.manifest.timeline[0]!.end=2;},
  (f:ReturnType<typeof fixture>)=>{f.input.frozenVoiceCues[0]!.text='changed';},
  (f:ReturnType<typeof fixture>)=>{f.input.frameRenderEvidence.expectedFrames=31;},
  (f:ReturnType<typeof fixture>)=>{f.input.subtitleRenderEvidence.filterApplied=false;},
  (f:ReturnType<typeof fixture>)=>fs.appendFileSync(f.input.manifest.voiceover.url,'changed'),
  (f:ReturnType<typeof fixture>)=>{fs.appendFileSync(f.input.captionMaskSources.baselinePath,'changed');f.input.captionMaskSources.baselineSha256=sha(f.input.captionMaskSources.baselinePath);},
  (f:ReturnType<typeof fixture>)=>{fs.appendFileSync(f.input.captionMaskSources.assPath,'changed');f.input.captionMaskSources.assSha256=sha(f.input.captionMaskSources.assPath);},
  (f:ReturnType<typeof fixture>)=>{f.ports.policyVersion='changed-policy';}];
 for(const mutate of mutations){const f=fixture();try{await probeSocialSceneMediaCached(f.input,f.scope,f.ports);mutate(f);await probeSocialSceneMediaCached(f.input,f.scope,f.ports);assert.equal(f.calls(),2);}finally{f.clean();}}
});
test('scope drift and report/hash tampering never reuse another result',async()=>{
 const f=fixture();try{await probeSocialSceneMediaCached(f.input,f.scope,f.ports);const row=[...f.records.values()][0];row.result.formatPassed=false;
 await probeSocialSceneMediaCached(f.input,f.scope,f.ports);assert.equal(f.calls(),2);
 const row2=[...f.records.values()][0];row2.scope.taskId='foreign';await probeSocialSceneMediaCached(f.input,f.scope,f.ports);assert.equal(f.calls(),3);
 await probeSocialSceneMediaCached(f.input,{...f.scope,runId:'other-run'},f.ports);assert.equal(f.calls(),4);}finally{f.clean();}
});
test('missing or remotely unverifiable dependencies disable caching',async()=>{
 for(const missing of ['voice','baseline','ass','remote'] as const){const f=fixture();try{
  if(missing==='voice')fs.unlinkSync(f.input.manifest.voiceover.url);
  else if(missing==='baseline')fs.unlinkSync(f.input.captionMaskSources.baselinePath);
  else if(missing==='ass')fs.unlinkSync(f.input.captionMaskSources.assPath);
  else f.input.manifest.voiceover.url='https://example.test/voice.wav';
  f.ports.probe=async()=>{return {version:'scene-media-hard-probe.v1',mediaSha256:sha(f.input.filePath),frozenVoiceSha256:null,formatPassed:false,scenes:[]} as unknown as SocialSceneMediaHardProbe;};
  await probeSocialSceneMediaCached(f.input,f.scope,f.ports);await probeSocialSceneMediaCached(f.input,f.scope,f.ports);assert.equal(f.records.size,0);
 }finally{f.clean();}}
});
test('files changing during measurement cannot persist a stale pass',async()=>{
 const f=fixture();try{const original=f.ports.probe!;f.ports.probe=async input=>{const result=await original(input);fs.appendFileSync(input.filePath,'changed mid-probe');return result;};
 await assert.rejects(probeSocialSceneMediaCached(f.input,f.scope,f.ports),/inputs_changed/);assert.equal(f.records.size,0);}finally{f.clean();}
});

test('the same consumed media bytes under new temporary paths reuse the probe while byte or semantic changes invalidate it',async()=>{
 const f=fixture();try{
  Object.assign(f.input.manifest.timeline[0]!,{url:f.input.manifest.voiceover.url});
  await probeSocialSceneMediaCached(f.input,f.scope,f.ports);
  const moved=path.join(f.root,'new-workspace');fs.mkdirSync(moved);
  const copy=(source:string,name:string)=>{const target=path.join(moved,name);fs.copyFileSync(source,target);return target;};
  const copiedVoice=copy(f.input.manifest.voiceover.url,'renamed-voice.wav');
  const input={...f.input,filePath:copy(f.input.filePath,'renamed-final.mp4'),
   manifest:{...f.input.manifest,voiceover:{url:copiedVoice},timeline:f.input.manifest.timeline.map(row=>({...row,url:copiedVoice}))},
   captionMaskSources:{...f.input.captionMaskSources,baselinePath:copy(f.input.captionMaskSources.baselinePath,'renamed-baseline.mp4'),assPath:copy(f.input.captionMaskSources.assPath,'renamed.ass')}};
  const original=await probeSocialSceneMediaCached(f.input,f.scope,f.ports);
  const result=await probeSocialSceneMediaCached(input,f.scope,f.ports);
  assert.deepEqual(result,original);assert.equal(f.calls(),1,'temporary paths are not media identity');
  fs.appendFileSync(input.filePath,'actual-byte-change');await probeSocialSceneMediaCached(input,f.scope,f.ports);assert.equal(f.calls(),2);
 }finally{f.clean();}
});
