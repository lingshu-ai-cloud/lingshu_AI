import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateMvpHeyGenSpeech, readMvpHeyGenSpeech, readMvpHeyGenSpeechProviderEvidence, type MvpHeyGenSpeechInput, type MvpHeyGenSpeechPorts } from './mvpHeyGenSpeech.js';
const input: MvpHeyGenSpeechInput = { scope:{tenantId:'tenant',taskId:'task',version:1,session:'A',accountId:'account',productId:'product',runId:'run',action:'generate_media',authority:'customer',expiresAt:'2099-01-01',revoked:false,provider:'heygen',model:'starfish',shotIds:['hook'],authorizedBy:'human',authorizationRef:'grant',budgetPoolId:'pool',budgetLimitCny:10},shotId:'hook',operationRole:'hook',voiceId:'voice',text:'Ready to launch your own skincare brand?',maxDurationSeconds:4,reservationCny:.2 };
function fixture(options: { incompatible?:boolean; unknown?:boolean; downloadFail?:boolean; duration?:number; deny?:boolean; requestIdNull?:boolean } = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'speech-test-')); const calls:string[]=[]; let downloadFail=options.downloadFail;
  const ports:MvpHeyGenSpeechPorts = { root,apiKey:'fixture',assertCurrentScope:async()=>{},probe:async()=>options.duration||3,
    admission:{ reserve:async()=>{calls.push('pool'); if(options.deny)throw Error('denied'); return null;} },
    legacyBudget:{ reserve:async()=>{calls.push('legacy');} },fetch:(async(url,init)=>{
      const u=String(url); calls.push(init?.method==='POST'?'POST':u.includes('/v3/voices')?'voices':'download');
      if(u.includes('/v3/voices/speech')) {assert.equal(init?.method,'POST');const body=JSON.parse(String(init?.body));assert.equal(body.engine,'starfish');assert.equal(body.force_regenerate,false);if(options.unknown)throw Error('network unknown');return Response.json({audio_url:'https://files.heygen.ai/speech.mp3',duration:3,engine:'starfish',request_id:options.requestIdNull?null:'vendor-request'});}
      if(u.includes('/v3/voices'))return Response.json({data:[{voice_id:'voice',available_engines:options.incompatible?['orca']:['starfish']}],has_more:false});
      if(downloadFail){downloadFail=false;return new Response('',{status:503});}return new Response(new Uint8Array([1,2,3]));
    }) as typeof fetch };
  return { root,ports,calls,clean:()=>fs.rmSync(root,{recursive:true,force:true}) };
}
test('speech: dual admission precedes submit; durable server receipt replays without another provider call',async()=>{
  const f=fixture();try{const r=await generateMvpHeyGenSpeech(input,f.ports);assert.deepEqual(f.calls,['voices','pool','legacy','POST','download']);assert.equal(r.operationRole,'hook');assert.equal(r.accountId,input.scope.accountId);assert.equal(r.usage.actualCostCny,null);assert.equal(r.usage.reportedDurationSeconds,3);assert.ok(r.providerEvidenceSha256);assert.equal((readMvpHeyGenSpeechProviderEvidence(r.receiptRef,f.root) as {duration:number}).duration,3);assert.deepEqual(readMvpHeyGenSpeech(r.receiptRef,f.root),r);assert.deepEqual(await generateMvpHeyGenSpeech(input,f.ports),r);assert.equal(f.calls.filter(x=>x==='POST').length,1);fs.writeFileSync(r.filePath,'corrupt');assert.throws(()=>readMvpHeyGenSpeech(r.receiptRef,f.root),/speech_audio_corrupt/);}finally{f.clean();}
});
test('speech: unsupported voice or denied pool never submits or reserves legacy budget',async()=>{
  for(const options of [{incompatible:true},{deny:true}]){const f=fixture(options);try{await assert.rejects(generateMvpHeyGenSpeech(input,f.ports));assert.equal(f.calls.includes('POST'),false);assert.equal(f.calls.includes('legacy'),false);}finally{f.clean();}}
});
test('speech: unknown acceptance is durable and cannot POST again',async()=>{
  const f=fixture({unknown:true});try{await assert.rejects(generateMvpHeyGenSpeech(input,f.ports),/network unknown/);await assert.rejects(generateMvpHeyGenSpeech(input,f.ports),/provider_submission_unknown/);assert.equal(f.calls.filter(x=>x==='POST').length,1);}finally{f.clean();}
});
test('speech: accepted download retry only GETs; overlong source remains unapproved',async()=>{
  const f=fixture({downloadFail:true});try{await assert.rejects(generateMvpHeyGenSpeech(input,f.ports),/download_failed/);const r=await generateMvpHeyGenSpeech(input,f.ports);assert.equal(r.durationSeconds,3);assert.equal(f.calls.filter(x=>x==='POST').length,1);}finally{f.clean();}
  const g=fixture({duration:4.5});try{await assert.rejects(generateMvpHeyGenSpeech(input,g.ports),/duration_exceeded/);await assert.rejects(generateMvpHeyGenSpeech(input,g.ports),/duration_exceeded/);assert.equal(g.calls.filter(x=>x==='POST').length,1);}finally{g.clean();}
});
test('speech: server authorized original-voice compatibility probe retains exact voice and engine',async()=>{
 const f=fixture({incompatible:true});try{
  f.ports.authorizedOriginalVoiceProbe={authorizationRef:input.scope.authorizationRef,voiceId:input.voiceId};
  const r=await generateMvpHeyGenSpeech(input,f.ports);assert.equal(r.voiceId,input.voiceId);assert.equal(f.calls.filter(x=>x==='POST').length,1);
 }finally{f.clean();}
 const g=fixture({incompatible:true});try{g.ports.authorizedOriginalVoiceProbe={authorizationRef:'wrong',voiceId:input.voiceId};await assert.rejects(generateMvpHeyGenSpeech(input,g.ports),/not_verified/);assert.equal(g.calls.includes('POST'),false);}finally{g.clean();}
});
test('speech: scope drift blocks all vendor requests',async()=>{
 const f=fixture();try{f.ports.assertCurrentScope=async()=>{throw Error('version changed');};await assert.rejects(generateMvpHeyGenSpeech(input,f.ports),/version changed/);assert.deepEqual(f.calls,[]);}finally{f.clean();}
});

test('speech: explicit null account remains null in trusted receipt',async()=>{const f=fixture();try{const scoped={...input,scope:{...input.scope,accountId:null}};const r=await generateMvpHeyGenSpeech(scoped,f.ports);assert.equal(r.accountId,null);assert.equal(readMvpHeyGenSpeech(r.receiptRef,f.root).accountId,null);}finally{f.clean();}});
test('speech: preserved supplier evidence is integrity bound and cannot be edited independently',async()=>{
 const f=fixture();try{const r=await generateMvpHeyGenSpeech(input,f.ports);const file=path.join(f.root,`${r.receiptRef}.json`);const row=JSON.parse(fs.readFileSync(file,'utf8'));row.provider.responseEvidence.duration=0;fs.writeFileSync(file,JSON.stringify(row));assert.throws(()=>readMvpHeyGenSpeech(r.receiptRef,f.root),/speech_audio_corrupt/);}finally{f.clean();}
});

test('speech: official nullable request_id remains null; receipt and raw response identify accepted audio',async()=>{const f=fixture({requestIdNull:true});try{const r=await generateMvpHeyGenSpeech(input,f.ports);assert.equal(r.providerRequestId,null);assert.equal(readMvpHeyGenSpeech(r.receiptRef,f.root).providerRequestId,null);assert.equal((readMvpHeyGenSpeechProviderEvidence(r.receiptRef,f.root) as {request_id:null}).request_id,null);assert.ok(r.providerEvidenceSha256);await generateMvpHeyGenSpeech(input,f.ports);assert.equal(f.calls.filter(x=>x==='POST').length,1);}finally{f.clean();}});
