import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createApifyPrepaidOriginalPostJournal} from './apifyPrepaidOriginalPost.js';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const endpoint='https://api.apify.com/v2/actors/clockworks~tiktok-scraper/runs?maxTotalChargeUsd=0.500000';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apify-original-post-'));
 const old=process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT;
 process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT=fs.realpathSync(root);
 const scope={operationIdentity:sha('operation'),requestHash:sha('bound-request'),token:'private-test-token',actorInput:{profiles:['https://www.tiktok.com/@yuchengcosmeticsfactory'],resultsLimit:5}};
 return {root,scope,cleanup(){if(old===undefined)delete process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT;else process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT=old;fs.rmSync(root,{recursive:true,force:true});}};
}
const response=()=>new Response(JSON.stringify({data:{id:'run-1',actId:'opaque-actor-1',defaultDatasetId:'dataset-1'}}),{status:201});

test('durable original 201 binds one exact operation, token and actor body, then restart reads without another POST',async()=>{
 const f=fixture();try{
  let posts=0,checks=0;
  const journal=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:async s=>{checks++;assert.equal(s.operationIdentity,f.scope.operationIdentity);assert.equal(s.requestHash,f.scope.requestHash);assert.equal(s.tokenFingerprint,sha(JSON.stringify(f.scope.token)));assert.equal(s.actorInputSha256,sha(JSON.stringify(f.scope.actorInput)));},fetcher:async(url,init)=>{posts++;assert.equal(url,endpoint);assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.headers instanceof Headers,false);assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${f.scope.token}`);const r=response();Object.defineProperty(r,'url',{value:endpoint});return r;}});
  const receipt=await journal.submit(f.scope);assert.equal(receipt.status,201);assert.equal((receipt.body as {data:{id:string}}).data.id,'run-1');
  const again=await journal.submit(f.scope);assert.deepEqual(again,receipt);assert.equal(posts,1);assert.equal(checks,1);
  const restarted=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:async()=>{throw Error('unexpected');},fetcher:async()=>{throw Error('unexpected');}});
  assert.deepEqual(await restarted.read({operationIdentity:f.scope.operationIdentity,requestHash:f.scope.requestHash,tokenFingerprint:sha(JSON.stringify(f.scope.token))}),receipt);
  await assert.rejects(()=>restarted.read({operationIdentity:f.scope.operationIdentity,requestHash:sha('old-run'),tokenFingerprint:sha(JSON.stringify(f.scope.token))}),/unverified/);
  await assert.rejects(()=>restarted.submit({...f.scope,actorInput:{profiles:['https://www.tiktok.com/@other'],resultsLimit:5}}),/unverified/);
 }finally{f.cleanup();}
});

test('claim survives network failure and never repeats a possibly charged POST',async()=>{
 const f=fixture();try{let posts=0;const journal=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:async()=>{},fetcher:async()=>{posts++;throw Error('network gone');}});
  await assert.rejects(()=>journal.submit(f.scope),/network gone/);await assert.rejects(()=>journal.submit(f.scope),/unknown_no_replay/);assert.equal(posts,1);
  assert.equal(await journal.read({operationIdentity:f.scope.operationIdentity,requestHash:f.scope.requestHash,tokenFingerprint:sha(JSON.stringify(f.scope.token))}),null);
 }finally{f.cleanup();}
});

test('ledger authority failure makes zero POST and zero claim; malformed original response stays unknown',async()=>{
 const f=fixture();try{let posts=0;const blocked=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:async()=>{throw Error('not submitted_unknown');},fetcher:async()=>{posts++;return response();}});
  await assert.rejects(()=>blocked.submit(f.scope),/not submitted_unknown/);assert.equal(posts,0);
  const invalid=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:async()=>{},fetcher:async()=>{posts++;const r=new Response('{}',{status:201});Object.defineProperty(r,'url',{value:endpoint});return r;}});
  await assert.rejects(()=>invalid.submit(f.scope),/unverified/);await assert.rejects(()=>invalid.submit(f.scope),/unknown_no_replay/);assert.equal(posts,1);
 }finally{f.cleanup();}
});

test('tampered original response bytes cannot become an accepted receipt',async()=>{
 const f=fixture();try{const journal=createApifyPrepaidOriginalPostJournal({assertSubmittedUnknown:async()=>{},fetcher:async()=>{const r=response();Object.defineProperty(r,'url',{value:endpoint});return r;}});
  await journal.submit(f.scope);const file=path.join(f.root,'.original-apify-post',sha(f.scope.operationIdentity)+'.response.json');fs.writeFileSync(file,'{"data":{"id":"old-run","actId":"opaque-actor-1","defaultDatasetId":"dataset-1"}}');
  await assert.rejects(()=>journal.read({operationIdentity:f.scope.operationIdentity,requestHash:f.scope.requestHash,tokenFingerprint:sha(JSON.stringify(f.scope.token))}),/unverified/);
 }finally{f.cleanup();}
});
