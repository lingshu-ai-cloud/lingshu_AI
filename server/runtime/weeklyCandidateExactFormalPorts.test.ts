import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {createWeeklyCandidateExactFormalPorts,prepareDeployedWeeklyCandidateExactFormalPorts,weeklyCandidateExactJobBindingHash} from './weeklyCandidateExactFormalPorts.js';
import type {WeeklyCandidateExactAuthorityStatement} from './weeklyCandidateExactFormalAuthority.js';
import {weeklyCandidateExactRunBindingHash} from './weeklyCandidateExactRunBinding.js';
import {createWeeklyCandidateDynamicExactPaidRequests} from './weeklyCandidateExactPaidRequests.js';

test('run binding excludes completion outcome but retains original weekly source and scope',()=>{
 const initial={runId:'run',planId:'plan',keywordSetId:'keywords',keywordSetVersion:2,discoveryScopeId:'scope',discoveryScopeVersion:3,
  triggerType:'manual',scopeSnapshot:{discoveryBriefId:'brief',weeklyProducer:{key:'weekly-source',inputHash:'a'.repeat(64)}},
  market:'VN',language:'vi',startedAt:'2026-10-19T00:00:00.000Z',status:'running'} as unknown as SocialInspirationCollectionRun;
 const completed={...initial,status:'succeeded' as const,scopeSnapshot:{...initial.scopeSnapshot,weeklyProducer:{key:'weekly-source',inputHash:'a'.repeat(64),completeEmptyVerified:true}},
  modeStats:{},evidenceOutcomes:{},finishedAt:'2026-10-19T00:01:00.000Z'} as SocialInspirationCollectionRun;
 assert.equal(weeklyCandidateExactRunBindingHash(initial),weeklyCandidateExactRunBindingHash(completed));
 assert.notEqual(weeklyCandidateExactRunBindingHash(initial),weeklyCandidateExactRunBindingHash({...completed,scopeSnapshot:{...completed.scopeSnapshot,weeklyProducer:{key:'other',inputHash:'a'.repeat(64)}}} as SocialInspirationCollectionRun));
 assert.notEqual(weeklyCandidateExactRunBindingHash(initial),weeklyCandidateExactRunBindingHash({...completed,discoveryScopeVersion:4}));
});

test('signed conservative basis uses a durable hold and independent audit, never an inferred bill',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-formal-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const job={jobId:'job',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,authority:{scopeId:'scope',scopeVersion:3}} as WeeklyPreproductionJob;
 const run={runId:'run',discoveryScopeId:'scope',discoveryScopeVersion:3} as SocialInspirationCollectionRun;
 const pair=generateKeyPairSync('ed25519'),mediaSha256='a'.repeat(64),candidateId='candidate-0',operationId='operation-0';
 const statement:WeeklyCandidateExactAuthorityStatement={schema:'weekly-candidate-exact-authority.v1',issuerId:'issuer',keyId:'key',submitterId:'submitter',reviewerId:'reviewer',authorizationId:'auth',
  tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'b'.repeat(64),model:'qwen3-vl-plus',
  settlementBasis:'conservative_upper_bound',auditApiKeyId:'official-key-id',conservativePriceApproval:{inputCnyPerMillion:3,outputCnyPerMillion:30,
   sourceEvidenceHash:'e'.repeat(64),validUntil:new Date(Date.now()+120000).toISOString()},
  issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),weeklyMaximumCny:8.5,
  candidates:Array.from({length:5},(_,i)=>({candidateId:`candidate-${i}`,mediaSha256:i?String(i).repeat(64):mediaSha256,operationId:`operation-${i}`,jobId:job.jobId,
   jobHash:weeklyCandidateExactJobBindingHash(job),runId:run.runId,runHash:weeklyCandidateExactRunBindingHash(run),scopeId:'scope',scopeVersion:3,maximumRequests:1,maximumCny:1.7}))};
 const authorityReader={read:async()=>({statement,signatureBase64url:sign(null,Buffer.from(JSON.stringify(statement)),pair.privateKey).toString('base64url')}),isRevoked:async()=>false,
  trustedIssuers:[{issuerId:'issuer',keyId:'key',reviewerId:'reviewer',tenantId:'tenant',publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'}).toString()}]};
 const auditReader={readOriginalAuditRequest:async()=>({requestId:'audit-1',apiKeyId:'official-key-id',model:'qwen3-vl-plus',status:200,
  usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},sourceEvidenceHash:'d'.repeat(64)})};
 const make=()=>createWeeklyCandidateExactFormalPorts({root,job,run,authorityReader,auditReader,configurationHash:'c'.repeat(64),runAnalysis:async()=>{throw Error('no provider call expected');}});
 const ports=make(),record={id:candidateId,tenantId:'tenant'};
 const auth=await ports.authorize!({job,run,record,mediaSha256,operationId});assert(auth);
 const plan={operationId,candidateId,mediaSha256,endpoint:statement.endpoint,credentialSha256:statement.credentialSha256,model:statement.model,maximumRequests:1,maximumTotalCny:1.7};
 const guard=createWeeklyCandidateDynamicExactPaidRequests({root,authorizationHash:auth.authorizationHash,plan,assertCurrent:async()=>{}});
 const body=JSON.stringify({model:statement.model,max_tokens:100,messages:[]}),requestHash=createHash('sha256').update(body).digest('hex');
 await guard.beforeProviderRequest(body);
 assert.equal(await make().readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),null);
 await guard.onProviderReceipt({provider:'qwen',responseId:'chatcmpl-1',providerRequestId:'audit-1',model:statement.model,requestModel:statement.model,
  httpStatus:200,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},requestHash,receivedAt:new Date().toISOString()});
 const settled=await make().readSettledReceipt!({operationId,candidateId,mediaSha256,...auth});
 assert.equal(settled?.settlementBasis,'conservative_upper_bound');
 assert.match(settled?.providerReceiptRef??'',/^qwen-audit-upper-bound:/);
 const approved=statement.conservativePriceApproval!;
 statement.conservativePriceApproval={...approved,outputCnyPerMillion:29};
 await assert.rejects(make().readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),/statement_invalid/);
 statement.conservativePriceApproval=approved;
 const wrongBasis=createWeeklyCandidateExactFormalPorts({root,job,run,authorityReader,configurationHash:'c'.repeat(64),
  originalReaders:{readOriginalSupplierResponse:async()=>null,readOriginalBillingOutcome:async()=>null},runAnalysis:async()=>{}});
 await assert.rejects(wrongBasis.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),/accounting_basis_changed/);
});

test('formal exact bridge requires same signed run, uses the dynamic guard, and never accepts local-only settlement',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-formal-ports-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const job={jobId:'job',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,authority:{scopeId:'scope',scopeVersion:3}} as WeeklyPreproductionJob;
 const run={runId:'run',discoveryScopeId:'scope',discoveryScopeVersion:3} as SocialInspirationCollectionRun;
 const candidateId='candidate-0',mediaSha256='a'.repeat(64),operationId='operation-0';
 const pair=generateKeyPairSync('ed25519');
 const statement:WeeklyCandidateExactAuthorityStatement={schema:'weekly-candidate-exact-authority.v1',issuerId:'issuer',keyId:'key',submitterId:'submitter',reviewerId:'reviewer',authorizationId:'auth',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,
  endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'b'.repeat(64),model:'qwen3-vl-plus',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),weeklyMaximumCny:2,
  candidates:Array.from({length:5},(_,i)=>({candidateId:`candidate-${i}`,mediaSha256:i===0?mediaSha256:String(i).repeat(64),operationId:i===0?operationId:`operation-${i}`,jobId:job.jobId,jobHash:weeklyCandidateExactJobBindingHash(job),runId:run.runId,runHash:weeklyCandidateExactRunBindingHash(run),scopeId:'scope',scopeVersion:3,maximumRequests:2,maximumCny:.4}))};
 let now=Date.now(),revoked=false;
 const reader={read:async()=>({statement,signatureBase64url:sign(null,Buffer.from(JSON.stringify(statement)),pair.privateKey).toString('base64url')}),isRevoked:async()=>revoked,now:()=>now,
  trustedIssuers:[{issuerId:'issuer',keyId:'key',reviewerId:'reviewer',tenantId:'tenant',publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'}).toString()}]};
 let executed=0,readSupplier=0,readBilling=0;
 const ports=createWeeklyCandidateExactFormalPorts({root,job,run,authorityReader:reader,configurationHash:'c'.repeat(64),
  originalReaders:{readOriginalSupplierResponse:async()=>{readSupplier++;return null;},readOriginalBillingOutcome:async()=>{readBilling++;return null;}},
  runAnalysis:async()=>{executed++;}});
 const oldRoot=process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;
 t.after(()=>{if(oldRoot===undefined)delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;else process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT=oldRoot;});
 delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;
 assert.throws(()=>prepareDeployedWeeklyCandidateExactFormalPorts({job,run,authorityReader:reader,configurationHash:'c'.repeat(64),originalReaders:{readOriginalSupplierResponse:async()=>null,readOriginalBillingOutcome:async()=>null},runAnalysis:async()=>{}}),/deployed_ledger_root_required/);
 const record={id:candidateId,tenantId:'tenant'};
 await assert.rejects(ports.authorize!({job:{...job,jobId:'other'},run,record,mediaSha256,operationId}),/lineage_changed/);
 const auth=await ports.authorize!({job,run,record,mediaSha256,operationId});assert(auth);
 await assert.rejects(ports.execute!({job,run,record,mediaSha256:'f'.repeat(64),operationId,...auth}),/fresh_reservation_required/);
 await ports.execute!({job,run,record,mediaSha256,operationId,...auth});
 assert.equal(executed,1);
 assert.equal(await ports.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),null);
 assert.equal(readSupplier,0);assert.equal(readBilling,0);
 await assert.rejects(ports.readSettledReceipt!({operationId,candidateId,mediaSha256,authorizationId:'borrowed',authorizationHash:auth.authorizationHash}),/authorization_changed/);
 // Recreate the bridge like a restarted worker. Recovery must use the
 // original durable weekly hold, not silently reserve a replacement.
 const reopened=createWeeklyCandidateExactFormalPorts({root,job,run,authorityReader:reader,configurationHash:'c'.repeat(64),
  originalReaders:{readOriginalSupplierResponse:async()=>{readSupplier++;return null;},readOriginalBillingOutcome:async()=>{readBilling++;return null;}},
  runAnalysis:async()=>{executed++;}});
 assert.equal(await reopened.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),null);
 const transitioned={...job,status:'blocked' as const,code:'weekly_postanalysis_exact_analysis_original_receipt_pending',updatedAt:new Date().toISOString(),resultRefs:[{type:'social_discovery_run',id:run.runId,version:1}]};
 assert.equal(weeklyCandidateExactJobBindingHash(transitioned),weeklyCandidateExactJobBindingHash(job));
 const evolvedRun={...run,status:'succeeded' as const,modeStats:{account:{requested:5,fetched:5,deduplicated:0,accepted:5,momentumCandidates:0,failed:0,costCny:0,effectiveRate:1}},evidenceOutcomes:{account:{acceptedCandidateIds:['candidate-0'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}},finishedAt:new Date().toISOString()};
 assert.equal(weeklyCandidateExactRunBindingHash(evolvedRun),weeklyCandidateExactRunBindingHash(run));
 const afterRestart=createWeeklyCandidateExactFormalPorts({root,job:transitioned,run:evolvedRun,authorityReader:reader,configurationHash:'c'.repeat(64),
  originalReaders:{readOriginalSupplierResponse:async()=>null,readOriginalBillingOutcome:async()=>null},runAnalysis:async()=>{executed++;}});
 assert.equal(await afterRestart.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),null,'ordinary producer status changes cannot strand original settlement');
 await assert.rejects(afterRestart.authorize!({job:{...transitioned,authority:{...transitioned.authority!,scopeId:'other'}},run,record,mediaSha256,operationId}),/lineage_changed/);
 await assert.rejects(afterRestart.authorize!({job:{...transitioned,consumerInputHash:'changed'},run,record,mediaSha256,operationId}),/lineage_changed/);
 await assert.rejects(afterRestart.authorize!({job:transitioned,run:{...evolvedRun,planId:'other'},record,mediaSha256,operationId}),/lineage_changed/);
 now+=120_000;
 // The original response and billing evidence can arrive after expiry. The
 // already held operation remains readable, but a new paid execution cannot
 // use this now-expired authorization.
 assert.equal(await reopened.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),null);
 await assert.rejects(ports.execute!({job,run,record,mediaSha256,operationId,...auth}),/statement_invalid/);
 revoked=true;
 await assert.rejects(reopened.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),/revocation_unknown_or_revoked/);
 revoked=false;
 const ledger=fs.readdirSync(root).find(name=>name.endsWith('.json')&&JSON.parse(fs.readFileSync(path.join(root,name),'utf8')).schema==='weekly-candidate-exact-shared-cny.v1');
 assert(ledger);
 fs.renameSync(path.join(root,ledger),path.join(root,ledger+'.missing'));
 await assert.rejects(reopened.readSettledReceipt!({operationId,candidateId,mediaSha256,...auth}),/hold_missing_or_changed/);
 assert.equal(fs.existsSync(path.join(root,ledger)),false);
 assert.equal(executed,1);assert.equal(readSupplier,0);assert.equal(readBilling,0);
});
