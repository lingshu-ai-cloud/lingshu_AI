import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {executeSocialRenderStage,persistPrivateAssSidecar,persistPrivateCaptionBaseline,recoveredSubtitleTrackEvidenceUsable,verifyPrivateAssSidecar,verifyPrivateCaptionBaseline,verifySocialSubtitleRenderAttestation} from './socialContentProductionStages.js';

const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const cues=[{start:0,end:1,text:'HELLO PRODUCT'}];
const manifest={subtitles:{cues},timeline:[],spec:{duration:1}};
const attestation=(outputSha256:string)=>({schemaVersion:'renderer-subtitle-attestation.v2' as const,outputSha256,
  assSha256:sha('actual ASS bytes'),filterApplied:true,subtitleCueSha256:sha(JSON.stringify(cues)),filterGraphSha256:sha('actual FFmpeg graph')});

test('only a renderer v2 report bound to the frozen cues and actual output bytes becomes G4-visible',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'social-render-attestation-'));
  try{
    const outputPath=path.join(directory,'output.mp4');
    await writeFile(outputPath,'actual rendered bytes');
    const outputSha256=sha('actual rendered bytes');
    const run=async(report:unknown)=>executeSocialRenderStage({tenantId:'tenant',taskId:'task',runId:'run',manifest:manifest as never,
      outputDirectory:directory,checkpointEnabled:false,render:async()=>({ok:true,outputPath,subtitleRenderEvidence:report} as never)});
    const valid=await run(attestation(outputSha256));
    assert.equal(valid.receipt.subtitleRenderEvidence?.assSha256,sha('actual ASS bytes'));
    assert.equal(valid.receipt.rendererAttestation?.filterGraphSha256,sha('actual FFmpeg graph'));
    assert.equal(recoveredSubtitleTrackEvidenceUsable(valid.receipt as never,false),false,
      'a restart may reuse the MP4 but must not retain a subtitle-track claim without private ASS bytes');
    assert.equal(recoveredSubtitleTrackEvidenceUsable(valid.receipt as never,true),true);
    for(const invalid of [
      {...attestation(outputSha256),outputSha256:sha('unrelated output')},
      {...attestation(outputSha256),subtitleCueSha256:sha('different subtitle')},
      {...attestation(outputSha256),filterGraphSha256:'not-a-digest'},
      {...attestation(outputSha256),filterApplied:false},
      {schemaVersion:'rendered-subtitle-track.v1',assSha256:sha('old weak report'),filterApplied:true},
    ]){
      const result=await run(invalid);
      assert.equal(result.receipt.subtitleRenderEvidence,undefined);
      assert.equal(result.receipt.rendererAttestation,undefined);
    }
    assert.equal(verifySocialSubtitleRenderAttestation({raw:{subtitleRenderEvidence:attestation(outputSha256)},outputSha256,manifest:{subtitles:{mode:'off',cues}}}),null,
      'disabled subtitles may not attest a prior enabled cue track');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('private ASS sidecar persists exact bytes with size and tamper checks',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'social-ass-sidecar-'));
  try{
    const directory=path.join(root,'private');
    const ass='[Script Info]\nTitle: test\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,HELLO PRODUCT\n';
    const outputSha256=sha('real output');
    const report={...attestation(outputSha256),assSha256:sha(ass)};
    assert.equal(await persistPrivateAssSidecar({directory,raw:{subtitleAssUtf8:'[Events]\nDialogue: forged'},attestation:report as never,outputSha256}),undefined,
      'a matching claimed hash without matching ASS bytes may not create a sidecar');
    const sidecar=await persistPrivateAssSidecar({directory,raw:{subtitleAssUtf8:ass},attestation:report as never,outputSha256});
    assert.ok(sidecar);
    assert.equal(await readFile(sidecar.path,'utf8'),ass);
    assert.equal((await stat(directory)).mode&0o777,0o700);
    assert.equal((await stat(sidecar.path)).mode&0o777,0o600);
    assert.equal(await verifyPrivateAssSidecar({directory,sidecar,attestation:report as never,outputSha256}),true);
    await writeFile(sidecar.path,ass.replace('HELLO','WORLD'));
    assert.equal(await verifyPrivateAssSidecar({directory,sidecar,attestation:report as never,outputSha256}),false);
    const tooLarge='[Events]\nDialogue: '+('X'.repeat(128*1024));
    assert.equal(await persistPrivateAssSidecar({directory,raw:{subtitleAssUtf8:tooLarge},attestation:{...report,assSha256:sha(tooLarge)} as never,outputSha256}),undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('same-graph caption-free baseline is privately persisted and revoked after byte drift',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'social-caption-baseline-'));
  try{
    const sourceDirectory=path.join(root,'.private-render-evidence'),directory=path.join(root,'cache');
    await import('node:fs/promises').then(fs=>fs.mkdir(sourceDirectory,{mode:0o700}));
    const source=path.join(sourceDirectory,'film.caption-base.mp4'),bytes=Buffer.from('baseline branch bytes');
    await writeFile(source,bytes,{mode:0o600});
    const outputSha256=sha('final MP4'),report=attestation(outputSha256);
    const raw={captionBaselineEvidence:{schemaVersion:'renderer-caption-baseline.v1',path:source,
      sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,outputSha256,filterGraphSha256:report.filterGraphSha256}};
    const sidecar=await persistPrivateCaptionBaseline({directory,raw,attestation:report,outputSha256});
    assert.ok(sidecar);assert.equal((await stat(sidecar.path)).mode&0o777,0o600);
    assert.equal(await verifyPrivateCaptionBaseline({directory,sidecar,attestation:report,outputSha256}),true);
    assert.equal(await persistPrivateCaptionBaseline({directory,raw:{captionBaselineEvidence:{...raw.captionBaselineEvidence,outputSha256:sha('other')}},attestation:report,outputSha256}),undefined);
    await writeFile(sidecar.path,'drift');
    assert.equal(await verifyPrivateCaptionBaseline({directory,sidecar,attestation:report,outputSha256}),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
