import { ExternalVideoApprovalPanel } from './ExternalVideoApprovalPanel';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import test from 'node:test';
import {TikTokPostSettings} from './TikTokPostSettings';
import {emptyTikTokPostSettings,type TikTokCreatorResponse} from '../../lib/tikTokPostSettings';
const creator:TikTokCreatorResponse={accountId:'account',queriedAt:new Date().toISOString(),creatorReceiptHash:'a'.repeat(64),directPostApproved:true,creator:{creator_username:'controlled',creator_nickname:'Controlled Creator',privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE'],comment_disabled:true,duet_disabled:true,stitch_disabled:false,max_video_post_duration_sec:60}};
test('real settings component shows current nickname, limits, no privacy default and disabled interaction',()=>{
  const html=renderToStaticMarkup(<TikTokPostSettings accountId="account" creator={creator} draft={emptyTikTokPostSettings()} onChange={()=>{}} onRefresh={()=>{}}/>);
  assert.match(html,/Controlled Creator/);assert.match(html,/最长 60 秒/);assert.match(html,/<option value="" selected="">请选择可见范围/);
  assert.doesNotMatch(html,/checked=""/);assert.match(html,/允许评论（账号已禁用）/);assert.match(html,/type="checkbox" disabled=""/);
  assert.match(html,/音乐使用声明/);assert.match(html,/我已预览视频/);assert.match(html,/创建审批单不会立即发布/);
});
test('commercial view renders branded terms and disables private choice',()=>{
  const draft={...emptyTikTokPostSettings(),privacyLevel:'PUBLIC_TO_EVERYONE' as const,disclosureEnabled:true,commercial:{ownBrand:false,brandedContent:true}};
  const html=renderToStaticMarkup(<TikTokPostSettings accountId="account" creator={creator} draft={draft} onChange={()=>{}} onRefresh={()=>{}}/>);
  assert.match(html,/<option value="SELF_ONLY" disabled="">/);assert.match(html,/品牌内容政策与音乐使用声明/);assert.match(html,/Paid partnership/);assert.match(html,/披露后必须选择/);
});

test('formal external approval entry mounts TikTok settings with editable copy and preview input',()=>{
 const html=renderToStaticMarkup(<ExternalVideoApprovalPanel storageScope="controlled-tenant"/>);
 assert.match(html,/TikTok 发布设置/);assert.match(html,/授权视频文件/);assert.match(html,/配文/);assert.match(html,/请选择已授权账号/);assert.match(html,/提交四平台审批/);
});
