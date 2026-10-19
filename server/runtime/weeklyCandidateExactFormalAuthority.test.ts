import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createWeeklyCandidateExactFormalAuthority,prepareDeployedWeeklyCandidateExactFormalAuthority,type WeeklyCandidateExactAuthorityStatement} from './weeklyCandidateExactFormalAuthority.js';

function fixture(t:test.TestContext){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-authority-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const pair=generateKeyPairSync('ed25519');
 const scope={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,jobId:'job',jobHash:'a'.repeat(64),runId:'run',runHash:'b'.repeat(64),scopeId:'scope',scopeVersion:3};
 const statement:WeeklyCandidateExactAuthorityStatement={schema:'weekly-candidate-exact-authority.v1',issuerId:'independent-issuer',keyId:'key-1',submitterId:'operator-1',reviewerId:'reviewer-1',authorizationId:'authority-1',tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,
  endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'c'.repeat(64),model:'qwen3-vl-plus',
  issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),weeklyMaximumCny:2,
  candidates:Array.from({length:5},(_,i)=>({candidateId:`candidate-${i}`,mediaSha256:String(i).repeat(64),operationId:`op-${i}`,jobId:i%2?'child-job':scope.jobId,jobHash:i%2?'d'.repeat(64):scope.jobHash,runId:i%2?'child-run':scope.runId,runHash:i%2?'e'.repeat(64):scope.runHash,scopeId:scope.scopeId,scopeVersion:scope.scopeVersion,maximumRequests:2,maximumCny:.5}))};
 const signed=()=>({statement,signatureBase64url:sign(null,Buffer.from(JSON.stringify(statement)),pair.privateKey).toString('base64url')});
 let revoked=false;
 const reader={read:async()=>signed(),isRevoked:async()=>revoked,trustedIssuers:[{issuerId:statement.issuerId,keyId:statement.keyId,reviewerId:statement.reviewerId,tenantId:scope.tenantId,publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'}).toString()}]};
 return {root,scope,statement,reader,setRevoked:(v:boolean)=>{revoked=v;}};
}

test('independent signed authority shares one CNY hold across parent and child runs, including restart',async t=>{
 const f=fixture(t),authority=createWeeklyCandidateExactFormalAuthority(f);
 const child=createWeeklyCandidateExactFormalAuthority({...f,scope:{...f.scope,jobId:'child-job',jobHash:'d'.repeat(64),runId:'child-run',runHash:'e'.repeat(64)}});
 for(let i=0;i<4;i++){
  const c=f.statement.candidates[i]!,a=i%2?child:authority;const hold=await a.reserve(c.candidateId,c.mediaSha256,c.operationId);
  assert.equal(hold?.plan.maximumTotalCny,.5);
  await a.assertCurrent(c.candidateId,c.mediaSha256,c.operationId,hold!.authorizationHash);
 }
 const fifth=f.statement.candidates[4]!;
 await assert.rejects(authority.reserve(fifth.candidateId,fifth.mediaSha256,fifth.operationId),/weekly_cny_exceeded/);
 const first=f.statement.candidates[0]!,restarted=createWeeklyCandidateExactFormalAuthority(f);
 assert.equal((await restarted.reserve(first.candidateId,first.mediaSha256,first.operationId))?.authorizationId,'authority-1');
 await assert.rejects(restarted.reserve(first.candidateId,'f'.repeat(64),first.operationId),/candidate_scope_changed/);
 await assert.rejects(authority.reserve(f.statement.candidates[1]!.candidateId,f.statement.candidates[1]!.mediaSha256,f.statement.candidates[1]!.operationId),/candidate_scope_changed/);
});

test('missing, forged, expired, revoked or changed authority never issues a hold',async t=>{
 const f=fixture(t),c=f.statement.candidates[0]!;
 const missing=createWeeklyCandidateExactFormalAuthority({...f,reader:{...f.reader,read:async()=>null}});
 assert.equal(await missing.reserve(c.candidateId,c.mediaSha256,c.operationId),null);
 const forged=createWeeklyCandidateExactFormalAuthority({...f,reader:{...f.reader,read:async()=>({statement:{...f.statement,weeklyMaximumCny:4},signatureBase64url:(await f.reader.read())!.signatureBase64url})}});
 await assert.rejects(forged.reserve(c.candidateId,c.mediaSha256,c.operationId),/signature_invalid/);
 const expired=createWeeklyCandidateExactFormalAuthority({...f,reader:{...f.reader,now:()=>Date.now()+120_000}});
 await assert.rejects(expired.reserve(c.candidateId,c.mediaSha256,c.operationId),/statement_invalid/);
 const valid=createWeeklyCandidateExactFormalAuthority(f),hold=await valid.reserve(c.candidateId,c.mediaSha256,c.operationId);
 f.setRevoked(true);
 await assert.rejects(valid.assertCurrent(c.candidateId,c.mediaSha256,c.operationId,hold!.authorizationHash),/revocation_unknown_or_revoked/);
 const unknown=createWeeklyCandidateExactFormalAuthority({...f,reader:{...f.reader,isRevoked:async()=>null as unknown as boolean}});
 await assert.rejects(unknown.reserve(c.candidateId,c.mediaSha256,c.operationId),/revocation_unknown_or_revoked/);
});

test('concurrent parent and child cannot each consume the last shared weekly allowance',async t=>{
 const f=fixture(t),parent=createWeeklyCandidateExactFormalAuthority(f);
 const child=createWeeklyCandidateExactFormalAuthority({...f,scope:{...f.scope,jobId:'child-job',jobHash:'d'.repeat(64),runId:'child-run',runHash:'e'.repeat(64)}});
 for(const i of [0,1,2]){
  const c=f.statement.candidates[i]!;await (i%2?child:parent).reserve(c.candidateId,c.mediaSha256,c.operationId);
 }
 const a=f.statement.candidates[3]!,b=f.statement.candidates[4]!;
 // The final slot is .5 CNY; a simultaneous child and parent claim cannot
 // each see it as available under separate run-scoped locks.
 const results=await Promise.allSettled([child.reserve(a.candidateId,a.mediaSha256,a.operationId),parent.reserve(b.candidateId,b.mediaSha256,b.operationId)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
});

test('fractional-micro candidate holds cannot round below the signed weekly CNY ceiling',async t=>{
 const f=fixture(t);
 f.statement.weeklyMaximumCny=1;
 for(const candidate of f.statement.candidates)candidate.maximumCny=0.2000004;
 const parent=createWeeklyCandidateExactFormalAuthority(f);
 const child=createWeeklyCandidateExactFormalAuthority({...f,scope:{...f.scope,jobId:'child-job',jobHash:'d'.repeat(64),runId:'child-run',runHash:'e'.repeat(64)}});
 let firstAuthorizationHash='';
 for(let i=0;i<4;i++){
  const candidate=f.statement.candidates[i]!;
  const held=await (i%2?child:parent).reserve(candidate.candidateId,candidate.mediaSha256,candidate.operationId);
  assert(held);if(i===0)firstAuthorizationHash=held.authorizationHash;
 }
 const fifth=f.statement.candidates[4]!;
 await assert.rejects(parent.reserve(fifth.candidateId,fifth.mediaSha256,fifth.operationId),/weekly_cny_exceeded/);
 const reopened=createWeeklyCandidateExactFormalAuthority(f);
 const first=f.statement.candidates[0]!;
 const original=await reopened.readExistingHold(first.candidateId,first.mediaSha256,first.operationId,firstAuthorizationHash);
 assert.equal(original.plan.maximumTotalCny,0.2000004);
});

test('expired authority permits only original held-operation settlement checks, never another paid request',async t=>{
 const f=fixture(t),candidate=f.statement.candidates[0]!;
 const authority=createWeeklyCandidateExactFormalAuthority(f);
 const hold=await authority.reserve(candidate.candidateId,candidate.mediaSha256,candidate.operationId);
 assert(hold);
 const expired=createWeeklyCandidateExactFormalAuthority({...f,reader:{...f.reader,now:()=>Date.now()+120_000}});
 await assert.rejects(expired.reserve(candidate.candidateId,candidate.mediaSha256,candidate.operationId),/statement_invalid/);
 await assert.rejects(expired.assertCurrent(candidate.candidateId,candidate.mediaSha256,candidate.operationId,hold.authorizationHash),/statement_invalid/);
 assert.equal((await expired.readExistingHold(candidate.candidateId,candidate.mediaSha256,candidate.operationId,hold.authorizationHash)).authorizationId,hold.authorizationId);
 await expired.assertOriginalForSettlement(candidate.candidateId,candidate.mediaSha256,candidate.operationId,hold.authorizationHash);
 await assert.rejects(expired.assertOriginalForSettlement(candidate.candidateId,'f'.repeat(64),candidate.operationId,hold.authorizationHash),/hold_missing_or_changed/);
 f.setRevoked(true);
 await assert.rejects(expired.assertOriginalForSettlement(candidate.candidateId,candidate.mediaSha256,candidate.operationId,hold.authorizationHash),/revocation_unknown_or_revoked/);
});

test('deployed adapter refuses caller-defined or absent shared root',async t=>{
 const f=fixture(t),prior=process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;
 t.after(()=>{if(prior===undefined)delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;else process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT=prior;});
 delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;
 assert.throws(()=>prepareDeployedWeeklyCandidateExactFormalAuthority({scope:f.scope,reader:f.reader}),/deployed_ledger_root_required/);
 process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT=fs.realpathSync(f.root);
 const c=f.statement.candidates[0]!;
 assert.equal((await prepareDeployedWeeklyCandidateExactFormalAuthority({scope:f.scope,reader:f.reader}).reserve(c.candidateId,c.mediaSha256,c.operationId))?.authorizationId,'authority-1');
});
