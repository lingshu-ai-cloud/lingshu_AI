import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocialInsightService, insightConfig } from './service.js';
import type { DataStore } from '../storage/datastore.js';
import { snapshotReport } from './report.js';
import { isSocialInsightReport } from '../../shared/socialInsightReport.js';
const requestId = '125e4567-e89b-42d3-a456-426614174000';
function fixture() {
  const rows = new Map<string, unknown>();
  const store = { getById: async (_: string, id: string) => rows.get(id) || null,
    create: async (_: string, data: {id: string}) => { if (rows.has(data.id)) return null; rows.set(data.id, structuredClone(data)); return structuredClone(data); },
    update: async (_: string, id: string, data: unknown) => { rows.set(id, structuredClone(data)); return true; },
  } as unknown as DataStore;
  return {store, rows};
}
const now = () => new Date('2026-10-28T10:00:00Z');
const config = () => ({actorId:'clockworks~tiktok-scraper', token:'fixture', maxUsd:.1, datasetReadMaxUsd:.01});
const video = {id:'1234567890123456789',webVideoUrl:'https://www.tiktok.com/@test/video/1234567890123456789',text:'skin care',createTimeISO:'2026-10-28T08:00:00Z',videoMeta:{duration:20},playCount:0,diggCount:12};
test('unconfigured is explicitly blocked and makes no provider request; tenant isolation and idempotency', async () => {
  const f = fixture(); let calls = 0;
  const service = createSocialInsightService({store:f.store, config:()=>null, collect:async()=>{calls++;return[];}, now});
  const a = await service.create('tenant-a','skin care',requestId);
  assert.equal(a.status,'blocked'); assert.equal(calls,0);
  assert.deepEqual(await service.create('tenant-a','skin care',requestId),a);
  assert.equal(await service.get('tenant-b',a.id),null);
  assert.notEqual((await service.create('tenant-b','skin care',requestId)).id,a.id);
  await assert.rejects(service.create('tenant-a','different',requestId),/conflict/);
});
test('confirmed operation starts once, retains zero and missing metrics, program charts and grounded analysis', async () => {
  const f=fixture(); const scheduled:Array<()=>Promise<void>>=[];let calls=0;
  const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>scheduled.push(fn),collect:async input=>{
    calls++;await input.permit.beforeSubmit({actorId:config().actorId,requestHash:'hash',maxTotalChargeUsd:.1});
    await input.permit.recordRun({runId:'run1',datasetId:'dataset1',maxTotalChargeUsd:.1});
    await input.permit.recordTerminal({runId:'run1',status:'SUCCEEDED',usageTotalUsd:.02});return[video];
  },analyze:async()=>JSON.stringify({analysisMarkdown:'[样本](https://www.tiktok.com/@test/video/1234567890123456789)配文提及护肤。',assignments:[{videoId:video.id,category:'b2c',confidence:'low',reason:'消费护肤表达',merchantHelp:'建议转为采购证据选题',contentAngle:'建议拍供应质控流程',evidenceNeeded:['需提供真实质控文件并核验']}],groups:[{category:'b2b',summary:'无样本',recommendations:[]},{category:'b2c',summary:'消费表达待核验',recommendations:['验证采购关注点']}]})});
  const job=await service.create('a','skin care',requestId);
  await service.create('a','skin care',requestId);assert.equal(scheduled.length,1);await scheduled[0]();
  const result=await service.get('a',job.id);assert.equal(result?.status,'succeeded');assert.equal(calls,1);
  assert.equal(result?.report?.videos[0].views,0);assert.equal(result?.report?.videos[0].comments,null);
  assert.equal(result?.report?.charts[0].data[0].value,0);assert.equal(isSocialInsightReport(result?.report),true);
});
test('unknown paid submission is persisted and never replayed by a duplicate request',async()=>{
  const f=fixture();const scheduled:Array<()=>Promise<void>>=[];let calls=0;
  const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>scheduled.push(fn),collect:async input=>{
    calls++;await input.permit.beforeSubmit({actorId:config().actorId,requestHash:'hash',maxTotalChargeUsd:.1});throw Error('apify_paid_observation_timeout');}});
  const job=await service.create('a','skin care',requestId);await scheduled[0]();
  assert.equal((await service.get('a',job.id))?.status,'unknown');await service.create('a','skin care',requestId);assert.equal(calls,1);assert.equal(scheduled.length,1);
});
test('model failure preserves real sample as partial, no data avoids model',async()=>{
 const f=fixture();const tasks:Array<()=>Promise<void>>=[];let model=0;
 const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn),collect:async()=>[video],analyze:async()=>{model++;throw Error('model unavailable');}});
 const job=await service.create('a','skin care',requestId);await tasks[0]();assert.equal((await service.get('a',job.id))?.status,'partial');assert.equal(model,1);
 const empty=createSocialInsightService({store:fixture().store,config,now,schedule:fn=>tasks.push(fn),collect:async()=>[],analyze:async()=>{throw Error('must not call');}});
 const emptyJob=await empty.create('a','keyword',requestId);await tasks[1]();assert.equal((await empty.get('a',emptyJob.id))?.status,'empty');
});
test('Shanghai natural days, deduplication, invalid dates and missing metrics remain honest',()=>{
 const report=snapshotReport('skin',[video,video,{...video,webVideoUrl:'https://www.tiktok.com/@test/video/2234567890123456789',createTimeISO:'2026-10-21T15:59:59Z'},{...video,createTimeISO:'bad'}],now());
 assert.deepEqual(report.period,{from:'2026-10-22',to:'2026-10-28',timeZone:'Asia/Shanghai'});assert.equal(report.sampleCount,1);
 assert.equal(isSocialInsightReport({...report,videos:[null]}),false);assert.equal(isSocialInsightReport({...report,charts:[null]}),false);
});
test('concurrent identical confirmations create one durable owner and one scheduled operation',async()=>{
 const f=fixture();const tasks:Array<()=>Promise<void>>=[];
 const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn)});
 const [a,b]=await Promise.all([service.create('tenant','skin care',requestId),service.create('tenant','skin care',requestId)]);
 assert.equal(a.id,b.id);assert.equal(tasks.length,1);assert.equal(f.rows.size,1);
});
test('scope rejection before execution persists blocked immediately and never reaches supplier',async()=>{
 const f=fixture();const tasks:Array<()=>Promise<void>>=[];let calls=0;
 const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn),
  executeScope:async()=>{throw Error('scope not enabled');},collect:async()=>{calls++;return[];}});
 const job=await service.create('tenant','skin care',requestId);await tasks[0]();
 const result=await service.get('tenant',job.id);
 assert.equal(result?.status,'blocked');assert.equal(result?.stage,'blocked');assert.equal(result?.error?.code,'social_insight_scope_rejected');assert.equal(calls,0);
 await service.create('tenant','skin care',requestId);assert.equal(tasks.length,1);
});
test('scope interruption after paid submission preserves unknown and never schedules replay',async()=>{
 const f=fixture();const tasks:Array<()=>Promise<void>>=[];let calls=0;
 const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn),
  executeScope:async(_config,fn)=>{await fn();throw Error('scope interrupted');},collect:async input=>{
   calls++;await input.permit.beforeSubmit({actorId:config().actorId,requestHash:'hash',maxTotalChargeUsd:.1});throw Error('apify_paid_observation_timeout');}});
 const job=await service.create('tenant','skin care',requestId);await tasks[0]();
 const result=await service.get('tenant',job.id);assert.equal(result?.status,'unknown');assert.equal(result?.error?.code,'social_insight_scope_interrupted');
 await service.create('tenant','skin care',requestId);assert.equal(tasks.length,1);assert.equal(calls,1);
});

test('configuration uses existing Qwen credential file fallback without exporting the secret',()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-insight-key-'));
 try {
  const keyFile=join(dir,'fixture.key');writeFileSync(keyFile,'fixture-file-key\n');
  const env={SOCIAL_INSIGHTS_ENABLED:'1',SOCIAL_INSIGHTS_APIFY_ACTOR_ID:'clockworks~tiktok-scraper',SOCIAL_INSIGHTS_APIFY_MAX_USD:'.1',SOCIAL_INSIGHTS_APIFY_DATASET_MAX_USD:'.01',APIFY_TOKEN:'fixture-apify-token',DASHSCOPE_API_KEY_FILE:keyFile};
  const ready=insightConfig(env);assert.equal(ready?.actorId,'clockworks~tiktok-scraper');
  assert.equal(JSON.stringify(ready).includes('fixture-file-key'),false);
  assert.equal(insightConfig({...env,DASHSCOPE_API_KEY_FILE:join(dir,'missing')}),null);
  assert.notEqual(insightConfig({...env,DASHSCOPE_API_KEY:'fixture-env-key',DASHSCOPE_API_KEY_FILE:join(dir,'missing')}),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('explicit durable Apify monthly-limit refusal is blocked; unknown response stays unknown; read repairs status without supplier retry',async()=>{
 const f=fixture();const tasks:Array<()=>Promise<void>>=[];let calls=0;
 const body=JSON.stringify({error:{type:'platform-feature-disabled',message:'Monthly usage hard limit exceeded'}});
 const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn),collect:async input=>{
  calls++;await input.permit.beforeSubmit({actorId:config().actorId,requestHash:'hash',maxTotalChargeUsd:.1});
  await input.permit.persistRawReceipt!({phase:'actor_submit',actorId:config().actorId,operationId:input.permit.operationId,requestHash:'hash',httpStatus:403,responseBody:body});throw Error('apify_paid_http_403');}});
 const job=await service.create('a','OEM',requestId);await tasks[0]();
 let result=await service.get('a',job.id);assert.equal(result?.status,'blocked');assert.equal(result?.error?.code,'social_insight_apify_monthly_limit');assert.equal(result?.report,undefined);assert.equal(calls,1);
 const stored=f.rows.get(job.id) as {phase:string;job:{status:string;error:unknown};receipts:unknown[]};assert.equal(stored.phase,'submitted_unknown');assert.equal(stored.receipts.length,1);
 stored.job.status='unknown';stored.job.error={code:'legacy'};f.rows.set(job.id,stored);
 result=await service.get('a',job.id);assert.equal(result?.status,'blocked');assert.equal(calls,1);assert.equal((f.rows.get(job.id) as typeof stored).receipts.length,1);
 await service.create('a','OEM',requestId);assert.equal(tasks.length,1);assert.equal(calls,1);
});


test('country proxy is opt-in US only and applied only to the social insight Actor input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-proxy-'));try{
  const keyFile=join(dir,'key');writeFileSync(keyFile,'fixture');
  const base={SOCIAL_INSIGHTS_ENABLED:'1',SOCIAL_INSIGHTS_APIFY_ACTOR_ID:'clockworks~tiktok-scraper',SOCIAL_INSIGHTS_APIFY_MAX_USD:'.5',SOCIAL_INSIGHTS_APIFY_DATASET_MAX_USD:'.05',APIFY_TOKEN:'fixture',DASHSCOPE_API_KEY_FILE:keyFile};
  assert.equal(insightConfig(base)?.proxyCountry,undefined);assert.equal(insightConfig({...base,SOCIAL_INSIGHTS_APIFY_PROXY_COUNTRY:'CN'}),null);assert.equal(insightConfig({...base,SOCIAL_INSIGHTS_APIFY_MAX_USD:'.51'}),null);assert.equal(insightConfig({...base,SOCIAL_INSIGHTS_APIFY_DATASET_MAX_USD:'.051'}),null);
  const config=insightConfig({...base,SOCIAL_INSIGHTS_APIFY_PROXY_COUNTRY:'US'});assert.equal(config?.proxyCountry,'US');
  const f=fixture(),tasks:Array<()=>Promise<void>>=[];let input:Record<string,unknown>|undefined;
  const service=createSocialInsightService({store:f.store,config:()=>config,now,schedule:fn=>tasks.push(fn),collect:async x=>{input=x.actorInput;return[];}});
  await service.create('tenant','sunscreen',requestId);await tasks[0]();assert.equal(input?.proxyCountryCode,'US');
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('optional search filter experiment preserves post dates and the seven-day local filter',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-date-filter-'));try {
  const keyFile=join(dir,'key');writeFileSync(keyFile,'fixture');
  const base={SOCIAL_INSIGHTS_ENABLED:'1',SOCIAL_INSIGHTS_APIFY_ACTOR_ID:'clockworks~tiktok-scraper',SOCIAL_INSIGHTS_APIFY_MAX_USD:'.5',SOCIAL_INSIGHTS_APIFY_DATASET_MAX_USD:'.05',APIFY_TOKEN:'fixture',DASHSCOPE_API_KEY_FILE:keyFile,SOCIAL_INSIGHTS_APIFY_PROXY_COUNTRY:'US'};
  assert.equal(insightConfig(base)?.omitSearchDateFilter,true);assert.equal(insightConfig({...base,SOCIAL_INSIGHTS_APIFY_SEARCH_DATE_FILTER:'1'})?.omitSearchDateFilter,false);assert.equal(insightConfig({...base,SOCIAL_INSIGHTS_APIFY_SEARCH_DATE_FILTER:'bad'}),null);
  const config=insightConfig({...base,SOCIAL_INSIGHTS_APIFY_SEARCH_DATE_FILTER:'0'});assert.equal(config?.omitSearchDateFilter,true);
  const f=fixture(),tasks:Array<()=>Promise<void>>=[];let input:Record<string,unknown>|undefined;
  const service=createSocialInsightService({store:f.store,config:()=>config,now,schedule:fn=>tasks.push(fn),collect:async x=>{input=x.actorInput;return[];}});
  await service.create('tenant','sunscreen',requestId);await tasks[0]();assert.equal(input?.proxyCountryCode,'US');assert.equal(input?.resultsPerPage,7);assert.deepEqual(input?.searchQueries,['sunscreen','sunscreen OEM','sunscreen private label','sunscreen manufacturer']);assert.equal(input?.videoSearchDateFilter,undefined);assert.equal(input?.oldestPostDateUnified,'2026-10-22');assert.equal(input?.newestPostDate,'2026-10-28');
  assert.equal(snapshotReport('sunscreen',[{...video,createTimeISO:'2026-10-20T00:00:00Z'}],now()).sampleCount,0);
 } finally {rmSync(dir,{recursive:true,force:true});}
});


test('social scene defaults to no Actor search-date filter, explicitly enabled keeps PAST_WEEK',async()=>{
 const f=fixture(),tasks:Array<()=>Promise<void>>=[],inputs:Array<Record<string,unknown>>=[];
 const collect:NonNullable<Parameters<typeof createSocialInsightService>[0]['collect']>=async x=>{inputs.push(x.actorInput);return[];};
 const normal=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn),collect});
 await normal.create('tenant','sunscreen',requestId);await tasks.shift()!();
 const explicit=createSocialInsightService({store:f.store,config:()=>({...config(),omitSearchDateFilter:false}),now,schedule:fn=>tasks.push(fn),collect});
 await explicit.create('tenant','sunscreen','225e4567-e89b-42d3-a456-426614174000');await tasks.shift()!();
 assert.equal(inputs[0].videoSearchDateFilter,undefined);assert.equal(inputs[1].videoSearchDateFilter,'PAST_WEEK');
 for (const input of inputs) { assert.equal(input.oldestPostDateUnified,'2026-10-22');assert.equal(input.newestPostDate,'2026-10-28'); }
});


test('multi-query results preserve verified query provenance, deduplicate video and never infer missing query',()=>{
 const rows=[{...video,searchQuery:'skin care'}, {...video,searchQuery:'skin care OEM'}, {...video,id:'2234567890123456789',webVideoUrl:'https://www.tiktok.com/@test/video/2234567890123456789',searchQuery:'unapproved'}, {...video,id:'3234567890123456789',webVideoUrl:'https://www.tiktok.com/@test/video/3234567890123456789',searchQuery:undefined}];
 const result=snapshotReport('skin care',rows,now()); assert.equal(result.sampleCount,3);assert.deepEqual(result.videos[0].searchQueries,['skin care','skin care OEM']);assert.equal(result.videos[1].searchQueries,undefined);assert.equal(result.videos[2].searchQueries,undefined);
});
test('confirmed keyword over 80 characters fails without scheduling a provider call',async()=>{const f=fixture(),tasks:Array<()=>Promise<void>>=[];const service=createSocialInsightService({store:f.store,config,now,schedule:fn=>tasks.push(fn)});await assert.rejects(service.create('tenant','x'.repeat(81),requestId),/keyword_invalid/);assert.equal(tasks.length,0);});
