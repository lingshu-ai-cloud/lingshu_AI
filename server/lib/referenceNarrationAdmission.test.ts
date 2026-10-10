import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {StudioPaidBudget} from './studioPaidBudget.js';import {QwenAsrService} from './qwenAsr.js';import {readReferenceNarrationAdmission} from './referenceNarrationAdmission.js';
test('actual explicit budget blocks provider; readonly status creates no ledger, reservation remains durable',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'manual-asr-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const keys=['DASHSCOPE_API_KEY','QWEN_ASR_GENERATION_ENABLED','QWEN_ASR_BASE_URL'] as const;const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));t.after(()=>{for(const key of keys){const value=original[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}});process.env.DASHSCOPE_API_KEY='controlled-test-not-real';process.env.QWEN_ASR_GENERATION_ENABLED='true';process.env.QWEN_ASR_BASE_URL='https://dashscope.aliyuncs.com/api/v1';
 const budget=new StudioPaidBudget(path.join(root,'budget'),()=>({limit:1_000_000,openingUsed:1_000_000,reserve:{heygen:1_000_000,qwen_asr:1_000_000}}));
 assert.equal(readReferenceNarrationAdmission(budget).canSubmit,false);assert.equal(fs.existsSync(path.join(root,'budget')),false);
 let calls=0;const request:typeof fetch=async()=>{calls++;throw Error('provider forbidden');};
 const service=new QwenAsrService(path.join(root,'asr'),request,id=>budget.reserve('qwen_asr',id),{automaticSubmission:false});
 await assert.rejects(service.run('tenant',Buffer.from('actual-controlled-audio'),'audio/wav',true),/预算余额不足/);assert.equal(calls,0);
 const allowed=new StudioPaidBudget(path.join(root,'allowed'),()=>({limit:2_000_000,openingUsed:0,reserve:{heygen:1_000_000,qwen_asr:1_000_000}}));assert.equal(readReferenceNarrationAdmission(allowed).canSubmit,true);await allowed.reserve('qwen_asr','same-original');await allowed.reserve('qwen_asr','same-original');assert.equal(allowed.status('qwen_asr').remainingCny,1);assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(root,'allowed/ledger.json'),'utf8')).entries).length,1);
});
