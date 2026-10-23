import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {readSocialProductionBudgetEvidence} from './socialContentProductionBudgetEvidence.js';
import {reserveSceneReworkFilmBudget} from './socialContentSceneReworkFilmBudget.js';
import type {SceneReworkCostPolicy} from './socialContentSceneReworkCostPolicy.js';

test('artifact evidence and scene repair retain the root film ledger across restarts',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'film-budget-evidence-'));
 try{
  const store=new LangGraphTestStore(path.join(root,'records.json')),repository=createStarter198Repository(store);
  await store.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:'t',task_id:'film',run_id:'original',brief:{targetDurationSeconds:30}});
  const scope={tenantId:'t',taskId:'film',runId:'original',planHash:'a'.repeat(64)};
  const ledger=new SocialContentTaskBudget(root,{authorization:async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'original-order'}),quote:async()=>({upperBoundCny:13,quoteRef:'original-quote',validUntil:'2099-01-01'}),assertCurrent:async()=>{},verifyRejection:async()=>false});
  await ledger.reserveBatch(scope,[{operationId:'first-attempt',fingerprint:'b'.repeat(64),provider:'offline',model:'test',accountRef:'test',stage:'video',shotId:'s1'}]);
  await ledger.markOutcome(scope,'first-attempt','unknown','awaiting-bill');
  const policy={scope:{tenantId:'t',taskId:'film',runId:'repair',operationId:'revision-1',actorUserId:'owner'},quote:{provider:'qwen_image',model:'fixture',tariffSourceRef:'trusted-fixture',planHash:'c'.repeat(64),totalUpperBoundCny:2,recordHash:'d'.repeat(64),validUntil:'2099-01-01'},recordHash:'e'.repeat(64)} as SceneReworkCostPolicy;
  let checks=0;
  const repair=await reserveSceneReworkFilmBudget({repository,policy,ledgerRoot:root,assertCurrent:async()=>{checks++;}});
  await repair.beforeExecute();
  const replay=await reserveSceneReworkFilmBudget({repository,policy,ledgerRoot:root,assertCurrent:async()=>{checks++;}});
  await replay.beforeExecute();assert.ok(checks>0);
  const before=ledger.status(scope)!;assert.equal(before.retainedCny,15);assert.equal(before.entries.length,2);
  await assert.rejects(reserveSceneReworkFilmBudget({repository,policy:{...policy,scope:{...policy.scope,operationId:'revision-2'}},ledgerRoot:root,assertCurrent:async()=>{}}),/production_budget_decision_required/);
  assert.deepEqual(ledger.status(scope),before);
  const evidence=await readSocialProductionBudgetEvidence({execution:{repository,tenantId:'t',taskId:'film',runId:'repair',runtime:{productionBudgetReadPorts:{ledgerRoot:root}}} as never,brief:{targetDurationSeconds:30} as never,scenes:[{duration:{startSeconds:0,endSeconds:30}}]});
  assert.equal(evidence!.retainedCny,15);assert.equal(evidence!.budgetTaskId,'film');assert.equal(evidence!.maximumCny,15);
  // Historical/settlement drift remains occupied and blocks artifact delivery;
  // the read path neither deletes receipts nor relabels unknown billing free.
  const file=fs.readdirSync(root).find(name=>name.endsWith('.json')&&name!=='records.json')!;
  const raw=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  Object.values(raw.entries).forEach((entry:any)=>{if(entry.operationId==='first-attempt')entry.reservedMicros=13_000_001;});
  fs.writeFileSync(path.join(root,file),JSON.stringify(raw));
  await assert.rejects(readSocialProductionBudgetEvidence({execution:{repository,tenantId:'t',taskId:'film',runId:'original',runtime:{productionBudgetReadPorts:{ledgerRoot:root}}} as never,brief:{targetDurationSeconds:30} as never,scenes:[{duration:{startSeconds:0,endSeconds:30}}]}),/production_budget_decision_required/);
  assert.equal(ledger.status(scope)!.entries.find(entry=>entry.operationId==='first-attempt')!.receiptRef,'awaiting-bill');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
