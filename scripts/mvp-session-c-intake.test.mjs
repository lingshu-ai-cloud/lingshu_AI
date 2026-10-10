import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectSessionCIntake} from './mvp-session-c-intake.mjs';

test('missing A/B and old final alone never certify MVP', async()=>{
 const r=await inspectSessionCIntake({artifacts:[{role:'finalVideo',file:'old.mp4'}]});
 assert.equal(r.mvpPassed,false); assert.equal(r.contractStatus,'blocked');
 assert.ok(r.blockers.includes('digitalHuman_missing_or_duplicate'));
 assert.ok(r.blockers.includes('human_creative_review_missing'));
});
test('complete editable handoff is only consistent; cross-run and mutated bytes block',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-c-'));
 try {
  await writeFile(path.join(dir,'asset'),'fixture bytes');
  const hash=createHash('sha256').update('fixture bytes').digest('hex');
  const scope={tenantId:'t',taskId:'task',runId:'run',version:'1'};
  const artifacts=['reference','script','storyboard','voiceover','digitalHuman','aigc','enterpriseMaterial','finalVideo'].map(role=>({role,scope:{...scope},file:'asset',sha256:hash,provider:{name:'fixture',taskId:'receipt',rawReceiptRef:'receipt.json'},cost:{estimated:1,actual:1,currency:'CNY',ledgerRef:'ledger'},authorizationRef:'authorization',sourceSha256s:[hash]}));
  const input={expectedScope:scope,artifacts,technicalReview:{status:'passed',reportRef:'tech'},creativeReview:{status:'passed',reviewerId:'human',reportRef:'creative'}};
  const result=await inspectSessionCIntake(input,dir);
  assert.equal(result.contractStatus,'consistent'); assert.equal(result.mvpPassed,false); assert.equal(result.providerVerified,false);
  artifacts[4].scope.runId='other';
  assert.ok((await inspectSessionCIntake(input,dir)).blockers.includes('digitalHuman_scope_mismatch'));
  await writeFile(path.join(dir,'asset'),'changed');
  assert.ok((await inspectSessionCIntake(input,dir)).blockers.includes('finalVideo_bytes_mismatch'));
 } finally {await rm(dir,{recursive:true,force:true});}
});
