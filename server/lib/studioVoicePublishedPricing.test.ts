import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialNativeVoicePrice,readNativeVoicePublishedTariff,verifyNativeVoicePublishedTariff} from './studioVoicePublishedPricing.js';
import {nativeVoiceBillableCharacters} from './studioVoiceBilling.js';
import {productionBillingAccountRef} from '../starter198/socialContentProductionBudgetRoutes.js';
const content='<h4 id="千问3-tts-flash">千问3-TTS-Flash</h4>输入单价（每万字符）<table><tr><td>qwen3-tts-flash</td><td>0.8元</td><td>不计费</td></tr></table><h4 id="新加坡">新加坡</h4><h3 id="千问asr">千问ASR</h3>按输入音频的秒数计费<table><tr><td>qwen3-asr-flash-filetrans</td><td rowspan="2">0.00022元/秒</td><td>不计费</td></tr><tr><td>qwen3-asr-flash</td><td>试用36,000秒</td></tr></table><h4 id="新加坡">新加坡</h4>';
const body='window.__ICE_PAGE_PROPS__='+JSON.stringify({docDetailData:{storeData:{data:{alias:'/model-studio/model-pricing',website:'cn',language:'zh',content}}}})+';';
test('official mainland native prices and weighted actual characters exclude trial and overseas',()=>{
 assert.equal(nativeVoiceBillableCharacters('中A文123'),8);
 assert.equal(nativeVoiceBillableCharacters('你好。'),5);
 assert.equal(parseOfficialNativeVoicePrice(body,'qwen3-tts-flash')?.priceCny,.8);
 assert.equal(parseOfficialNativeVoicePrice(body,'qwen3-asr-flash')?.priceCny,.00022);
 assert.equal(parseOfficialNativeVoicePrice(body.replace('"website":"cn"','"website":"en"'),'qwen3-tts-flash'),null);
});
test('native public quote retains actual account/document evidence and rejects tampering',async()=>{
 const binding={baseUrl:'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',credentialSha256:'a'.repeat(64)};
 const intent={operationId:'test',provider:'qwen',model:'qwen3-tts-flash',stage:'tts',accountRef:productionBillingAccountRef('qwen',binding.baseUrl,binding.credentialSha256),shotId:null,inputContractHash:'b'.repeat(64),maximumUnits:{characters:100}};
 const tariff=await readNativeVoicePublishedTariff(intent,{readBinding:()=>binding,fetchOfficial:async url=>({url,status:200,body})});
 assert.ok(tariff);assert.equal(verifyNativeVoicePublishedTariff(tariff),true);
 assert.equal(verifyNativeVoicePublishedTariff({...tariff,meters:{characters:{priceCny:.01,unitsPerPrice:10000,minimumUnits:0,increment:1}}}),false);
 assert.equal(await readNativeVoicePublishedTariff({...intent,accountRef:'different'},{readBinding:()=>binding,fetchOfficial:async()=>{throw Error('must not fetch');}}),null);
});
