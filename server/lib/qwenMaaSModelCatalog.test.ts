import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readQwenMaaSVisionCatalog} from './qwenMaaSModelCatalog.js';

const key='test-catalog-key';
const input={endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:createHash('sha256').update(key).digest('hex'),model:'qwen3-vl-plus'};
const response=(body:unknown)=>async()=>Response.json(body);

test('MaaS catalog evidence binds exact endpoint, key digest, model and visual capability',async()=>{
 const proof=await readQwenMaaSVisionCatalog(input,{apiKey:()=>key,fetch:response({object:'list',data:[{id:'qwen3-vl-plus',input_modalities:['text','image']}]}) as typeof fetch});
 assert.ok(proof);assert.equal(proof.model,input.model);assert.equal(proof.endpoint,input.endpoint);assert.match(proof.evidenceRef,/^qwen-maas-catalog:/);
 assert.equal(await readQwenMaaSVisionCatalog({...input,credentialSha256:'0'.repeat(64)},{apiKey:()=>key,fetch:async()=>{throw Error('must not call');}}),null);
});

test('known ID-only model uses published vision capability; conflicting/unknown/absent models fail closed',async()=>{
 const inspect=async(body:unknown)=>readQwenMaaSVisionCatalog(input,{apiKey:()=>key,fetch:response(body) as typeof fetch});
 assert.ok(await inspect({object:'list',data:[{id:'qwen3-vl-plus'}]}));
 assert.equal(await readQwenMaaSVisionCatalog({...input,model:'unknown-vision-model'},{apiKey:()=>key,fetch:response({object:'list',data:[{id:'unknown-vision-model'}]}) as typeof fetch}),null);
 assert.equal(await inspect({object:'list',data:[{id:'qwen3-vl-plus',input_modalities:['text']}]}),null);
 assert.equal(await inspect({object:'list',data:[{id:'another-model',input_modalities:['image']}]}),null);
 assert.equal(await inspect({data:[{id:'qwen3-vl-plus',input_modalities:['image']}]}),null);
 assert.equal(await readQwenMaaSVisionCatalog({...input,endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1'},{apiKey:()=>key,fetch:async()=>{throw Error('must not call');}}),null);
 assert.equal(await readQwenMaaSVisionCatalog(input,{apiKey:()=>key,fetch:async()=>new Response('',{status:503})}),null);
});
