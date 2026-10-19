import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {supplementConsumerHash} from '../socialPrograms/weeklySupplementRequests.js';
import {bindWeeklyPreproductionAuthority} from '../runtime/weeklyPreproductionProducer.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {issueWeeklyAccountCollectionBudgetAuthorization,type PrepaidCollectionOperationAuthority,type PrepaidAcceptedPostReceipt} from './weeklyAccountCollectionBudget.js';
import {advanceWeeklyAccountCollectionOriginalTransport} from './weeklyAccountCollectionOriginalTransport.js';
import {assertApifySameRunPaidRead} from './apifyRunKvMappingReceipt.js';
import {apifyTokenFingerprint,APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME} from './apifyTokenFingerprint.js';

const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('original transport needs an explicit paid permit, uses one unknown claim and never replays an ambiguous POST',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),accountUrl='https://www.tiktok.com/@fixture_factory';
 const packageRow=(await f.store.list<any>('social_weekly_operating_packages')).items[0]!;await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:{...packageRow.payload,discoveryBudgetCny:5}});
 const task={...f.task,workflowKind:'readiness' as const,scope:'package' as const,accountId:null,publicationTaskId:null,inputSnapshot:{},status:'blocked' as const,ownBlockingReasons:['business_dispatch_required'],schedule:{...f.task.schedule,stepKind:'benchmark_collection' as const}};
 await f.store.create('social_weekly_execution_tasks',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,idempotency_key:task.idempotencyKey,status:task.status,payload:task});
 const payload={approval:{status:'approved',scopeVersion:3,approvedBy:'owner'},weeklyAccountRevision:{accountUrl,targetCount:5},discoveryBrief:{discoveryModes:['momentum','account','innovation'],weeklyAccountCollectionTarget:{accountUrl,targetCount:5},modePolicies:{momentum:{enabled:true},account:{enabled:true},innovation:{enabled:true}}}};
 await f.store.create('social_discovery_scopes',{id:'scope-transport',tenant_id:task.tenantId,version:3,status:'active',created_by:'owner',payload});
 await f.store.create('competitor_accounts',{id:'account-transport',tenantId:task.tenantId,platform:'tiktok',accountUrl});
 const job=await bindWeeklyPreproductionAuthority({store:f.store,tenantId:task.tenantId,actorUserId:'owner',programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(task),discovery:{scopeId:'scope-transport',scopeVersion:3,requestedModes:['momentum','account','innovation']}});
 const authorization=await issueWeeklyAccountCollectionBudgetAuthorization({store:f.store,tenantId:task.tenantId,actorUserId:'owner',programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,scopeId:'scope-transport',scopeVersion:3,scopeHash:socialRequestHash(payload),actorId:'clockworks/tiktok-scraper',totalLimitCny:5,perRunLimitCny:2,expiresAt:new Date(Date.now()+86400000).toISOString()});
 const actorInput={resultsPerPage:5,shouldDownloadVideos:false,shouldDownloadCovers:false,shouldDownloadSubtitles:false,shouldDownloadSlideshowImages:false,shouldDownloadAvatars:false,shouldDownloadMusicCovers:false,shouldDownloadMusic:false,profiles:['fixture_factory']};
 // Production wallet and durable POST journal both hash JSON.stringify(token).
 const scope={operationIdentity:'a'.repeat(64),requestHash:'b'.repeat(64),actorInput},tokenFingerprint=createHash('sha256').update(JSON.stringify('fixture-secret')).digest('hex');
 let status:'reserved'|'submitted_unknown'='reserved',post:PrepaidAcceptedPostReceipt|null=null,submits=0,claims=0,gets=0;
 const wallet={tokenFingerprint,async beginRun(o:PrepaidCollectionOperationAuthority){assert.equal(o.jobId,job.jobId);return {inspect:async()=>({status,requestHash:status==='reserved'?null:scope.requestHash}),beforeSubmit:async()=>{claims++;status='submitted_unknown';},originalPostScope:()=>scope,recordOriginalRun:async(assertRead?:(request:'actor_get'|'run_get')=>Promise<void>)=>{await assertRead?.('actor_get');await assertRead?.('run_get');gets++;}};}};
 const acceptedPost={read:async()=>post};
 const journal={submit:async()=>{submits++;throw Error('simulated network ambiguity');}};
 const args={store:f.store,authorization,jobId:job.jobId,wallet,acceptedPost,journal,token:'fixture-secret'};
 await assert.rejects(advanceWeeklyAccountCollectionOriginalTransport({...args,token:'different-secret',permit:{permitsPaidCollection:true,assertCurrent:async()=>{}}}),/token_binding_changed/);
 assert.equal(claims,0);assert.equal(submits,0);assert.equal(gets,0);
 await assert.rejects(advanceWeeklyAccountCollectionOriginalTransport(args),/paid_permit_required/);
 assert.equal(claims,0);assert.equal(submits,0);
 const paidChecks:Array<{kind:string;operationIdentity:string;requestHash:string;tokenFingerprint:string;actorInputSha256:string;runId:string|null;datasetId:string|null}>=[];
 const permit={permitsPaidCollection:true as const,assertCurrent:async(request:(typeof paidChecks)[number])=>{paidChecks.push(request);assert.equal(request.operationIdentity,scope.operationIdentity);assert.equal(request.requestHash,scope.requestHash);assert.equal(request.tokenFingerprint,tokenFingerprint);assert.equal(request.actorInputSha256,sha(actorInput));}};
 await assert.rejects(advanceWeeklyAccountCollectionOriginalTransport({...args,permit:{permitsPaidCollection:true,assertCurrent:async request=>{assert.equal(request.kind,'original_post');throw Error('operation-not-authorized');}}}),/operation-not-authorized/);
 assert.equal(claims,0);assert.equal(submits,0);
 await assert.rejects(advanceWeeklyAccountCollectionOriginalTransport({...args,permit}),/simulated network ambiguity/);
 assert.equal(claims,1);assert.equal(submits,1);
 assert.deepEqual(paidChecks.map(check=>[check.kind,check.runId,check.datasetId]),[['original_post',null,null],['original_post',null,null]]);
 assert.equal((await advanceWeeklyAccountCollectionOriginalTransport({...args,permit})).status,'submitted_unknown_no_replay');
 assert.equal(submits,1);
 post={operationIdentity:scope.operationIdentity,requestHash:scope.requestHash,tokenFingerprint,actorInputSha256:sha(actorInput),url:'https://api.apify.com/v2/actors/clockworks~tiktok-scraper/runs?maxTotalChargeUsd=0.500000',status:201,body:{data:{id:'run-1',actId:'actor-1',defaultDatasetId:'data-1'}}};
 await assert.rejects(advanceWeeklyAccountCollectionOriginalTransport(args),/paid_permit_required/);
 assert.equal(gets,0);
 assert.equal((await advanceWeeklyAccountCollectionOriginalTransport({...args,permit})).status,'original_run_verified');
 assert.equal(gets,1);assert.equal(submits,1);
 assert.deepEqual(paidChecks.slice(-2).map(check=>[check.kind,check.runId,check.datasetId]),[['actor_get','run-1','data-1'],['run_get','run-1','data-1']]);
});

test('one original-wallet token fingerprint passes versioned same-run KV reads, not a legacy or wrong-token alias',async()=>{
 const token='same-run-private-token',runId='apify-original-run',datasetId='apify-original-dataset';
 const fingerprint=apifyTokenFingerprint(token,APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME);
 let reads=0;
 const permit={permitsPaidCollection:true as const,tokenFingerprintScheme:APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME,tokenFingerprint:fingerprint,runId,datasetId,assertCurrent:async({kind,url}:{kind:'run_get'|'dataset_item_get'|'kv_keys_get'|'kv_media_get';url:string})=>{assert.equal(kind,'kv_media_get');assert.equal(url,'https://api.apify.com/v2/key-value-stores/STORE/records/VIDEO');reads++;}};
 const input={permit,token,runId,datasetId,kind:'kv_media_get' as const,url:'https://api.apify.com/v2/key-value-stores/STORE/records/VIDEO'};
 await assertApifySameRunPaidRead(input);
 assert.equal(reads,1);
 await assert.rejects(assertApifySameRunPaidRead({...input,permit:{...permit,tokenFingerprintScheme:'sha256-raw-v1' as const}}),/paid_read_permit_required/);
 await assert.rejects(assertApifySameRunPaidRead({...input,permit:{...permit,runId:'other-run'}}),/paid_read_permit_required/);
 await assert.rejects(assertApifySameRunPaidRead({...input,token:'different-token'}),/paid_read_permit_required/);
 assert.equal(reads,1);
 // Historical raw-digest media permits remain interpretable only when the
 // version is absent or explicitly raw, never by trying both digests.
 const legacy={...permit,tokenFingerprintScheme:undefined,tokenFingerprint:apifyTokenFingerprint(token,'sha256-raw-v1')};
 await assertApifySameRunPaidRead({...input,permit:legacy});
 assert.equal(reads,2);
});
