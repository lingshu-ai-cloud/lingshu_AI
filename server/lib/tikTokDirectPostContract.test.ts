import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTikTokAttemptReceipt, assertTikTokAttemptReceipt, tikTokAccountIdentityHash } from './tikTokDirectPostContract.js';
const identity = { tenantId:'tenant',accountId:'account',providerAccountId:'open',accessToken:'controlled-token' };
const accountIdentityHash = tikTokAccountIdentityHash(identity);
const input = () => ({tenantId:'tenant',accountId:'account',attemptId:'attempt',accountIdentityHash,creator:{creator_username:'controlled',creator_nickname:'Controlled',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60},options:{privacyLevel:'SELF_ONLY' as const,allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:true,musicUsageConfirmed:true,userConsent:true},videoSha256:'a'.repeat(64),videoSize:20,durationSeconds:3,validatedAt:new Date().toISOString()});
test('prepared receipt freezes choices and identity without tokens',()=>{
  const source=input(),receipt=prepareTikTokAttemptReceipt(source); source.options.isAigc=false;
  assert.equal(receipt.options.isAigc,true); assert.ok(!JSON.stringify(receipt).includes(identity.accessToken));
  assertTikTokAttemptReceipt(receipt,{tenantId:'tenant',accountId:'account',accountIdentityHash,attemptId:'attempt'});
  for(const patch of [{tenantId:'other'},{accountId:'other'},{attemptId:'other'},{accountIdentityHash:tikTokAccountIdentityHash({...identity,accessToken:'changed'})}]) assert.throws(()=>assertTikTokAttemptReceipt(receipt,{tenantId:'tenant',accountId:'account',accountIdentityHash,attemptId:'attempt',...patch}),/scope_changed/);
  assert.throws(()=>assertTikTokAttemptReceipt({...receipt,videoSize:21},{tenantId:'tenant',accountId:'account',accountIdentityHash}),/receipt_changed/);
});
test('creator limits and explicit consent fail closed',()=>{
  assert.throws(()=>prepareTikTokAttemptReceipt({...input(),options:{...input().options,privacyLevel:'PUBLIC_TO_EVERYONE'}}),/privacy/);
  assert.throws(()=>prepareTikTokAttemptReceipt({...input(),options:{...input().options,allowComment:true}}),/interaction/);
  assert.throws(()=>prepareTikTokAttemptReceipt({...input(),durationSeconds:61}),/duration/);
  assert.throws(()=>prepareTikTokAttemptReceipt({...input(),options:{...input().options,userConsent:'false' as unknown as boolean}}),/consent/);
  assert.throws(()=>prepareTikTokAttemptReceipt({...input(),creator:{...input().creator,privacy_level_options:['UNKNOWN']}}),/creator/);
  assert.throws(()=>prepareTikTokAttemptReceipt({...input(),videoSize:65*1024*1024}),/chunk/);
});
