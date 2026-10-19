import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveCandidateSemanticPaidCall,measureCandidateSemanticInputUpperBound} from './candidateSemanticBudgetResolver.js';
import type {CandidateContextAssessment} from './candidateContextAssessment.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';

const context={tenantId:'tenant',candidateId:'candidate',assessmentId:'assessment',recordHash:''} as CandidateContextAssessment;context.recordHash=socialRequestHash({...context,recordHash:''});
const binding={baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256:'b'.repeat(64),materialModel:'qwen3-vl-flash'};
const task=(candidate='candidate')=>({id:'row',tenant_id:'tenant',task_id:'task',created_by:'owner',brief:{perItemBudgetCny:15},reference_video_analysis:{status:'ready',referenceRecordId:candidate,analysisId:'analysis'}});
const store=(row:Record<string,unknown>)=>({
  list:async(collection:string)=>collection==='starter_social_content_tasks'?{page:1,perPage:2,totalItems:1,totalPages:1,items:[row]}:{page:1,perPage:2,totalItems:0,totalPages:0,items:[]},
  getById:async(collection:string,id:string)=>collection==='social_candidate_context_assessments'&&id===context.assessmentId?{id,tenant_id:'tenant',record_hash:context.recordHash,payload:context}:null,
}) as any;
const tariff=async(intent:any)=>({...intent,currency:'CNY' as const,verifiedAccountPrice:true,evidenceRef:'verified-account-price',checkedAt:'2026-10-16T00:00:00Z',validUntil:'2099-01-01T00:00:00Z',meters:{inputTokens:{priceCny:1,unitsPerPrice:1_000_000,minimumUnits:0,increment:1},outputTokens:{priceCny:2,unitsPerPrice:1_000_000,minimumUnits:0,increment:1}}});

test('task-bound semantic resolver reserves against the same <=15 CNY task ledger',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-semantic-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const call=await resolveCandidateSemanticPaidCall({store:store(task()),tenantId:'tenant',taskId:'task',candidateId:'candidate',context,ports:{binding:()=>binding,readTariff:tariff,ledgerRoot:path.join(root,'ledger'),permitRoot:path.join(root,'permits')}});
  assert.equal(call.intent.stage,'candidate_context_semantic');assert.equal(call.intent.inputContractHash,context.recordHash);assert.equal(call.intent.maximumUnits.inputTokens,260096);
  const files=(await fs.readdir(path.join(root,'ledger'))).filter(file=>file.endsWith('.json'));assert.equal(files.length,1);
  const ledger=JSON.parse(await fs.readFile(path.join(root,'ledger',files[0]!),'utf8'));assert.equal(ledger.limitMicros,15_000_000);assert.equal(Object.keys(ledger.entries).length,1);const entry=Object.values(ledger.entries)[0] as any;assert.equal(entry.operationId,call.intent.operationId);assert.ok(entry.reservedMicros>0);
  const productionScope={tenantId:'tenant',taskId:'task',runId:'production-run',planHash:'d'.repeat(64)},production=new SocialContentTaskBudget(path.join(root,'ledger'),{assertCurrent:async()=>{},authorization:async()=>({maximumCny:15,authorizationRef:'same-task-production'}),quote:async()=>({upperBoundCny:14.8,quoteRef:'production-price',validUntil:'2099-01-01T00:00:00Z'}),verifyRejection:async()=>false});
  await assert.rejects(production.reserveBatch(productionScope,[{operationId:'production',fingerprint:'e'.repeat(64),provider:'wan',model:'video',accountRef:'account',stage:'video',shotId:'S01'}]),/budget_exceeded/);
  assert.equal(await measureCandidateSemanticInputUpperBound({model:'qwen3-vl-flash',messages:[{role:'user',content:'evidence'}],temperature:0,response_format:{type:'json_object'},max_tokens:1600}),260096);
  await assert.rejects(measureCandidateSemanticInputUpperBound({model:'qwen3-vl-plus',messages:[{role:'user',content:'x'.repeat(240000)}],max_tokens:1600}),/request_exceeds_context/);
});

test('unbound task reference fails before creating any task ledger',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-semantic-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await assert.rejects(resolveCandidateSemanticPaidCall({store:store(task('other')),tenantId:'tenant',taskId:'task',candidateId:'candidate',context,ports:{binding:()=>binding,readTariff:tariff,ledgerRoot:path.join(root,'ledger')}}),/task_reference_unbound/);
  await assert.rejects(fs.stat(path.join(root,'ledger')));
});
