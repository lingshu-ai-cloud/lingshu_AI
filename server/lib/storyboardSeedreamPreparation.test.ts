import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {prepareTrustedStoryboardSeedream} from './storyboardSeedreamPreparation.js';import {createHash} from 'node:crypto';
test('dry-run and durable prepared/unknown fail closed; QA budget gate precedes provider',async()=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-frame-durable-'));const bytes=Buffer.from('owned-source-test'),sha=createHash('sha256').update(bytes).digest('hex');
const input={request:{referenceMode:'storyboard_scene' as const,tenantId:'tenant',videoId:'project',compositionId:'S04',presenterVersion:sha,prompt:'Keep packaging; neutral background',ratio:'9:16' as const,references:[{role:'product_identity' as const,bytes,mimeType:'image/png' as const,sha256:sha}],idempotencyKey:'op'},model:'controlled-model',estimatedCostCny:.6,root,productInfo:'100ml',execute:false};
let frames=0,qas=0;const ports={assertCurrent:async()=>{},reserve:async()=>{frames++;},reserveQa:async()=>{qas++;throw Error('unverified-QA-account');}};
const dry=await prepareTrustedStoryboardSeedream(input,ports);assert.equal(dry.dryRun,true);assert.equal(frames,0);assert.equal(qas,0);assert.equal(fs.readdirSync(root).length,0);
await assert.rejects(prepareTrustedStoryboardSeedream({...input,execute:true},ports),/unverified-QA-account/);assert.equal(qas,1);assert.equal(frames,0);
fs.writeFileSync(path.join(root,`${dry.fingerprint}.json`),JSON.stringify({fingerprint:dry.fingerprint,state:'prepared'}));
await assert.rejects(prepareTrustedStoryboardSeedream({...input,execute:true},ports),/original_receipt_reconciliation/);assert.equal(qas,1);assert.equal(frames,0);
fs.rmSync(root,{recursive:true,force:true});
});
