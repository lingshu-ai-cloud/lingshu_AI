import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {freezeSocialRenderFrameContract} from './socialRenderFrameContract.js';
import {socialRequestHash} from './socialContentValidation.js';
import {socialTechnicalRenderDirectory,verifySocialTechnicalReplay,type SocialTechnicalReplayEvidence} from './socialContentTechnicalReplayEvidence.js';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const scope={tenantId:'offline-test',taskId:randomUUID(),runId:'run'},directory=socialTechnicalRenderDirectory(scope);
 await mkdir(directory,{recursive:true,mode:0o700});
 const cues=[{start:0,end:1,text:'Hello'}],outputSha256=sha('video'),assSha256=sha('ASS'),baseSha256=sha('base'),voiceSha256=sha('voice'),filterGraphSha256=sha('graph');
 const ass=path.join(directory,`${outputSha256}.${assSha256}.ass`),baseline=path.join(directory,`${outputSha256}.${baseSha256}.caption-base.mp4`),voice=path.join(directory,'voice');
 await Promise.all([[ass,'ASS'],[baseline,'base'],[voice,'voice']].map(([file,text])=>writeFile(file!,text!,{mode:0o600})));
 const manifest={spec:{duration:1},frameContract:freezeSocialRenderFrameContract(1),subtitles:{cues},voiceover:{url:voice}};
 const attestation={schemaVersion:'renderer-subtitle-attestation.v2' as const,outputSha256,assSha256,filterApplied:true,subtitleCueSha256:sha(JSON.stringify(cues)),filterGraphSha256};
 const evidence:SocialTechnicalReplayEvidence={schemaVersion:'social-technical-replay.v1',scope,outputSha256,manifest,frozenVoiceCues:cues,voice:{localPath:voice,sha256:voiceSha256},bgm:null,
  renderReceipt:{sha256:outputSha256,inputHash:sha('input'),cachePath:'',rendererAttestation:attestation,
   subtitleAssSidecar:{path:ass,sha256:assSha256,byteLength:3,outputSha256,subtitleCueSha256:attestation.subtitleCueSha256},
   captionBaselineSidecar:{path:baseline,sha256:baseSha256,byteLength:4,outputSha256,filterGraphSha256},
   frameRenderEvidence:{schemaVersion:'renderer-frame-attestation.v1',outputSha256,fps:30,durationSeconds:1,expectedFrames:30}}};
 const parentContent={productionWorkspaceSource:{runId:scope.runId,outputSha256,manifestHash:socialRequestHash(manifest)},technicalQualityReport:{mediaHardProbe:{frozenVoiceSha256:voiceSha256,captionSpeechAlignment:{frozenVoiceCueHash:socialRequestHash(cues)}}}};
 return {directory,evidence,scope,parentContent,outputSha256,ass};
}
test('technical replay binds scope, original manifest, measured voice and private sidecars',async()=>{
 const f=await fixture();try{
  const result=await verifySocialTechnicalReplay(f);assert.equal(result.frame.expectedFrames,30);
  for(const patch of [{scope:{...f.scope,runId:'other'}},{outputSha256:sha('other')},
   {evidence:{...f.evidence,manifest:{...f.evidence.manifest,spec:{duration:2}}}},
   {evidence:{...f.evidence,frozenVoiceCues:[{start:0,end:1,text:'Altered'}]}}]){
   await assert.rejects(verifySocialTechnicalReplay({...f,...patch}),/social_technical_reevaluation_(?:lineage_changed|frozen_voice_changed)/);
  }
  await writeFile(f.ass,'tampered');await assert.rejects(verifySocialTechnicalReplay(f),/sidecar_evidence_missing_or_changed/);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
