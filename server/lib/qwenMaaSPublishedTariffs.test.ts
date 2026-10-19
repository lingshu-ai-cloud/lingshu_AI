import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createQwenMaaSPublishedTariffReader,isVerifiedPublishedTariff,QWEN_MAAS_TARIFF_CATALOG_VERSION,qwenMaaSPublishedTiers,selectQwenMaaSPublishedTier,verifyQwenMaaSPublishedPricingEvidence,type MaaSPublishedPricingEvidence} from './socialContentPublishedTariffs.js';
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
 const policy=verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl,credentialSha256});assert.ok(policy);
 assert.equal(selectQwenMaaSPublishedTier(32768,policy)?.inputPriceCnyPerMillion,1);
 assert.equal(selectQwenMaaSPublishedTier(32769,policy)?.inputPriceCnyPerMillion,1.5);
 assert.equal(selectQwenMaaSPublishedTier(131072,policy)?.outputPriceCnyPerMillion,15);
 assert.equal(selectQwenMaaSPublishedTier(131073,policy)?.outputPriceCnyPerMillion,30);
 assert.equal(selectQwenMaaSPublishedTier(262144,policy)?.maximumInputTokens,262144);
 assert.equal(selectQwenMaaSPublishedTier(262145,policy),null);
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
test('MaaS pricing policy binds source, account, provider binding and validity',async()=>{
 const tariff=await reader().read(intent);assert.ok(tariff);const verify=(evidence=tariff.publicPricingEvidence,overrides:Partial<{baseUrl:string;credentialSha256:string}>={})=>
  verifyQwenMaaSPublishedPricingEvidence(evidence,{baseUrl,credentialSha256,...overrides});
 assert.ok(verify());
 for(const mutate of [
  (e:any)=>e.basis='other',(e:any)=>e.provider='other',(e:any)=>e.sourceUrl='https://example.com',
  (e:any)=>e.sourceCheckedAt='2026-10-18T16:00:01.000Z',(e:any)=>e.accountRef='qwen:wrong',
  (e:any)=>e.providerBinding.baseUrl='https://dashscope.aliyuncs.com/compatible-mode/v1',
  (e:any)=>e.providerBinding.credentialSha256='c'.repeat(64),(e:any)=>e.checkedAt='invalid',(e:any)=>e.validUntil='invalid',
 ]){const changed:MaaSPublishedPricingEvidence=structuredClone(tariff.publicPricingEvidence);mutate(changed);assert.equal(verify(changed),null);}
 assert.equal(verify(tariff.publicPricingEvidence,{baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'}),null);
 assert.equal(verify(tariff.publicPricingEvidence,{credentialSha256:'c'.repeat(64)}),null);
});
test('MaaS pricing policy identity is stable across capability rebuilds',async()=>{
 const tariff=await reader().read(intent);assert.ok(tariff);
 const original=Date.now;try{
  Date.now=()=>Date.parse('2026-10-19T12:00:00.000Z');
  const first=verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl,credentialSha256});assert.ok(first);
  Date.now=()=>Date.parse('2026-10-19T12:00:01.000Z');
  const restarted=verifyQwenMaaSPublishedPricingEvidence(structuredClone(tariff.publicPricingEvidence),{baseUrl,credentialSha256});assert.ok(restarted);
  assert.notEqual(first.verifiedAt,restarted.verifiedAt);assert.equal(first.verificationHash,restarted.verificationHash);
 }finally{Date.now=original;}
});
test('verified pricing capability expires against the module clock and cannot be re-minted with caller time',async()=>{
 const tariff=await reader().read(intent);assert.ok(tariff);const policy=verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl,credentialSha256});assert.ok(policy);
 const original=Date.now;try{
  Date.now=()=>Date.parse('2027-01-16T16:00:00.000Z');
  assert.equal(selectQwenMaaSPublishedTier(1,policy),null);
  assert.equal(verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl,credentialSha256}),null);
 }finally{Date.now=original;}
});
test('exported tier snapshots cannot poison the authoritative catalogue',async()=>{
 const snapshot=qwenMaaSPublishedTiers() as Array<{maximumInputTokens:number;inputPriceCnyPerMillion:number;outputPriceCnyPerMillion:number}>;
 snapshot[0]!.inputPriceCnyPerMillion=.001;snapshot.push({maximumInputTokens:999999,inputPriceCnyPerMillion:.001,outputPriceCnyPerMillion:.001});
 assert.deepEqual(qwenMaaSPublishedTiers().map(t=>[t.maximumInputTokens,t.inputPriceCnyPerMillion,t.outputPriceCnyPerMillion]),[[32768,1,10],[131072,1.5,15],[262144,3,30]]);
 const tariff=await reader().read(intent);assert.ok(tariff);assert.equal(isVerifiedPublishedTariff(tariff),true);
});
