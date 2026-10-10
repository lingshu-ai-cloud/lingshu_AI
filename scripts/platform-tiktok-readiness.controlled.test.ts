import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import axios from 'axios';
import { uploadTikTokVideo, getTikTokPublishStatus, probeTikTokPublishingPermission, type TikTokUploadLifecycle } from '../server/integrations/social.js';
import { tikTokOAuthScopes } from '../server/lib/socialOAuthScopes.js';
import { tikTokAccountIdentityHash, type TikTokAttemptPreparedReceipt } from '../server/lib/tikTokDirectPostContract.js';
const creator={creator_username:'controlled',creator_nickname:'Controlled Creator',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60};
const options={privacyLevel:'SELF_ONLY' as const,allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:true,musicUsageConfirmed:true,userConsent:true};
test('scope gate requires explicit local approval declaration',()=>{
  assert.deepEqual(tikTokOAuthScopes({}),['user.info.basic']);
  assert.deepEqual(tikTokOAuthScopes({TIKTOK_DIRECT_POST_RELEASE_MODE:'approved'}),['user.info.basic','video.publish']);
});
test('controlled creator validation and durable receipt precede upload; lost upload retains original receipt',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tiktok-controlled-')),file=path.join(dir,'v.mp4');fs.writeFileSync(file,Buffer.from('controlled media'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>{throw Error('outbound fetch denied');});
  t.mock.method(axios,'request',async()=>{throw Error('unexpected axios network denied');});
  const old=process.env.TIKTOK_DIRECT_POST_RELEASE_MODE;process.env.TIKTOK_DIRECT_POST_RELEASE_MODE='approved';t.after(()=>{if(old===undefined)delete process.env.TIKTOK_DIRECT_POST_RELEASE_MODE;else process.env.TIKTOK_DIRECT_POST_RELEASE_MODE=old;});
  const effects:string[]=[],identityHash=tikTokAccountIdentityHash({tenantId:'tenant',accountId:'account',providerAccountId:'open',accessToken:'controlled-token'});
  let receipt:TikTokAttemptPreparedReceipt|undefined,publishId='',inits=0,puts=0,loseUpload=false;
  t.mock.method(axios,'post',async(url:string,body:any,config:any)=>{
    assert.equal(config.maxRedirects,0);assert.equal(config.headers.Authorization,'Bearer controlled-token');
    if(url.endsWith('/creator_info/query/')){effects.push('creator');return{data:{data:creator,error:{code:'ok'}}};}
    assert.equal(url,'https://open.tiktokapis.com/v2/post/publish/video/init/');inits++;effects.push('init');
    assert.equal(body.post_info.privacy_level,'SELF_ONLY');assert.equal(body.post_info.disable_comment,true);assert.equal(body.post_info.is_aigc,true);
    return{data:{data:{publish_id:'original-publish',upload_url:'https://open-upload.tiktokapis.com/upload/?controlled=1'},error:{code:'ok'}}};
  });
  t.mock.method(axios,'put',async(_url:string,stream:fs.ReadStream,config:any)=>{puts++;effects.push('put');for await (const _chunk of stream) { /* consume controlled file locally */ } assert.equal(config.maxRedirects,0);assert.equal(config.headers.Authorization,undefined);if(loseUpload)throw Error('controlled upload response lost');return{data:{}};});
  const lifecycle:TikTokUploadLifecycle={tenantId:'tenant',accountId:'account',attemptId:'original-attempt',accountIdentityHash:identityHash,options,probeDuration:async()=>3,
    async onTikTokAttemptPrepared(value){receipt=value;effects.push('persist-prepared');},async beforeInit(){effects.push('before-init');},async onProviderReceipt(id){publishId=id;effects.push('persist-init');},async beforeUpload(){effects.push('before-upload');}};
  const result=await uploadTikTokVideo('controlled-token',{filePath:file,title:'controlled'},lifecycle);
  assert.equal(result.deliveryStatus,'provider_accepted');assert.equal(result.id,'');assert.equal(result.providerReceiptId,publishId);
  assert.deepEqual(effects,['creator','persist-prepared','creator','before-init','init','persist-init','before-upload','put']);
  assert.equal(receipt!.videoSha256,createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  effects.length=0;loseUpload=true;
  await assert.rejects(uploadTikTokVideo('controlled-token',{filePath:file,title:'controlled'},{...lifecycle,attemptId:'separate-fault-attempt'}),/upload response lost/);
  assert.equal(publishId,'original-publish');assert.equal(inits,2);assert.equal(puts,2);
  await assert.rejects(uploadTikTokVideo('controlled-token',{filePath:file,title:'controlled'},{...lifecycle,async onProviderReceipt(){throw Error('durable init write failed');}}),/durable init write/);
  assert.equal(puts,2,'failed receipt persistence never uploads');
  await assert.rejects(uploadTikTokVideo('controlled-token',{filePath:file,title:'controlled'},{...lifecycle,options:{...options,privacyLevel:'PUBLIC_TO_EVERYONE'}}),/privacy/);
  assert.equal(inits,3,'invalid creator privacy never initializes');
  let creatorReads=0;
  t.mock.method(axios,'post',async()=>({data:{data:{...creator,creator_username:++creatorReads===1?'controlled':'different-creator'},error:{code:'ok'}}}));
  await assert.rejects(uploadTikTokVideo('controlled-token',{filePath:file,title:'controlled'},lifecycle),/creator_changed_before_init/);
  assert.equal(inits,3,'changed creator never initializes');
});
test('status lookup is read-only and preserves original publish ID with explicit error envelope',async t=>{
  let queries=0,status='PUBLISH_COMPLETE',ids:string[]=[];
  t.mock.method(axios,'post',async(url:string,body:any)=>{assert.equal(url,'https://open.tiktokapis.com/v2/post/publish/status/fetch/');assert.deepEqual(body,{publish_id:'original-publish'});queries++;return{data:{data:{status,publicaly_available_post_id:ids},error:{code:'ok'}}};});
  assert.equal((await getTikTokPublishStatus('controlled-token','original-publish')).state,'unknown');
  ids=['original-public-post'];const result=await getTikTokPublishStatus('controlled-token','original-publish');assert.equal(result.state,'published');assert.equal(result.publishId,'original-publish');
  status='PROCESSING_UPLOAD';assert.equal((await getTikTokPublishStatus('controlled-token','original-publish')).state,'processing');
  assert.equal(queries,3);
  t.mock.method(axios,'post',async()=>({data:{data:{creator_username:'controlled'},error:{code:'spam_risk_too_many_posts'}}}));
  assert.equal((await probeTikTokPublishingPermission('controlled-token')).granted,false);
  await assert.rejects(getTikTokPublishStatus('controlled-token','original-publish'),/status_rejected/);
});
