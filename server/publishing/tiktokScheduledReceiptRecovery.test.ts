import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import type {PostRecord} from './waLink.js';
import {runScheduledPublishingCycle, isScheduledPostDue} from './scheduledPublisher.js';
import {prepareTikTokAttemptReceipt, type TikTokDirectPostOptions} from '../lib/tikTokDirectPostContract.js';
import {PublishSourceVerificationError} from './publishSourceClaim.js';
const options:TikTokDirectPostOptions={privacyLevel:'SELF_ONLY',allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,musicUsageConfirmed:true,userConsent:true};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
test('TikTok scheduler retains prepared receipt across lost return and recovers only same attempt',async()=>{
 const original={list:store.list,getById:store.getById,update:store.update};
 const now=Date.parse('2026-10-10T12:00:00Z');
 const post:PostRecord={id:'post',tenant_id:'tenant',platform:'tiktok',title:'controlled',published_at:'2026-10-10T11:00:00Z',track_code:'controlled',stats:{status:'scheduled',publishAttempts:0,targetAccountIds:['account'],videoPath:'/controlled-local-fixture.mp4',tiktokPostOptions:options}};
 store.list=async<T>()=>({items:[structuredClone(post)] as T[],totalItems:1,totalPages:1,page:1,perPage:500});
 store.getById=async<T>(collection:string,id:string)=>collection==='posts'&&id===post.id?structuredClone(post) as T:null;
 store.update=async(collection:string,id:string,patch:Record<string,unknown>)=>{if(collection!=='posts'||id!==post.id)return false;Object.assign(post,structuredClone(patch));return true;};
 let submits=0,queries=0,attemptId='';
 const deps={verifySource:async()=>{},assertLegacyAccess:async()=>{},executeLegacyEffect:async<T>(_tenant:string,effect:()=>Promise<T>)=>effect(),acquirePublishLease:async()=>({async beforeEffect(){},async release(){}}),finalize:async(_id:string,patch:{stats?:Record<string,unknown>})=>{Object.assign(post,patch);},
  publish:async(input:import('./platformPublisher.js').PublishToAccountInput)=>{
   submits++;attemptId=String(input.publishAttemptId);assert.deepEqual(input.tiktokPostOptions,options);
   const receipt=prepareTikTokAttemptReceipt({tenantId:'tenant',accountId:'account',attemptId,accountIdentityHash:'a'.repeat(64),creator:{creator_username:'controlled',creator_nickname:'Controlled',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60},options,videoSha256:'b'.repeat(64),videoSize:10,durationSeconds:1,validatedAt:'2026-10-10T12:00:00Z'});
   assert.ok(input.onTikTokAttemptPrepared);await input.onTikTokAttemptPrepared(receipt);
   assert.ok(input.onProviderReceipt);await input.onProviderReceipt('original-publish-id');
   throw new PublishSourceVerificationError('controlled_post_init_source_changed');
  },resolvePending:async(input:Parameters<typeof import('./platformPublisher.js').resolvePendingPublishToAccount>[0])=>{
   queries++;assert.equal(input.providerReceiptId,'original-publish-id');assert.equal(input.publishAttemptId,attemptId);
   return{status:'published' as const,providerReceiptId:input.providerReceiptId,platformPostId:'original-post-id',platformUrl:'',providerStatus:'PUBLISH_COMPLETE',error:''};
  }};
 try{
  await runScheduledPublishingCycle(now,deps);
  const stats=object(post.stats), result=object(object(stats.publishResults).account);
  assert.equal(stats.status,'needs_attention');assert.equal(result.status,'unknown');assert.equal(result.providerReceiptId,'original-publish-id');assert.equal(object(result.tiktokValidationReceipt).attemptId,attemptId);
  assert.equal(isScheduledPostDue({...post,stats:{...stats,targetAccountIds:['account','never-submitted']}},now+30000),false);
  await runScheduledPublishingCycle(now+30000,deps);
  const resolved=object(object(object(post.stats).publishResults).account);
  assert.equal(resolved.status,'published');assert.equal(resolved.attemptId,attemptId);assert.equal(resolved.providerReceiptId,'original-publish-id');assert.equal(object(post.stats).publishAttempts,1);
  await runScheduledPublishingCycle(now+60000,deps);assert.equal(submits,1);assert.equal(queries,1);
 }finally{Object.assign(store,original);}
});
