import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createApifyPrepaidOriginalDatasetJournal,type OriginalDatasetJournalScope} from './apifyPrepaidOriginalDatasetJournal.js';

const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function fixture(t:test.TestContext){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'apify-dataset-journal-'));
 const previous=process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT;
 process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT=fs.realpathSync(folder);
 t.after(()=>{if(previous===undefined)delete process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT;else process.env.WEEKLY_ACCOUNT_COLLECTION_PREPAID_LEDGER_ROOT=previous;fs.rmSync(folder,{recursive:true,force:true});});
 const token='fixture-dedicated-token';
 const scope:OriginalDatasetJournalScope={operationIdentity:sha('page-operation'),requestHash:sha('page-request'),tokenFingerprint:sha(JSON.stringify(token)),jobId:'job12345',runId:'RUNabc123',datasetId:'DATAabc123',pageKey:'0'};
 const urls={actor_get:'https://api.apify.com/v2/actors/clockworks~tiktok-scraper',run_get:'https://api.apify.com/v2/actor-runs/RUNabc123',dataset_get:'https://api.apify.com/v2/datasets/DATAabc123/items?offset=0&limit=5&format=json'} as const;
 return {folder,token,scope,urls};
}
const response=(url:string,body:unknown)=>{const value=new Response(JSON.stringify(body),{status:200});Object.defineProperty(value,'url',{value:url});return value;};

test('original dataset journal persists exact Actor/run/five-row GETs and restart reuses bytes without network',async t=>{
 const f=fixture(t);let gets=0,permits=0,claims=0;
 const journal=createApifyPrepaidOriginalDatasetJournal({scope:f.scope,assertSubmittedUnknown:async()=>{claims++;},paidPermit:{permitsPaidCollection:true,assertCurrent:async()=>{permits++;}},fetcher:async url=>{gets++;const u=String(url);return response(u,u===f.urls.actor_get?{data:{id:'ACTORabc'}}:u===f.urls.run_get?{data:{id:f.scope.runId,actId:'ACTORabc',defaultDatasetId:f.scope.datasetId}}:[{id:'7533731959172861206'},{id:'7533731959172861207'}]);}});
 assert.equal((await journal.get({url:f.urls.actor_get,token:f.token})).status,200);
 assert.equal((await journal.get({url:f.urls.run_get,token:f.token})).status,200);
 assert.equal((await journal.get({url:f.urls.dataset_get,token:f.token})).status,200);
 assert.equal(gets,3);assert.equal(permits,3);assert.equal(claims,3);
 const restarted=createApifyPrepaidOriginalDatasetJournal({scope:f.scope,assertSubmittedUnknown:async()=>{throw Error('no new claim');},fetcher:async()=>{throw Error('no repeat GET');}});
 assert.deepEqual((await restarted.read('dataset_get'))?.body,[{id:'7533731959172861206'},{id:'7533731959172861207'}]);
 for(const url of Object.values(f.urls))assert.equal((await restarted.get({url,token:f.token})).status,200);
 assert.equal(gets,3);
 await assert.rejects(restarted.get({url:f.urls.dataset_get,token:'wrong-token'}),/request_changed/);
 const wrong=createApifyPrepaidOriginalDatasetJournal({scope:{...f.scope,requestHash:sha('other-request')},assertSubmittedUnknown:async()=>{}});
 await assert.rejects(wrong.read('dataset_get'),/claim_changed/);
});

test('missing permit makes zero GET and missing accepted response never replays a claimed GET',async t=>{
 const f=fixture(t);let gets=0;
 const closed=createApifyPrepaidOriginalDatasetJournal({scope:f.scope,assertSubmittedUnknown:async()=>{},fetcher:async()=>{gets++;throw Error('unexpected');}});
 await assert.rejects(closed.get({url:f.urls.dataset_get,token:f.token}),/paid_permit_required/);
 assert.equal(gets,0);assert.equal(await closed.read('dataset_get'),null);
 const interrupted=createApifyPrepaidOriginalDatasetJournal({scope:f.scope,assertSubmittedUnknown:async()=>{},paidPermit:{permitsPaidCollection:true,assertCurrent:async()=>{}},fetcher:async()=>{gets++;throw Error('transport interrupted');}});
 await assert.rejects(interrupted.get({url:f.urls.dataset_get,token:f.token}),/transport interrupted/);
 assert.equal(await closed.read('dataset_get'),null);
 await assert.rejects(interrupted.get({url:f.urls.dataset_get,token:f.token}),/unknown_no_replay/);
 assert.equal(gets,1);
});
