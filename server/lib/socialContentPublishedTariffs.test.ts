import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSocialContentPublishedTariffReader,parseOfficialQwenPublishedPrices,isVerifiedPublishedTariff} from './socialContentPublishedTariffs.js';
import {createSocialContentTaskBudgetAuthority,type SocialPaidOperationIntent} from './socialContentTaskBudgetAuthority.js';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const model='qwen3-vl-plus',baseUrl='https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256='1'.repeat(64),accountRef=`qwen:${hash(JSON.stringify({baseUrl,credentialSha256}))}`;
const table=(input:string,output:string)=>`<table><thead><tr><th>计费项</th><th>价格（元）</th><th>单位</th></tr></thead><tbody><tr><td>输入</td><td>${input}</td><td>每百万 tokens</td></tr><tr><td>输出</td><td>${output}</td><td>每百万 tokens</td></tr><tr><td>输入（缓存命中）</td><td>0.01</td><td>每百万 tokens</td></tr></tbody></table>`;
function body(){const content=`<h2>模型价格 </h2><section id="华北2-北京-2"><section>${table('1','10')}</section><section>${table('3','30')}</section></section><section id="全球">${table('999','999')}</section><h2>限流</h2>`;return `window.__ICE_PAGE_PROPS__=${JSON.stringify({docDetailData:{storeData:{data:{title:model,alias:'/model-studio/'+model,website:'cn',language:'zh',content}}}})};`;}
const intent:SocialPaidOperationIntent={provider:'qwen',model,accountRef,stage:'material_image_analysis',shotId:null,operationId:'input-bound-image-analysis',inputContractHash:'2'.repeat(64),maximumUnits:{inputTokens:100000,outputTokens:4096}};
function reader(bodyText=body()){return createSocialContentPublishedTariffReader({readProviderBinding:async()=>({provider:'qwen',model,baseUrl,credentialSha256}),fetchOfficial:async url=>({url,status:200,body:bodyText})});}
test('server automatically parses the exact official China region and undiscounted maximum tiers',async()=>{
 const parsed=parseOfficialQwenPublishedPrices(body(),model);assert.equal(parsed?.inputPriceCnyPerMillion,3);assert.equal(parsed?.outputPriceCnyPerMillion,30);
 const tariff=await reader().read(intent);assert.ok(tariff);assert.equal(tariff.verifiedAccountPrice,false);assert.equal(tariff.pricingBasis,'published_undiscounted_ceiling');assert.equal(isVerifiedPublishedTariff(tariff),true);assert.equal(tariff.publicPricingEvidence.sourceResponseSha256,hash(body()));
 assert.equal(Date.parse(tariff.validUntil)-Date.parse(tariff.checkedAt),6*3600000);
});
test('published prices qualify whole-task budget without claiming negotiated account verification',async()=>{
 const tariff=await reader().read(intent);const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'3'.repeat(64)};
 const authority=createSocialContentTaskBudgetAuthority({ports:{assertCurrent:async()=>{},readApprovedPlan:async()=>({scope,authorizationRef:'normal-task-budget-10',maximumCny:10,paidOperations:[intent]}),readVerifiedTariff:async()=>tariff,verifyRejection:async()=>false}});
 const prepared=await authority.prepare(scope);assert.equal(prepared.quotes.get(intent.operationId)?.upperBoundCny,.42288);
 const forged={...tariff!,verifiedAccountPrice:true};const bad=createSocialContentTaskBudgetAuthority({ports:{assertCurrent:async()=>{},readApprovedPlan:async()=>({scope,authorizationRef:'task',maximumCny:10,paidOperations:[intent]}),readVerifiedTariff:async()=>forged,verifyRejection:async()=>false}});await assert.rejects(bad.prepare(scope),/tariff_missing_or_expired/);
});
test('wrong account, model, official redirect, malformed format and mutated evidence fail closed',async()=>{
 assert.equal(await reader().read({...intent,accountRef:'borrowed-model-name'}),null);assert.equal(await reader().read({...intent,model:'unknown-vendor-model'}),null);
 assert.equal(await reader(body().replace('价格（元）','Price (USD)')).read(intent),null);
 assert.equal(await reader(body().replaceAll('3','0').replaceAll('30','0')).read(intent),null);
 assert.equal(await createSocialContentPublishedTariffReader({readProviderBinding:async()=>({provider:'qwen',model,baseUrl,credentialSha256}),fetchOfficial:async()=>({url:'https://help.aliyun.com/zh/model-studio/models',status:200,body:body()})}).read(intent),null);
 assert.equal(await createSocialContentPublishedTariffReader({readProviderBinding:async()=>({provider:'qwen',model,baseUrl:'https://gateway.example/v1',credentialSha256}),fetchOfficial:async()=>{throw Error('must_not_fetch');}}).read(intent),null);
 const t=await reader().read(intent);assert.ok(t);const corrupt=structuredClone(t);corrupt.publicPricingEvidence.sourceBody+='mutated';assert.equal(isVerifiedPublishedTariff(corrupt),false);
 const price=structuredClone(t);price.meters.inputTokens!.priceCny=.01;assert.equal(isVerifiedPublishedTariff(price),false);
});
