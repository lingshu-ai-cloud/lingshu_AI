import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createQwenMaaSPublishedTariffReader,verifyQwenMaaSPublishedPricingEvidence,type VerifiedQwenMaaSPricingPolicy} from '../lib/socialContentPublishedTariffs.js';
import {measureWeeklyCandidateExactRequestCeiling,weeklyCandidateExactMeasurementPolicyHash,WEEKLY_EXACT_PROTOCOL_TOKEN_RESERVE} from './weeklyCandidateExactRequestCeiling.js';

const baseUrl='https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256='a'.repeat(64);
const accountRef=`qwen:${createHash('sha256').update(JSON.stringify({baseUrl,credentialSha256})).digest('hex')}`;
async function policy():Promise<VerifiedQwenMaaSPricingPolicy>{
 const tariff=await createQwenMaaSPublishedTariffReader({now:()=>new Date('2026-10-19T12:00:00.000Z'),
  readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl,credentialSha256})}).read({
   provider:'qwen',model:'qwen3-vl-plus',accountRef,stage:'reference_analysis',shotId:null,operationId:'ceiling-test',
   inputContractHash:'b'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:16384},
  });
 assert.ok(tariff);const verified=verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl,credentialSha256});
 assert.ok(verified);return verified;
}
const request=(content:unknown,max_tokens=1000,extra:Record<string,unknown>={})=>JSON.stringify({model:'qwen3-vl-plus',messages:[{role:'user',content}],response_format:{type:'json_object'},temperature:0,max_tokens,...extra});
const data=(mime:string,bytes:Buffer)=>`data:${mime};base64,${bytes.toString('base64')}`;
async function image(format:'png'|'jpeg'|'webp',width=384,height=672){return sharp({create:{width,height,channels:3,background:'#4263eb'}})[format]().toBuffer();}
async function animatedWebp(){
 const red=await image('png',16,16),blue=await sharp({create:{width:16,height:16,channels:3,background:'#f03e3e'}}).png().toBuffer();
 return sharp([red,blue],{join:{animated:true}}).webp({loop:0,delay:[100,100]}).toBuffer();
}

test('measures PNG, JPEG and WebP using smart-resize/32 plus two tokens per image',async()=>{
 const pricingPolicy=await policy();
 for(const format of ['png','jpeg','webp'] as const){
  const bytes=await image(format),mime=format==='jpeg'?'image/jpeg':`image/${format}`;
  const result=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request([{type:'text',text:'证据帧'},{type:'image_url',image_url:{url:data(mime,bytes)}}])});
  assert.equal(result.fallbackReason,null);assert.equal(result.imageCount,1);assert.equal(result.visualTokenCeiling,254);
  assert.equal(result.inputTokenCeiling,result.nonImageUtf8ByteCeiling+254+WEEKLY_EXACT_PROTOCOL_TOKEN_RESERVE);
 }
});

test('counts multiple images, every Unicode byte and the frozen protocol reserve',async()=>{
 const pricingPolicy=await policy(),png=await image('png');
 const content=[{type:'text',text:'云朵泡沫🫧'},{type:'image_url',image_url:{url:data('image/png',png)}},{type:'image_url',image_url:{url:data('image/png',png)}}];
 const result=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request(content,4200)});
 assert.equal(result.fallbackReason,null);assert.equal(result.imageCount,2);assert.equal(result.visualTokenCeiling,508);
 assert.equal(result.protocolReserveTokens,8192);assert.ok(result.nonImageUtf8ByteCeiling>Buffer.byteLength('云朵泡沫🫧'));
 assert.equal(result.reservedMicros,Math.ceil(result.inputTokenCeiling*result.inputPriceCnyPerMillion+4200*result.outputPriceCnyPerMillion));
});

test('request hash is deterministic and binds every frozen request field',async()=>{
 const pricingPolicy=await policy(),body=request('same',180);
 const first=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:body});
 const again=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:body});
 const changed=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request('same!',180)});
 assert.deepEqual(first,again);assert.notEqual(first.requestBodySha256,changed.requestBodySha256);
 assert.notEqual(first.inputTokenCeiling,changed.inputTokenCeiling);assert.match(first.pricingPolicyHash,/^[a-f0-9]{64}$/);assert.match(first.measurementPolicyHash,/^[a-f0-9]{64}$/);
 assert.equal(first.measurementPolicyHash,weeklyCandidateExactMeasurementPolicyHash());
});

test('computed request ceilings select exact published tier boundaries',async()=>{
 const pricingPolicy=await policy();
 const empty=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request('')});assert.equal(empty.fallbackReason,null);
 for(const [target,inputRate] of [[32768,1],[32769,1.5],[131072,1.5],[131073,3]] as const){
  const result=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request('a'.repeat(target-empty.inputTokenCeiling))});
  assert.equal(result.inputTokenCeiling,target);assert.equal(result.inputPriceCnyPerMillion,inputRate);
 }
});

test('falls back to the accepted model ceiling and highest tier for unsupported or unsafe inputs',async()=>{
 const pricingPolicy=await policy(),png=await image('png'),huge=await image('png',32769,12),wide=await image('png',3000,12);
 const cases:Array<[string,string]>= [
  ['image_url_unsupported',request([{type:'image_url',image_url:{url:'https://example.com/a.png'}}])],
  ['image_data_invalid',request([{type:'image_url',image_url:{url:'data:image/png;base64,AAAA==='}}])],
  ['image_data_invalid',request([{type:'image_url',image_url:{url:data('image/png',png).replace(/.{8}$/,'AAAA\n==')}}])],
  ['image_mime_mismatch',request([{type:'image_url',image_url:{url:data('image/jpeg',png)}}])],
  ['image_dimensions_invalid',request([{type:'image_url',image_url:{url:data('image/png',huge)}}])],
  ['image_dimensions_invalid',request([{type:'image_url',image_url:{url:data('image/png',wide)}}])],
 ];
 for(const [reason,requestBody] of cases){
  const result=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody});
  assert.equal(result.fallbackReason,reason);assert.equal(result.inputTokenCeiling,260096);
  assert.deepEqual([result.selectedTier.maximumInputTokens,result.inputPriceCnyPerMillion,result.outputPriceCnyPerMillion],[262144,3,30]);
  assert.ok(result.reservedMicros>=Math.ceil(260096*3+result.outputTokenCeiling*30));
 }
 await assert.rejects(()=>measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:'{'}),/request_json_invalid/);
 await assert.rejects(()=>measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request('x',16385)}),/output_limit_invalid/);
 await assert.rejects(()=>measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request('x'.repeat(260000))}),/model_input_limit_exceeded/);
 for(const requestBody of [request('x',1000,{n:2}),request('x',1000,{tools:[]}),request('x',1000,{tool_choice:'auto'}),
  request('x',1000,{stream:true}),request('x',1000,{parallel_tool_calls:true}),request('x',1000,{unknown:true}),
  request('x').replace('qwen3-vl-plus','unknown-model')])
  await assert.rejects(()=>measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody}),/request_schema_unknown/);
});

test('fails closed when frozen pricing evidence is not the reviewed catalogue',async()=>{
 const pricingPolicy=structuredClone(await policy());(pricingPolicy.evidence as any).tiers=[{...pricingPolicy.evidence.tiers[0]!,inputPriceCnyPerMillion:.1},...pricingPolicy.evidence.tiers.slice(1)];
 await assert.rejects(()=>measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request('x')}),/pricing_policy_unverified/);
});

test('image count and encoded-byte abuse cannot lower the fallback reservation',async()=>{
 const pricingPolicy=await policy(),png=await image('png',32,32),part={type:'image_url',image_url:{url:data('image/png',png)}};
 const tooMany=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request(Array.from({length:101},()=>part))});
 assert.equal(tooMany.fallbackReason,'image_limit_exceeded');assert.equal(tooMany.inputTokenCeiling,260096);
 const oversized=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,
  requestBody:request([{type:'image_url',image_url:{url:data('image/png',Buffer.alloc(20*1024*1024+1,1))}}])});
 assert.equal(oversized.fallbackReason,'image_data_invalid');assert.equal(oversized.inputPriceCnyPerMillion,3);
 const animated=await animatedWebp(),multi=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,
  requestBody:request([{type:'image_url',image_url:{url:data('image/webp',animated)}}])});
 assert.equal(multi.fallbackReason,'image_dimensions_invalid');assert.equal(multi.inputTokenCeiling,260096);
});

test('property loop keeps text ceilings monotone, dimensions bounded and arithmetic safe',async()=>{
 const pricingPolicy=await policy();let seed=0x51f15e,lastVisual=0;
 for(let index=0;index<24;index++){
  seed=(seed*1664525+1013904223)>>>0;const side=32+seed%768,textLength=seed%4096;
  const bytes=await image('webp',side,side),imagePart={type:'image_url',image_url:{url:data('image/webp',bytes)}};
  const short=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request([{type:'text',text:'a'.repeat(textLength)},imagePart],6000)});
  const long=await measureWeeklyCandidateExactRequestCeiling({pricingPolicy,requestBody:request([{type:'text',text:'a'.repeat(textLength+17)},imagePart],6000)});
  assert.equal(short.fallbackReason,null);assert.equal(long.fallbackReason,null);
  assert.equal(long.inputTokenCeiling-short.inputTokenCeiling,17);assert.ok(Number.isSafeInteger(long.reservedMicros)&&long.reservedMicros>0);
  assert.ok(short.visualTokenCeiling>=66&&short.visualTokenCeiling<=2562);
  lastVisual=short.visualTokenCeiling;
 }
 assert.ok(lastVisual>0);
});
