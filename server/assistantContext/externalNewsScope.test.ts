import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareExternalNewsScope } from './externalNewsScope.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { ASSISTANT_HOME_PROMPTS } from '../../src/lib/assistantHomeQuickPrompts.js';
test('all four generic news cards continue with clearly labelled public information when profile fields are absent',async()=>{
 for(const id of ['OP-02','OP-09','OP-11','OP-12']){
 const text=ASSISTANT_HOME_PROMPTS.find(item=>item.id===id)!.prompt;
 const result=await prepareExternalNewsScope([{role:'user',content:text}],'tenant',{read:async()=>null});
 assert.equal(result?.clarification,undefined);assert.match(result!.question,/未配置.*目标市场/);assert.match(result!.question,/不推断企业适用性/);
 }
});
test('public scope uses tenant sector and market but never prices, customer identities or private business facts',async()=>{
 const profile={company:{industry:'美妆原料',mainMarkets:'中国'},products:{categories:'防晒剂',priceRange:'PRIVATE_PRICE'},socialStrategy:{primaryPlatforms:['TikTok']},bizRules:{secret:'PRIVATE_CUSTOMER'}} as unknown as EnterpriseProfile;
 const result=await prepareExternalNewsScope([{role:'user',content:'社交媒体资讯'}],'tenant',{read:async()=>profile});
 assert.equal(result?.clarification,undefined);assert.match(result!.question,/防晒剂/);assert.match(result!.question,/TikTok/);assert.doesNotMatch(result!.question,/PRIVATE/);
 profile.dataGovernance={aiAccessEnabled:false} as EnterpriseProfile['dataGovernance'];
 assert.ok((await prepareExternalNewsScope([{role:'user',content:'行业资讯'}],'tenant',{read:async()=>profile}))?.clarification);
});
test('a clarification reply retains the scene and an explicit user market overrides the profile',async()=>{
 const clarification='请补充资讯范围：社交媒体资讯还缺少目标市场。';
 const result=await prepareExternalNewsScope([{role:'user',content:'社交媒体资讯'},{role:'assistant',content:clarification},{role:'user',content:'美妆原料，中国市场，TikTok'}],'tenant',{read:async()=>null});
 assert.equal(result?.clarification,undefined);assert.match(result!.question,/社交媒体资讯/);assert.match(result!.question,/中国市场/);
 assert.equal(await prepareExternalNewsScope([{role:'user',content:'不要联网，行业资讯'}],'tenant'),null);
});
test('news defaults derive from agent settings and content plan without leaking private records',async()=>{
 const result=await prepareExternalNewsScope([{role:'user',content:'社交媒体资讯'}],'tenant',{read:async()=>({company:{},products:{},strategy:{focusMarkets:'美国'}} as EnterpriseProfile),readDefaults:async()=>({industry:'美妆',market:'欧洲',platforms:['Facebook','Instagram']})});
 assert.equal(result?.clarification,undefined);assert.match(result!.question,/Facebook/);assert.match(result!.question,/美国/);assert.doesNotMatch(result!.question,/欧洲/);
});
test('industry news does not inherit unrelated social-platform filters', async () => {
 const result=await prepareExternalNewsScope([{role:'user',content:'行业资讯：欧洲美妆原料最近30天'}],'tenant',{
  read:async()=>({company:{industry:'美妆原料'},products:{},socialStrategy:{primaryPlatforms:['TikTok']}} as EnterpriseProfile),
  readDefaults:async()=>({platforms:['YouTube','Instagram']}),
 });
 assert.ok(result);assert.doesNotMatch(result.question,/TikTok|YouTube|Instagram/);
});

test('daily news uses open discovery and distinguishes compilation day from the actual observation period', async () => {
 const prompt=ASSISTANT_HOME_PROMPTS.find(item=>item.id==='OP-02')!.prompt;
 const result=await prepareExternalNewsScope([{role:'user',content:prompt}],'fixture',{read:async()=>({company:{industry:'美妆原料',mainMarkets:'欧洲'},products:{categories:'护肤原料'}} as EnterpriseProfile)});
 assert.match(result!.question,/不限定指定站点/);assert.match(result!.question,/可信行业媒体、协会或合作伙伴/);
 assert.match(result!.question,/最近30天/);assert.match(result!.question,/今日指本次整理日期/);
 assert.match(result!.question,/事件沿用原文发布日期/);assert.match(result!.question,/报告标清实际观察期/);
});
