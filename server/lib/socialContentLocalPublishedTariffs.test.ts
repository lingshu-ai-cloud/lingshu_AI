import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSocialContentLocalPublishedTariffReader,isVerifiedPublishedTariff,QWEN_LOCAL_TARIFF_CATALOG_VERSION,QWEN_PUBLISHED_TARIFF_VALIDITY_MS} from './socialContentPublishedTariffs.js';
import type {SocialPaidOperationIntent} from './socialContentTaskBudgetAuthority.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const baseUrl='https://dashscope.aliyuncs.com/compatible-mode/v1';
const credentialSha256='a'.repeat(64);
const accountRef=`qwen:${sha(JSON.stringify({baseUrl,credentialSha256}))}`;
const now=()=>new Date('2026-10-12T12:00:00.000Z');
function intent(model:'qwen3-vl-flash'|'qwen3-vl-plus'):SocialPaidOperationIntent{return {provider:'qwen',model,accountRef,stage:model.endsWith('flash')?'material_video_analysis':'video_qa',shotId:null,operationId:`offline-${model}`,inputContractHash:'b'.repeat(64),maximumUnits:{inputTokens:100000,outputTokens:4096}};}
function reader(model:'qwen3-vl-flash'|'qwen3-vl-plus',overrides:Partial<{baseUrl:string;credentialSha256:string;provider:string;model:string}>={}){return createSocialContentLocalPublishedTariffReader({now,readProviderBinding:async()=>({provider:'qwen',model,baseUrl,credentialSha256,...overrides})});}

test('reviewed Beijing catalogue prices flash and plus without a network dependency',async()=>{
 const flash=await reader('qwen3-vl-flash').read(intent('qwen3-vl-flash'));
 const plus=await reader('qwen3-vl-plus').read(intent('qwen3-vl-plus'));
 assert.ok(flash);assert.ok(plus);
 assert.deepEqual([flash.meters.inputTokens?.priceCny,flash.meters.outputTokens?.priceCny],[.6,6]);
 assert.deepEqual([plus.meters.inputTokens?.priceCny,plus.meters.outputTokens?.priceCny],[3,30]);
 assert.equal(flash.publicPricingEvidence.catalogVersion,QWEN_LOCAL_TARIFF_CATALOG_VERSION);
 assert.equal(Date.parse(flash.validUntil)-Date.parse(flash.checkedAt),QWEN_PUBLISHED_TARIFF_VALIDITY_MS);
 assert.equal(isVerifiedPublishedTariff(flash),true);assert.equal(isVerifiedPublishedTariff(plus),true);
});

test('catalogue rejects account, endpoint and credential mismatch before returning a tariff',async()=>{
 assert.equal(await reader('qwen3-vl-flash').read({...intent('qwen3-vl-flash'),accountRef:'qwen:foreign'}),null);
 assert.equal(await reader('qwen3-vl-flash',{baseUrl:'https://gateway.example/v1'}).read(intent('qwen3-vl-flash')),null);
 assert.equal(await reader('qwen3-vl-flash',{baseUrl:'https://maas.qianwenaiapi.com/compatible-mode/v1'}).read(intent('qwen3-vl-flash')),null);
 assert.equal(await reader('qwen3-vl-flash',{credentialSha256:'not-a-sha'}).read(intent('qwen3-vl-flash')),null);
 assert.equal(await reader('qwen3-vl-flash',{model:'qwen3-vl-plus'}).read(intent('qwen3-vl-flash')),null);
});

test('catalogue exact values, version and hashes are tamper evident',async()=>{
 const tariff=await reader('qwen3-vl-plus').read(intent('qwen3-vl-plus'));assert.ok(tariff);
 const price=structuredClone(tariff);price.meters.outputTokens!.priceCny=1;assert.equal(isVerifiedPublishedTariff(price),false);
 const version=structuredClone(tariff);version.publicPricingEvidence.catalogVersion='forged';assert.equal(isVerifiedPublishedTariff(version),false);
 const hash=structuredClone(tariff);hash.publicPricingEvidence.catalogEntrySha256='0'.repeat(64);assert.equal(isVerifiedPublishedTariff(hash),false);
 const account=structuredClone(tariff);account.publicPricingEvidence.providerBinding.credentialSha256='c'.repeat(64);assert.equal(isVerifiedPublishedTariff(account),false);
});

test('expired 90-day catalogue fails closed and never attempts online refresh',async()=>{
 const expired=createSocialContentLocalPublishedTariffReader({now:()=>new Date('2027-01-11T00:00:00.000Z'),readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-flash',baseUrl,credentialSha256})});
 assert.equal(await expired.read(intent('qwen3-vl-flash')),null);
});
