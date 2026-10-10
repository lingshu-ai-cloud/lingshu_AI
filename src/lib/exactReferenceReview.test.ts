import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExactReferenceReview,allowsLegacyReferenceNavigation} from './exactReferenceReview.js';
const target={recordId:'actual-record',executionTaskId:'execution',sourceVersion:'a'.repeat(64),tenantId:'tenant',programId:'program',packageId:'package',packageVersion:2,contentTaskId:'content'};
test('canonical weekly source version is preserved without choosing a source',()=>{assert.deepEqual(parseExactReferenceReview({exactReferenceReview:target}),target);assert.equal(allowsLegacyReferenceNavigation({exactReferenceReview:target}),false);});
test('invalid exact presence cannot fall back to title URL or snapshot',()=>{for(const value of [null,[],{}, {...target,packageVersion:0},{...target,sourceVersion:''},{...target,recordId:' actual-record'}]){const detail={exactReferenceReview:value,inspirationReference:{referenceId:'first',title:'matching title',sourceUrl:'https://example.com'}};assert.equal(parseExactReferenceReview(detail),null);assert.equal(allowsLegacyReferenceNavigation(detail),false);}assert.equal(allowsLegacyReferenceNavigation({inspirationReference:{referenceId:'legacy'}}),true);});

test('loader verifies source twice and rejects missing ownership and late login',async()=>{
 const {loadExactReferenceReview}=await import('./exactReferenceReview.js');let token:string|null='session';let calls=0;
 const ports={token:()=>token,verify:async()=>{calls++;return target;},fetch:async(url:unknown)=>new Response(JSON.stringify(String(url).endsWith('review-handoff')?{referenceRecordId:target.recordId,status:'review_only',shots:[],issues:[],productionExecutionAllowed:false}:{id:target.recordId,tenantId:target.tenantId,canManage:true}))};
 await loadExactReferenceReview(target,ports);assert.equal(calls,2);
 await assert.rejects(loadExactReferenceReview(target,{...ports,fetch:async()=>new Response(JSON.stringify({id:target.recordId,tenantId:'foreign',canManage:true}))}),/not_owned/);
 await assert.rejects(loadExactReferenceReview(target,{...ports,fetch:async(url:unknown)=>new Response(JSON.stringify(String(url).endsWith('review-handoff')?{referenceRecordId:'wrong',status:'review_only',shots:[],issues:[],productionExecutionAllowed:false}:{id:target.recordId,tenantId:target.tenantId,canManage:true}))}),/handoff_unavailable/);
 await assert.rejects(loadExactReferenceReview(target,{...ports,verify:async()=>{token='other';return target;}}),/login_changed/);
});
