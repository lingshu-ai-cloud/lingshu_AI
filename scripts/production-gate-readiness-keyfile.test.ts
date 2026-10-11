import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runtimeCapabilities,sentenceReplicationReadiness} from '../server/runtime/readiness';
import {dashscopeApiKey} from '../server/agents/qwen';

test('production Qwen readiness accepts the same readable key-file contract as the actual Qwen client',()=>{
 const original={...process.env};const dir=fs.mkdtempSync(path.join(os.tmpdir(),'production-readiness-key-'));
 try{
  const file=path.join(dir,'credential');fs.writeFileSync(file,'isolated-fixture-key',{mode:0o600});
  process.env.NODE_ENV='production';process.env.OVERSEAS_LLM_BACKEND='qwen';delete process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY_FILE=file;
  // No OpenAI client is constructed and no supplier request is sent.
  assert.equal(Boolean(dashscopeApiKey()),true);
  assert.equal(runtimeCapabilities('web').text_generation.ready,true,'readiness rejects valid key file accepted by real Qwen client');
  assert.equal(runtimeCapabilities('web').qwen_generation.ready,true);
  process.env.DIGITAL_HUMAN_SEMANTIC_QA_ENABLED='true';process.env.QWEN_DIGITAL_HUMAN_QA_MODEL='test-model';
  process.env.DIGITAL_HUMAN_VISUAL_QA_PYTHON='fixture-path';process.env.DIGITAL_HUMAN_SYNCNET_QA_ENABLED='true';process.env.DIGITAL_HUMAN_SYNCNET_QA_PYTHON='fixture-path';process.env.DIGITAL_HUMAN_SYNCNET_DIR='fixture-path';
  assert.equal(runtimeCapabilities('web').digital_human_auto_release.ready,true);
  for(const bad of [path.join(dir,'missing'),dir,file]){
   if(bad===file)fs.writeFileSync(file,' \n ');
   process.env.DASHSCOPE_API_KEY_FILE=bad;
   assert.equal(runtimeCapabilities('web').text_generation.ready,false);
   assert.equal(runtimeCapabilities('web').qwen_generation.ready,false);
   assert.equal(runtimeCapabilities('web').digital_human_auto_release.ready,false);
   assert(sentenceReplicationReadiness(process.env).missing.some(name=>name.includes('独立语义质检')));
  }
  process.env.DASHSCOPE_API_KEY='isolated-env-key';process.env.DASHSCOPE_API_KEY_FILE=dir;
  assert.equal(Boolean(dashscopeApiKey()),true,'environment credential takes precedence over invalid file');
  assert.equal(runtimeCapabilities('web').text_generation.ready,true);
  assert.equal(runtimeCapabilities('web').qwen_generation.ready,true);
  assert.equal(runtimeCapabilities('web').digital_human_auto_release.ready,true);
  assert.equal(sentenceReplicationReadiness(process.env).missing.some(name=>name.includes('独立语义质检')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});

test('offline audit fails closed on unknown required capability and never serializes credential values',()=>{
 const secret='isolated-sensitive-sentinel';
 const result=spawnSync('pnpm',['exec','tsx','scripts/production-gate-readiness-audit.ts'],{encoding:'utf8',env:{...process.env,REQUIRED_CAPABILITIES:secret,DASHSCOPE_API_KEY:secret,HEYGEN_API_KEY:secret},timeout:15000});
 assert.equal(result.status,0);
 assert.equal(result.stdout.includes(secret),false);
 const report=JSON.parse(result.stdout);assert.equal(report.ready,false);assert.equal(report.configurationReady,false);assert.equal(report.unknownRequiredCount,1);assert.deepEqual(report.issues,['unknown_required_capability_redacted']);
});
