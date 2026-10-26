import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareExternalNewsScope } from './externalNewsScope.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { ASSISTANT_HOME_PROMPTS } from '../../src/lib/assistantHomeQuickPrompts.js';
test('all four generic news cards clarify missing tenant scope without pretending to search',async()=>{
 for(const id of ['OP-02','OP-09','OP-11','OP-12']){
 const text=ASSISTANT_HOME_PROMPTS.find(item=>item.id===id)!.prompt;
 const result=await prepareExternalNewsScope([{role:'user',content:text}],'tenant',{read:async()=>null});
 assert.match(result?.clarification??'',/请补充资讯范围/);assert.match(result!.clarification!,/目标市场/);
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
 const clarification=(await prepareExternalNewsScope([{role:'user',content:'社交媒体资讯'}],'tenant',{read:async()=>null}))!.clarification!;
 const result=await prepareExternalNewsScope([{role:'user',content:'社交媒体资讯'},{role:'assistant',content:clarification},{role:'user',content:'美妆原料，中国市场，TikTok'}],'tenant',{read:async()=>null});
 assert.equal(result?.clarification,undefined);assert.match(result!.question,/社交媒体资讯/);assert.match(result!.question,/中国市场/);
 assert.equal(await prepareExternalNewsScope([{role:'user',content:'不要联网，行业资讯'}],'tenant'),null);
});
