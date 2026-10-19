import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {quoteSocialPaidOperationTariff,type SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import {issueWeeklyCandidateSemanticBudgetAuthorization,readWeeklyCandidateSemanticTariff,reserveWeeklyCandidateSemanticCharge,resolveWeeklyCandidateSemanticPaidCall,type WeeklyCandidateSemanticBudgetAuthorization} from './weeklyCandidateSemanticBudget.js';

test('weekly semantic quote uses only exact MaaS account/model public ceiling, never a generic estimate',async()=>{
 const binding={baseUrl:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'a'.repeat(64),materialModel:'qwen3-vl-plus'};
 const accountRef=`qwen:${createHash('sha256').update(JSON.stringify({baseUrl:binding.baseUrl,credentialSha256:binding.credentialSha256})).digest('hex')}`;
 const intent:SocialPaidOperationIntent={operationId:'candidate-semantic:one',provider:'qwen',model:binding.materialModel,accountRef,stage:'candidate_context_semantic',shotId:null,inputContractHash:'b'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:1600}};
 const store={list:async()=>({totalItems:0,items:[]})} as any;
 const tariff=await readWeeklyCandidateSemanticTariff(store,'tenant',binding,intent);
 assert.equal(tariff?.pricingBasis,'published_undiscounted_ceiling');
 assert.equal(quoteSocialPaidOperationTariff(intent,tariff).upperBoundCny,0.828288);
 assert.equal(await readWeeklyCandidateSemanticTariff(store,'tenant',{...binding,baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},intent),null);
 assert.equal(await readWeeklyCandidateSemanticTariff(store,'tenant',{...binding,credentialSha256:'c'.repeat(64)},intent),null);
 assert.equal(await readWeeklyCandidateSemanticTariff(store,'tenant',{...binding,materialModel:'qwen3-vl-flash'},intent),null);
});

test('missing explicit weekly policy stops before any ledger, operation or provider request',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-semantic-policy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let provider=0,writes=0;const store={list:async()=>({totalItems:0,items:[]}),create:async()=>{writes++;return null;}} as any;
 await assert.rejects(resolveWeeklyCandidateSemanticPaidCall({store,job:{tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1} as any,run:{} as any,candidateId:'candidate',context:{} as any,mediaRoot:root,ports:{ledgerRoot:root,readTariff:async()=>{provider++;return null;}}}),/weekly_candidate_semantic_budget_lineage_missing_or_ambiguous/);
 assert.equal(provider,0);assert.equal(writes,0);assert.deepEqual(await fs.readdir(root),[]);
});

test('five candidate reservations share one durable weekly total; no amount is inferred',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-semantic-ledger-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const authorization={schema:'weekly-candidate-semantic-budget-authorization.v1',authorizationId:'a'.repeat(15),tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,recordHash:'a'.repeat(64),totalLimitCny:3,candidates:Array.from({length:5},(_,i)=>({candidateId:`candidate-${i}`,contextAssessmentId:`assessment-${i}`,contextHash:String(i).repeat(64),mediaSha256:'b'.repeat(64),perCandidateLimitCny:2}))} as WeeklyCandidateSemanticBudgetAuthorization;
 const call=(i:number,quotedCny:number)=>reserveWeeklyCandidateSemanticCharge({root,authorization,candidateId:`candidate-${i}`,contextHash:String(i).repeat(64),intentHash:'c'.repeat(64),operationId:`semantic-${i}`,quoteRef:'verified-quote',quotedCny,assertCurrent:async()=>{}});
 await call(0,1.1);await call(0,1.1);await call(1,1.1);
 await assert.rejects(call(2,1.1),/weekly_limit_exceeded/);
 await assert.rejects(call(3,2.1),/candidate_limit_exceeded/);
 const files=(await fs.readdir(root)).filter(f=>f.endsWith('.json'));assert.equal(files.length,1);
 const ledger=JSON.parse(await fs.readFile(path.join(root,files[0]!),'utf8'));assert.equal(Object.keys(ledger.entries).length,2);assert.equal(Object.values(ledger.entries).reduce((n:number,e:any)=>n+e.reservedMicros,0),2_200_000);
});

test('authenticated issuer refuses missing explicit CNY policy before any approval write',async()=>{
 let writes=0;const store={getById:async(collection:string)=>collection==='users'?{tenantId:'tenant',role:'admin',active:true}:null,create:async()=>{writes++;return null;}} as any;
 await assert.rejects(issueWeeklyCandidateSemanticBudgetAuthorization({store,tenantId:'tenant',actorUserId:'owner',programId:'program',packageId:'week',packageVersion:1,jobId:'job',runId:'run',candidateLimits:[{candidateId:'candidate',contextAssessmentId:'context',perCandidateLimitCny:1}],totalLimitCny:undefined as unknown as number,expiresAt:'2099-01-01T00:00:00Z',mediaRoot:'/no-media'}),/approval_input_invalid/);
 assert.equal(writes,0);
});
