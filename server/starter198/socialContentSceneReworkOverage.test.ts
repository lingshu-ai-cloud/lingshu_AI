import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialContentTaskBudget } from '../lib/socialContentTaskBudget.js';
import { sceneReworkOverageDecision, reserveSceneReworkFilmBudget } from './socialContentSceneReworkFilmBudget.js';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import type { SceneReworkCostPolicy } from './socialContentSceneReworkCostPolicy.js';

async function setup(unknown=false){
 const f=await prepared(true),root=fs.mkdtempSync(path.join(os.tmpdir(),'rework-overage-'));
 f.tables.starter_social_content_tasks![0]!.created_at='2026-10-28T00:00:00Z';
 const scope={tenantId:'t',taskId:'content',runId:'run',planHash:'a'.repeat(64)};
 const ledger=new SocialContentTaskBudget(root,{authorization:async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'original-film'}),
  quote:async()=>({upperBoundCny:14,quoteRef:'original',validUntil:'2099-01-01'}),assertCurrent:async()=>{},verifyRejection:async()=>false});
 await ledger.reserveBatch(scope,[{operationId:'original',fingerprint:'b'.repeat(64),provider:'p',model:'m',accountRef:'a',stage:'video',shotId:null}]);
 await ledger.markOutcome(scope,'original',unknown?'unknown':'completed','receipt');
 const policy={type:'scene_rework_cost_policy',version:1,scope:{tenantId:'t',taskId:'content',runId:'repair-run',operationId:'repair',actorUserId:'owner'},
  quote:{type:'scene_rework_route_quote',version:1,tenantId:'t',taskId:'content',executionRunId:'repair-run',operationId:'repair',cacheHash:'c'.repeat(64),planHash:'d'.repeat(64),provider:'qwen_image',model:'m',sceneIds:['scene'],operationsPerScene:1,imagesPerOperation:1,maximumCostCnyPerImage:2,totalUpperBoundCny:2,maximumOriginalBudgetCny:15,tariffSourceRef:'tariff',tariffVersion:'1',validUntil:'2099-01-01',recordHash:'e'.repeat(64)},authorizedMaximumCostCny:2,confirmedAt:'2026-10-28',recordHash:'f'.repeat(64)} as SceneReworkCostPolicy;
 const input={repository:f.repository,policy,sourceRunId:'run',actorUserId:'owner',assertCurrent:async()=>{},ledgerRoot:root};
 return {...f,root,scope,ledger,input,clean:async()=>{fs.rmSync(root,{recursive:true,force:true});await f.cleanup();}};
}
test('confirmed exact server quote stays in original ledger and normal admission reuses it',async()=>{const f=await setup();try{
 const p=await sceneReworkOverageDecision(f.input);assert.deepEqual({retained:p!.retainedCny,planned:p!.plannedCny,extra:p!.extraCny},{retained:14,planned:2,extra:1});
 await sceneReworkOverageDecision({...f.input,previewHash:p!.previewHash});
 await sceneReworkOverageDecision({...f.input,previewHash:p!.previewHash});
 await reserveSceneReworkFilmBudget({...f.input,voiceDriven:true});
 const s=f.ledger.status(f.scope)!;assert.equal(s.retainedCny,16);assert.equal(s.entries.length,2);assert.equal(s.entries[0]!.receiptRef,'receipt');
 await assert.rejects(sceneReworkOverageDecision({...f.input,actorUserId:'other',previewHash:p!.previewHash}),/overage_actor_conflict/);
 }finally{await f.clean();}});
test('changed trusted quote invalidates choice',async()=>{const f=await setup();try{
 const p=await sceneReworkOverageDecision(f.input);
 const changed={...f.input,policy:{...f.input.policy,quote:{...f.input.policy.quote,totalUpperBoundCny:3,recordHash:'1'.repeat(64)}}};
 await assert.rejects(sceneReworkOverageDecision({...changed,previewHash:p!.previewHash}),/overage_preview_changed/);
 // A separate unknown operation remains untouched and cannot be bypassed by a user choice.
 const original=f.ledger.status(f.scope)!.entries[0]!;assert.equal(original.status,'completed');
 }finally{await f.clean();}});

test('unsettled original receipt prevents user overage approval',async()=>{const f=await setup(true);try{await assert.rejects(sceneReworkOverageDecision(f.input),/overage_unsettled_receipt/);assert.equal(f.ledger.status(f.scope)!.entries.length,1);}finally{await f.clean();}});
