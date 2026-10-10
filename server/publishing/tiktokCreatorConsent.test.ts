import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { readTikTokCreatorConsent, tikTokCreatorConsentHash } from './tiktokCreatorConsent.js';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { externalVideoApprovalHash, externalVideoApprovalSnapshot, externalVideoApprovalValid } from './externalVideoApproval.js';
import type { PostRecord } from './waLink.js';
const creator={creator_username:'creator',creator_nickname:'Visible creator',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60};
const options={privacyLevel:'SELF_ONLY',allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,musicUsageConfirmed:true,userConsent:true};
test('creator display proof binds native identity, current token and fresh settings without publishing',async()=>{
 const before={get:axios.get,post:axios.post}; const oldKey=process.env.TENANT_PLATFORM_APP_KEY;process.env.TENANT_PLATFORM_APP_KEY='controlled-only-key';
 let calls=0,rotate=false,wrongUser=false,rejected=false;
 const account:Record_={id:'account',tenantId:'tenant',platform:'tiktok',status:'connected',scope:'video.publish',providerAccountId:'native',accessToken:sealAccountCredential('controlled-token')};
 const dataStore={getById:async()=>++calls===2&&rotate?{...account,accessToken:sealAccountCredential('rotated')}:account} as unknown as DataStore;
 let queries=0;
 axios.get=(async(url:string)=>{assert.equal(url,'https://open.tiktokapis.com/v2/user/info/');return {data:{error:{code:'ok'},data:{user:{open_id:wrongUser?'foreign':'native'}}}};}) as typeof axios.get;
 axios.post=(async(url:string)=>{assert.equal(url,'https://open.tiktokapis.com/v2/post/publish/creator_info/query/');queries++;return {data:{error:{code:rejected?'denied':'ok'},data:creator}};}) as typeof axios.post;
 try{
  const proof=await readTikTokCreatorConsent({tenantId:'tenant',accountId:'account',dataStore});assert.equal(proof.creator.creator_nickname,'Visible creator');assert.match(proof.creatorReceiptHash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(proof).includes('controlled-token'));
  const base={tenantId:'tenant',accountId:'account',providerAccountId:'native',accessToken:'controlled-token',creator};assert.equal(proof.creatorReceiptHash,tikTokCreatorConsentHash(base));assert.notEqual(proof.creatorReceiptHash,tikTokCreatorConsentHash({...base,accountId:'foreign'}));assert.notEqual(proof.creatorReceiptHash,tikTokCreatorConsentHash({...base,creator:{...creator,creator_nickname:'Changed'}}));
  calls=0;rotate=true;await assert.rejects(readTikTokCreatorConsent({tenantId:'tenant',accountId:'account',dataStore}),/account_changed/);rotate=false;
  calls=0;wrongUser=true;const prior=queries;await assert.rejects(readTikTokCreatorConsent({tenantId:'tenant',accountId:'account',dataStore}),/native_identity_changed/);assert.equal(queries,prior);wrongUser=false;
  calls=0;rejected=true;await assert.rejects(readTikTokCreatorConsent({tenantId:'tenant',accountId:'account',dataStore}),/query_rejected/);rejected=false;
  calls=0;const priorForeign=queries;await assert.rejects(readTikTokCreatorConsent({tenantId:'foreign',accountId:'account',dataStore}),/account_not_ready/);assert.equal(queries,priorForeign);
 }finally{axios.get=before.get;axios.post=before.post;if(oldKey===undefined)delete process.env.TENANT_PLATFORM_APP_KEY;else process.env.TENANT_PLATFORM_APP_KEY=oldKey;}
});
test('external approval binds TikTok explicit choices and creator display proof; legacy or edits fail closed',()=>{
 const post:PostRecord={id:'post',tenant_id:'tenant',platform:'tiktok',title:'previewed title',track_code:'test',published_at:new Date(Date.now()+60000).toISOString(),stats:{origin:'authorized_external_video',videoSha256:'a'.repeat(64),publishSourceClaim:{sourceFingerprint:'b'.repeat(64)},targetAccountIds:['account'],tiktokPostOptions:options,tiktokCreatorReceiptHash:'c'.repeat(64),externalApprovalStatus:'approved'}};
 const stats=post.stats!;stats.externalApprovedContentHash=externalVideoApprovalHash(externalVideoApprovalSnapshot(post));assert.equal(externalVideoApprovalValid(post),true);
 for(const changed of [{tiktokPostOptions:{...options,allowComment:true}},{tiktokCreatorReceiptHash:'d'.repeat(64)},{tiktokPostOptions:undefined},{tiktokPostOptions:{...options,userConsent:false}},{targetAccountIds:['account','second']}])assert.equal(externalVideoApprovalValid({...post,stats:{...stats,...changed}}),false);
});
