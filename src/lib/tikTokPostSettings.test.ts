import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTikTokPostSettings,editTikTokPostSettings,invalidateTikTokConsent,buildTikTokPostOptions,validateTikTokCreatorResponse,type TikTokCreatorResponse} from './tikTokPostSettings';
const response=():TikTokCreatorResponse=>({accountId:'account',creatorReceiptHash:'a'.repeat(64),queriedAt:new Date().toISOString(),directPostApproved:true,creator:{creator_username:'controlled',creator_nickname:'Controlled Creator',privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE'],comment_disabled:true,duet_disabled:true,stitch_disabled:false,max_video_post_duration_sec:60}});
const accepted=()=>({...emptyTikTokPostSettings(),privacyLevel:'SELF_ONLY' as const,musicUsageConfirmed:true,userConsent:true});
test('privacy and interactions have no opt-in defaults; changing approved content revokes consent',()=>{
  const empty=emptyTikTokPostSettings();assert.equal(empty.privacyLevel,'');assert.equal(empty.allowComment,false);assert.equal(empty.allowDuet,false);assert.equal(empty.allowStitch,false);
  assert.throws(()=>buildTikTokPostOptions({...empty,musicUsageConfirmed:true,userConsent:true},response(),'account'),/手动选择/);
  for(const change of [{privacyLevel:'PUBLIC_TO_EVERYONE' as const},{isAigc:true},{allowStitch:true},{disclosureEnabled:true}]){const edited=editTikTokPostSettings(accepted(),change);assert.equal(edited.userConsent,false);assert.equal(edited.musicUsageConfirmed,false);}
  assert.equal(invalidateTikTokConsent(accepted()).userConsent,false);
});
test('creator account mismatch/stale view/revoked audit and forbidden interactions block submission',()=>{
  assert.throws(()=>validateTikTokCreatorResponse(response(),'other'),/无法核验/);
  assert.throws(()=>validateTikTokCreatorResponse({...response(),queriedAt:'2020-01-01'},'account'),/无法核验/);
  assert.throws(()=>buildTikTokPostOptions(accepted(),{...response(),directPostApproved:false},'account'),/平台审核/);
  assert.throws(()=>buildTikTokPostOptions({...accepted(),allowComment:true},response(),'account'),/禁止所选互动/);
  assert.throws(()=>buildTikTokPostOptions({...accepted(),userConsent:false},response(),'account'),/明确授权/);
});
test('commercial choices enforce disclosure and branded privacy and freeze approved options',()=>{
  assert.throws(()=>buildTikTokPostOptions({...accepted(),disclosureEnabled:true},response(),'account'),/自己的品牌/);
  assert.throws(()=>buildTikTokPostOptions({...accepted(),disclosureEnabled:true,commercial:{ownBrand:false,brandedContent:true}},response(),'account'),/不能设为/);
  const draft={...accepted(),privacyLevel:'PUBLIC_TO_EVERYONE' as const,disclosureEnabled:true,commercial:{ownBrand:true,brandedContent:true},isAigc:true};
  const options=buildTikTokPostOptions(draft,response(),'account');draft.commercial.brandedContent=false;assert.equal(options.commercial.brandedContent,true);assert.equal(options.isAigc,true);
});
