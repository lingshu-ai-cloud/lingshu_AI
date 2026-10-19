import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createQwenMaaSPublishedTariffReader,isVerifiedPublishedTariff,QWEN_MAAS_TARIFF_CATALOG_VERSION} from './socialContentPublishedTariffs.js';
import {quoteSocialPaidOperationTariff,type SocialPaidOperationIntent} from './socialContentTaskBudgetAuthority.js';

const baseUrl='https://maas.qianwenaiapi.com/compatible-mode/v1';
const credentialSha256='a'.repeat(64);
const accountRef=`qwen:${createHash('sha256').update(JSON.stringify({baseUrl,credentialSha256})).digest('hex')}`;
const now=()=>new Date('2026-10-19T12:00:00.000Z');
const intent:SocialPaidOperationIntent={provider:'qwen',model:'qwen3-vl-plus',accountRef,stage:'director_review_capacity',shotId:null,operationId:'maas-g5',inputContractHash:'b'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:4096}};
const reader=(overrides:Partial<{provider:string;model:string;baseUrl:string;credentialSha256:string}>={})=>createQwenMaaSPublishedTariffReader({now,readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl,credentialSha256,...overrides})});

test('MaaS-specific standard-online ceiling quotes all three published input tiers conservatively',async()=>{
 const tariff=await reader().read(intent);assert.ok(tariff);
 assert.equal(tariff.publicPricingEvidence.catalogVersion,QWEN_MAAS_TARIFF_CATALOG_VERSION);
 assert.deepEqual(tariff.publicPricingEvidence.tiers.map(t=>[t.maximumInputTokens,t.inputPriceCnyPerMillion,t.outputPriceCnyPerMillion]),[[32768,1,10],[131072,1.5,15],[262144,3,30]]);
 assert.deepEqual([tariff.meters.inputTokens?.priceCny,tariff.meters.outputTokens?.priceCny],[3,30]);
 assert.equal(isVerifiedPublishedTariff(tariff),true);
 assert.ok(quoteSocialPaidOperationTariff(intent,tariff).upperBoundCny>0);
});
test('MaaS catalogue rejects another account, legacy endpoint and unverified input range',async()=>{
 assert.equal(await reader().read({...intent,accountRef:'qwen:wrong'}),null);
 assert.equal(await reader({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'}).read(intent),null);
 assert.equal(await reader({credentialSha256:'c'.repeat(64)}).read(intent),null);
 assert.equal(await reader().read({...intent,maximumUnits:{inputTokens:260097,outputTokens:4096}}),null);
 assert.equal(await reader().read({...intent,maximumUnits:{inputTokens:32768,outputTokens:32769}}),null);
 const cached=await reader().read(intent);assert.ok(cached);
 assert.throws(()=>quoteSocialPaidOperationTariff({...intent,maximumUnits:{inputTokens:260097,outputTokens:4096}},cached),/input_range_unverified/);
});
test('MaaS evidence is tamper evident and expires without silent online refresh',async()=>{
 const tariff=await reader().read(intent);assert.ok(tariff);
 const price=structuredClone(tariff);price.meters.inputTokens!.priceCny=1;assert.equal(isVerifiedPublishedTariff(price),false);
 const tier=structuredClone(tariff);tier.publicPricingEvidence.tiers=[...tier.publicPricingEvidence.tiers.slice(0,2),{maximumInputTokens:262144,inputPriceCnyPerMillion:3,outputPriceCnyPerMillion:10}];assert.equal(isVerifiedPublishedTariff(tier),false);
 const source=structuredClone(tariff);source.publicPricingEvidence.sourceUrl='https://help.aliyun.com/zh/model-studio/qwen3-vl-plus';assert.equal(isVerifiedPublishedTariff(source),false);
 const expired=createQwenMaaSPublishedTariffReader({now:()=>new Date('2027-01-18T00:00:00.000Z'),readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl,credentialSha256})});
 assert.equal(await expired.read(intent),null);
});
