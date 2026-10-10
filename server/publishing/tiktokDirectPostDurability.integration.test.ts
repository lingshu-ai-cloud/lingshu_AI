import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Socket } from 'node:net';
import axios from 'axios';
import ffmpegStatic from 'ffmpeg-static';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import type { TikTokDirectPostOptions } from '../lib/tikTokDirectPostContract.js';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};

test('TikTok direct post durable boundaries preserve original attempt through controlled failures',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tiktok-durable-controlled-'));
 const originalCwd=process.cwd(),oldFetch=globalThis.fetch,oldConnect=Socket.prototype.connect;
 const originalAxios={get:axios.get,post:axios.post,put:axios.put};
 const envNames=['NODE_ENV','TIKTOK_DIRECT_POST_RELEASE_MODE','TENANT_PLATFORM_APP_KEY','TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK'] as const;
 const originalEnv=new Map(envNames.map(key=>[key,process.env[key]]));
 let outbound=0,initCalls=0,putCalls=0,statusCalls=0,creatorRejected=false,wrongNative=false,failPut=false,failValidationSave=false,failReceiptSave=false;
 globalThis.fetch=(async()=>{outbound++;throw Error('controlled_network_forbidden');}) as typeof fetch;
 Socket.prototype.connect=function(){outbound++;throw Error('controlled_socket_forbidden');} as typeof oldConnect;
 process.env.NODE_ENV='test';process.env.TIKTOK_DIRECT_POST_RELEASE_MODE='approved';process.env.TENANT_PLATFORM_APP_KEY='controlled-encryption-placeholder';process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK='true';
 const {store}=await import('../storage/index.js');
 const originalStore={getById:store.getById,list:store.list,create:store.create,update:store.update,delete:store.delete,supportsAtomicOperationLease:store.supportsAtomicOperationLease};
 try{
  const {publishVideoToAccount,resolvePendingPublishToAccount}=await import('./platformPublisher.js');
  const {publishingUploadDir}=await import('./publishSourceClaim.js');
  process.chdir(root);
  const uploadDir=publishingUploadDir('tenant-a');await fs.mkdir(uploadDir,{recursive:true});const videoPath=path.join(uploadDir,'manual-controlled.mp4');assert.ok(ffmpegStatic);
  await promisify(execFile)(String(ffmpegStatic),['-y','-f','lavfi','-i','color=c=blue:s=160x288:r=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p',videoPath],{timeout:30000,maxBuffer:1024*1024});
  assert.ok((await fs.stat(videoPath)).size>0);
  const rows=new Map<string,Record_[]>();
  const memory:DataStore={supportsAtomicOperationLease:()=>true,
   async getById<T>(collection:string,id:string){return structuredClone(rows.get(collection)?.find(row=>row.id===id)??null) as T|null;},
   async list<T>(collection:string,query:ListQuery={}){let items=rows.get(collection)??[];for(const [key,value] of Object.entries(query.where??{}))items=items.filter(row=>row[key]===value);const page=query.page??1,perPage=query.perPage??500;return {items:structuredClone(items.slice((page-1)*perPage,page*perPage)) as T[],totalItems:items.length,totalPages:Math.ceil(items.length/perPage),page,perPage};},
   async create<T>(collection:string,data:Record<string,unknown>){if(collection==='durable_operation_leases'&&(rows.get(collection)??[]).some(row=>row.tenant_id===data.tenant_id&&row.lease_scope===data.lease_scope&&row.subject_id===data.subject_id))return null;const row={...structuredClone(data),id:String(data.id??`${collection}-${(rows.get(collection)?.length??0)+1}`)};rows.set(collection,[...(rows.get(collection)??[]),row]);return structuredClone(row) as T;},
   async update(collection:string,id:string,data:Record<string,unknown>){if(collection==='posts'){const nextAttempt=object(object(object(data.stats).publishResults)['account-a']);if(failValidationSave&&nextAttempt.tiktokValidationReceipt){failValidationSave=false;return false;}if(failReceiptSave&&nextAttempt.providerReceiptId){failReceiptSave=false;return false;}}const row=rows.get(collection)?.find(row=>row.id===id);if(!row)return false;Object.assign(row,structuredClone(data));return true;},
   async delete(collection:string,id:string){const items=rows.get(collection)??[],next=items.filter(row=>row.id!==id);rows.set(collection,next);return next.length!==items.length;},
  };Object.assign(store,memory);
  const account:Record_={id:'account-a',tenantId:'tenant-a',platform:'tiktok',providerAccountId:'native-a',status:'connected',accessToken:'controlled-token',scope:'video.publish'};
  const reset=()=>{rows.clear();rows.set('social_accounts',[account,{...account,id:'account-b',providerAccountId:'native-b'}]);account.accessToken='controlled-token';account.providerAccountId='native-a';initCalls=putCalls=statusCalls=0;creatorRejected=wrongNative=failPut=failValidationSave=failReceiptSave=false;};
  const attempt=()=>object(object(object(rows.get('posts')?.[0]?.stats).publishResults)['account-a']);
  axios.get=(async(url:string,config:{maxRedirects?:number})=>{assert.equal(url,'https://open.tiktokapis.com/v2/user/info/');assert.equal(config.maxRedirects,0);return {data:{error:{code:'ok'},data:{user:{open_id:wrongNative?'foreign-native':'native-a',display_name:'Controlled'}}}};}) as typeof axios.get;
  axios.post=(async(url:string,body:unknown,config:{maxRedirects?:number})=>{
   assert.equal(config.maxRedirects,0);
   if(url.endsWith('/creator_info/query/'))return {data:{error:{code:'ok'},data:{creator_username:'controlled',creator_nickname:'Controlled',privacy_level_options:['PUBLIC_TO_EVERYONE'],comment_disabled:creatorRejected,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:60}}};
   if(url.endsWith('/video/init/')){initCalls++;assert.ok(attempt().tiktokValidationReceipt,'formal pre-init validation receipt must already be durable');return {data:{error:{code:'ok'},data:{publish_id:'original-publish-id',upload_url:'https://upload.tiktokapis.com/controlled'}}};}
   assert.ok(url.endsWith('/status/fetch/'),'unexpected provider endpoint');statusCalls++;assert.deepEqual(body,{publish_id:'original-publish-id'});return {data:{error:{code:'ok'},data:{status:'PUBLISH_COMPLETE',publicaly_available_post_id:['original-post-id']}}};
  }) as typeof axios.post;
  axios.put=(async(url:string,stream:AsyncIterable<unknown>,config:{maxRedirects?:number})=>{assert.equal(url,'https://upload.tiktokapis.com/controlled');assert.equal(config.maxRedirects,0);putCalls++;assert.equal(attempt().providerReceiptId,'original-publish-id','original init receipt must be durable before upload');for await(const _chunk of stream){void _chunk;}if(failPut)throw Error('controlled_put_crash');return {data:{}};}) as typeof axios.put;
  const options:TikTokDirectPostOptions={privacyLevel:'PUBLIC_TO_EVERYONE',allowComment:true,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:true,musicUsageConfirmed:true,userConsent:true};
  const input={tenantId:'tenant-a',accountId:'account-a',platform:'tiktok' as const,videoPath,title:'Controlled durability integration',contentId:'content-a',sourceKind:'manual_upload' as const,trackWaLink:false,tiktokPostOptions:options,publishAttemptId:'attempt-original'};
  await t.test('pre-init persistence callback failure stops before provider init',async()=>{reset();await assert.rejects(publishVideoToAccount({...input,onTikTokAttemptPrepared:async()=>{throw Error('controlled_prepare_save_failure');}}),/controlled_prepare_save_failure/);assert.equal(initCalls,0);assert.equal(putCalls,0);assert.equal(attempt().status,'failed');});
  await t.test('formal validation record write failure refuses init',async()=>{reset();failValidationSave=true;await assert.rejects(publishVideoToAccount(input),/tiktok_attempt_persistence_failed/);assert.equal(initCalls,0);assert.equal(putCalls,0);assert.equal(attempt().status,'failed');});
  await t.test('formal init receipt write failure refuses upload',async()=>{reset();failReceiptSave=true;await assert.rejects(publishVideoToAccount(input),/tiktok_attempt_persistence_failed/);assert.equal(initCalls,1);assert.equal(putCalls,0);assert.equal(attempt().status,'unknown');await assert.rejects(publishVideoToAccount(input),/禁止重复提交/);assert.equal(initCalls,1);});
  await t.test('init receipt callback failure stops upload and keeps receipt',async()=>{reset();await assert.rejects(publishVideoToAccount({...input,onProviderReceipt:async()=>{throw Error('controlled_receipt_save_failure');}}),/controlled_receipt_save_failure/);assert.equal(initCalls,1);assert.equal(putCalls,0);assert.equal(attempt().providerReceiptId,'original-publish-id');assert.equal(attempt().status,'unknown');});
  await t.test('upload crash can only query original validated attempt and never reinitialize',async()=>{
   reset();failPut=true;await assert.rejects(publishVideoToAccount(input),/controlled_put_crash/);assert.equal(initCalls,1);assert.equal(putCalls,1);assert.equal(attempt().attemptId,'attempt-original');assert.equal(attempt().providerReceiptId,'original-publish-id');assert.equal(attempt().status,'unknown');
   const lookup={tenantId:'tenant-a',accountId:'account-a',platform:'tiktok' as const,providerReceiptId:'original-publish-id',publishAttemptId:'attempt-original'};
   account.accessToken='changed-token';await assert.rejects(resolvePendingPublishToAccount(lookup),/tiktok_attempt_scope_changed/);assert.equal(statusCalls,0);account.accessToken='controlled-token';
   account.providerAccountId='changed-native';await assert.rejects(resolvePendingPublishToAccount(lookup),/tiktok_attempt_scope_changed/);assert.equal(statusCalls,0);account.providerAccountId='native-a';
   await assert.rejects(resolvePendingPublishToAccount({...lookup,accountId:'account-b'}),/tiktok_canonical_attempt_missing_or_ambiguous/);await assert.rejects(resolvePendingPublishToAccount({...lookup,tenantId:'tenant-b'}),/TikTok account not found/);await assert.rejects(resolvePendingPublishToAccount({...lookup,publishAttemptId:'foreign-attempt'}),/tiktok_canonical_attempt_missing_or_ambiguous/);assert.equal(statusCalls,0);
   const resolved=await resolvePendingPublishToAccount(lookup);assert.equal(resolved.status,'published');assert.equal(resolved.platformPostId,'original-post-id');assert.equal(resolved.providerReceiptId,'original-publish-id');assert.equal(statusCalls,1);
   await assert.rejects(publishVideoToAccount(input),/禁止重复提交/);assert.equal(initCalls,1);assert.equal(putCalls,1);assert.equal(rows.get('posts')?.length,1);assert.equal(attempt().attemptId,'attempt-original');
  });
  await t.test('explicit creator constraints and account changes fail before init',async()=>{
   reset();creatorRejected=true;await assert.rejects(publishVideoToAccount(input),/tiktok_interaction_disabled/);assert.equal(initCalls,0);
   reset();wrongNative=true;await assert.rejects(publishVideoToAccount(input),/tiktok_provider_account_changed/);assert.equal(initCalls,0);
   reset();await assert.rejects(publishVideoToAccount({...input,onTikTokAttemptPrepared:async()=>{account.accessToken='changed-token';}}),/tiktok_account_identity_changed/);assert.equal(initCalls,0);assert.equal(putCalls,0);
  });
  assert.equal(outbound,0);
 }finally{Object.assign(store,originalStore);Object.assign(axios,originalAxios);globalThis.fetch=oldFetch;Socket.prototype.connect=oldConnect;process.chdir(originalCwd);for(const key of envNames){const old=originalEnv.get(key);if(old===undefined)delete process.env[key];else process.env[key]=old;}await fs.rm(root,{recursive:true,force:true});}
});
