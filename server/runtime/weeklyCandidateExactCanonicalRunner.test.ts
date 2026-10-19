import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {store as routeStore} from '../storage/index.js';
import {withExactQwenScope} from '../agents/exactQwenScope.js';
import {getQwenProviderBinding} from '../agents/qwen.js';
import {createWeeklyCandidateExactCanonicalRunner,prepareDeployedWeeklyCandidateExactCanonicalPorts} from './weeklyCandidateExactCanonicalRunner.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';

test('canonical exact runner accepts only scoped same-run MP4 bytes and leaves no temporary copy',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-exact-runner-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'tenants/tenant/reference-videos/candidate.mp4');await fs.mkdir(path.dirname(file),{recursive:true});
 assert(ffmpeg);await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=80x80:rate=4','-t','1','-c:v','libx264','-pix_fmt','yuv420p',file]);
 const bytes=await fs.readFile(file),mediaSha=createHash('sha256').update(bytes).digest('hex');
 const record={id:'candidate',tenantId:'tenant',sourceUrl:'https://www.tiktok.com/@factory/video/1234567890123456789',videoFileId:'tenants/tenant/reference-videos/candidate.mp4',aiAnalysis:JSON.stringify({contentSha256:mediaSha})};
 const job={jobId:'job',tenantId:'tenant',authority:{scopeId:'scope',scopeVersion:1}} as WeeklyPreproductionJob;
 const run={runId:'run',discoveryScopeId:'scope',discoveryScopeVersion:1} as SocialInspirationCollectionRun;
 const oldGet=routeStore.getById,oldKey=process.env.DASHSCOPE_API_KEY,oldUrl=process.env.DASHSCOPE_BASE_URL;
 const recordFile=path.join(root,'candidate-record.json');
 await fs.writeFile(recordFile,JSON.stringify(record));
 routeStore.getById=(async(_collection:string,id:string)=>id===record.id?JSON.parse(await fs.readFile(recordFile,'utf8')):null) as typeof routeStore.getById;
 process.env.DASHSCOPE_API_KEY='no-network-test-only';process.env.DASHSCOPE_BASE_URL='https://maas.qianwenaiapi.com/compatible-mode/v1';
 t.after(()=>{routeStore.getById=oldGet;if(oldKey===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=oldKey;
  if(oldUrl===undefined)delete process.env.DASHSCOPE_BASE_URL;else process.env.DASHSCOPE_BASE_URL=oldUrl;});
 let calls=0,temporary='';
 const execute=(async(_record:unknown,operationId:string,localMedia:string)=>{calls++;assert.equal(operationId,'original-op');temporary=localMedia;
  assert.notEqual(localMedia,file);assert.deepEqual(await fs.readFile(localMedia),bytes);}) as NonNullable<Parameters<typeof createWeeklyCandidateExactCanonicalRunner>[0]['execute']>;
 const runner=createWeeklyCandidateExactCanonicalRunner({store:routeStore,mediaRoot:root,execute});
 const args={job,run,record,operationId:'original-op'};
 await assert.rejects(runner(args),/paid_scope_required/);
 const binding=getQwenProviderBinding();
 await withExactQwenScope({model:'qwen3-vl-plus',configurationHash:'c'.repeat(64),endpoint:binding.baseUrl,credentialDigest:binding.credentialSha256,
  paidGuardRequired:true,beforeProviderRequest:async()=>{}},()=>runner(args));
 assert.equal(calls,1);await assert.rejects(fs.stat(temporary),/ENOENT/);
 assert.deepEqual(await fs.readFile(file),bytes);
 // A disk-backed candidate can receive normal discovery display updates
 // between its formal claim and execution. Reconstructed runners use the same
 // immutable source/media/analysis binding, not the mutable whole row.
 await fs.writeFile(recordFile,JSON.stringify({...record,title:'new display title',viewCount:2345,likeCount:23}));
 await withExactQwenScope({model:'qwen3-vl-plus',configurationHash:'c'.repeat(64),endpoint:binding.baseUrl,credentialDigest:binding.credentialSha256,
  paidGuardRequired:true,beforeProviderRequest:async()=>{}},()=>createWeeklyCandidateExactCanonicalRunner({store:routeStore,mediaRoot:root,execute})(args));
 assert.equal(calls,2);
 await withExactQwenScope({model:'qwen3-vl-plus',configurationHash:'c'.repeat(64),endpoint:binding.baseUrl,credentialDigest:binding.credentialSha256,
  paidGuardRequired:true,beforeProviderRequest:async()=>{}},async()=>{
   await assert.rejects(runner({...args,record:{...record,tenantId:'other'}}),/scope_changed/);
   await assert.rejects(runner({...args,record:{...record,sourceUrl:'https://changed.example/video'}}),/record_changed/);
   await fs.writeFile(recordFile,JSON.stringify({...record,aiAnalysis:JSON.stringify({contentSha256:mediaSha,changed:'different analysis'})}));
   await assert.rejects(runner(args),/record_changed/);
   await fs.writeFile(recordFile,JSON.stringify(record));
   await assert.rejects(createWeeklyCandidateExactCanonicalRunner({store:{...routeStore},mediaRoot:root,execute})(args),/store_mismatch/);
   await fs.appendFile(file,'drift');await assert.rejects(runner(args),/canonical_media_required/);
  });
 assert.equal(calls,2);
 const oldLedger=process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;
 delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;
 try{assert.throws(()=>prepareDeployedWeeklyCandidateExactCanonicalPorts({store:routeStore,mediaRoot:root,job,run,configurationHash:'c'.repeat(64),
  authorityReader:{read:async()=>null,isRevoked:async()=>true,trustedIssuers:[]},
  originalReaders:{readOriginalSupplierResponse:async()=>null,readOriginalBillingOutcome:async()=>null}}),/deployed_ledger_root_required/);}
 finally{if(oldLedger===undefined)delete process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT;else process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT=oldLedger;}
});
