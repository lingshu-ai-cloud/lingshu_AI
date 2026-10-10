import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStarterPublicationPackage} from './starterPublicationPackage.js';
import type {TikTokDirectPostOptions} from '../lib/tikTokDirectPostContract.js';
test('approved publication business hash binds explicit TikTok options and detaches caller mutation',()=>{
 const options:TikTokDirectPostOptions={privacyLevel:'SELF_ONLY',allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,userConsent:true,musicUsageConfirmed:true};
 const input={tenantId:'tenant',contentId:'artifact:publication',contentVersion:'1',contentHash:'a'.repeat(64),platform:'tiktok' as const,copy:{title:'controlled',body:'controlled',hashtags:[]},assets:[{kind:'video' as const,fileName:'video.mp4',downloadUrl:'https://controlled.invalid/video.mp4',contentHash:'b'.repeat(64)}],idempotencyKey:'controlled-package-key',tiktokPostOptions:options};
 const original=buildStarterPublicationPackage(input), changed=buildStarterPublicationPackage({...input,tiktokPostOptions:{...options,privacyLevel:'PUBLIC_TO_EVERYONE'}});
 assert.notEqual(original.packageHash,changed.packageHash);
 assert.notEqual(original.packageHash,buildStarterPublicationPackage({...input,tiktokPostOptions:undefined}).packageHash);
 options.allowComment=true;options.commercial.ownBrand=true;
 assert.equal(original.tiktokPostOptions?.allowComment,false);assert.equal(original.tiktokPostOptions?.commercial.ownBrand,false);
});
