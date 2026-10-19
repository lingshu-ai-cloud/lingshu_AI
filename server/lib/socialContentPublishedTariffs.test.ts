import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createQwenMaaSPublishedTariffReader,createSocialContentPublishedTariffReader,parseOfficialQwenPublishedPrices,isVerifiedPublishedTariff,QWEN_PUBLISHED_TARIFF_VALIDITY_MS,selectQwenMaaSPublishedTier,verifyQwenMaaSPublishedPricingEvidence,verifyQwenMaaSPublishedPricingEvidenceForHistoricalSettlement} from './socialContentPublishedTariffs.js';
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
 assert.equal(Date.parse(tariff.validUntil)-Date.parse(tariff.checkedAt),QWEN_PUBLISHED_TARIFF_VALIDITY_MS);
});
test('durable conservative catalogue remains valid between periodic refreshes',async()=>{
 const tariff=await reader().read(intent);assert.ok(tariff);
 const afterThirtyDays=new Date(Date.parse(tariff.checkedAt)+30*24*3600000).toISOString();
 assert.ok(Date.parse(tariff.validUntil)>Date.parse(afterThirtyDays));
 assert.equal(isVerifiedPublishedTariff(tariff),true);
 const tooLong=structuredClone(tariff);tooLong.validUntil=new Date(Date.parse(tooLong.checkedAt)+QWEN_PUBLISHED_TARIFF_VALIDITY_MS+1).toISOString();tooLong.publicPricingEvidence.validUntil=tooLong.validUntil;
 assert.equal(isVerifiedPublishedTariff(tooLong),false);
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
 assert.equal(await createSocialContentPublishedTariffReader({readProviderBinding:async()=>({provider:'qwen',model,baseUrl:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256}),fetchOfficial:async()=>{throw Error('must_not_fetch');}}).read(intent),null);
 const t=await reader().read(intent);assert.ok(t);const corrupt=structuredClone(t);corrupt.publicPricingEvidence.sourceBody+='mutated';assert.equal(isVerifiedPublishedTariff(corrupt),false);
 const price=structuredClone(t);price.meters.inputTokens!.priceCny=.01;assert.equal(isVerifiedPublishedTariff(price),false);
});
test('historical MaaS verifier shares strict structure checks but grants no live pricing capability',async()=>{
 const maaSBase='https://maas.qianwenaiapi.com/compatible-mode/v1',key='a'.repeat(64),maaSAccount=`qwen:${hash(JSON.stringify({baseUrl:maaSBase,credentialSha256:key}))}`;
 const maaSIntent:SocialPaidOperationIntent={provider:'qwen',model:'qwen3-vl-plus',accountRef:maaSAccount,stage:'candidate_exact_analysis',shotId:null,
  operationId:'historical-settlement',inputContractHash:'b'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:16384}};
 const tariff=await createQwenMaaSPublishedTariffReader({now:()=>new Date('2026-10-19T12:00:00.000Z'),readProviderBinding:async()=>
  ({provider:'qwen',model:'qwen3-vl-plus',baseUrl:maaSBase,credentialSha256:key})}).read(maaSIntent);assert.ok(tariff);
 const original=Date.now;try{
  Date.now=()=>Date.parse('2026-10-19T12:00:00.000Z');const live=verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl:maaSBase,credentialSha256:key});assert.ok(live);
  const historical=verifyQwenMaaSPublishedPricingEvidenceForHistoricalSettlement(tariff.publicPricingEvidence,{baseUrl:maaSBase,credentialSha256:key});assert.ok(historical);assert.equal(historical.pricingPolicyHash,live.verificationHash);
  assert.equal(selectQwenMaaSPublishedTier(100,historical as any),null,'historical proof is not a WeakSet-backed claim capability');
  Date.now=()=>Date.parse(tariff.validUntil)+1;assert.equal(verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl:maaSBase,credentialSha256:key}),null);
  assert.equal(verifyQwenMaaSPublishedPricingEvidenceForHistoricalSettlement(tariff.publicPricingEvidence,{baseUrl:maaSBase,credentialSha256:key})?.pricingPolicyHash,live.verificationHash);
  for(const mutate of [(e:any)=>e.tiers[0].inputPriceCnyPerMillion=9,(e:any)=>e.providerBinding.credentialSha256='c'.repeat(64),(e:any)=>e.catalogEntrySha256='d'.repeat(64)]){
   const changed:any=structuredClone(tariff.publicPricingEvidence);mutate(changed);assert.equal(verifyQwenMaaSPublishedPricingEvidenceForHistoricalSettlement(changed,{baseUrl:maaSBase,credentialSha256:key}),null);
  }
 }finally{Date.now=original;}
});
