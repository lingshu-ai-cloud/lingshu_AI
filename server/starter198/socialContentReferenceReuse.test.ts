import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSocialReferenceReuseOnly, buildSocialReferenceReuseBinding } from './socialContentReferenceReuse.js';
import { socialRequestHash } from './socialContentValidation.js';
import { resolveSocialTaskReferenceScript } from './socialContentScriptResolvers.js';

const analysis = { analysisRunId:'cached-exact-run',contentSha256:'a'.repeat(64),analysisMode:'exact',analysisQuality:'video',
 gemini:{theme:'产品信息',scriptDetails15s:[{time:'0-3',purpose:'产品钩子',visual:'产品瓶特写',shot:'近景',camera:'固定镜头',dialogue:'查看产品。',confidence:.98},{time:'3-38',purpose:'产品信息',visual:'产品包装展示',shot:'近景',camera:'固定镜头',dialogue:'联系我们。',confidence:.98}]}};
const record={id:'cached-reference',tenantId:'tenant',sourceUrl:'https://example.com/original-38',duration:38,aiAnalysis:JSON.stringify(analysis)};
const input={tenantId:'tenant',themeId:'product_value' as const,verifiedContext:{companyName:null,brandName:null,productName:null,verifiedFacts:[]} as never,
 referenceSources:[{sourceId:'active-source',sourceRef:record.sourceUrl,sourceVersion:'1',createdAt:'2026-10-11T00:00:00Z'}],
 binding:{recordId:record.id,contentSha256:analysis.contentSha256,analysisId:analysis.analysisRunId,analysisHash:socialRequestHash(analysis)}};
test('pinned 38-second reference uses actual package builder and a single exact cache read without collection',async()=>{
 let reads=0;const before=JSON.stringify(record);
 const result=await resolveSocialReferenceReuseOnly(input,{readRecord:async id=>{reads++;assert.equal(id,record.id);return record;}});
 assert.equal(reads,1);assert.equal(result.referenceVideoAnalysis.durationSeconds,38);assert.equal(result.referenceVideoAnalysis.status,'ready');assert.equal(JSON.stringify(record),before);
});
test('cache, tenant, source hash, analysis run and active source drift fail explicitly without fallback',async()=>{
 for(const [changed,reason] of [[null,'cache_missing'],[{...record,tenantId:'other'},'tenant_mismatch'],[{...record,aiAnalysis:JSON.stringify({...analysis,contentSha256:'b'.repeat(64)})},'source_hash_changed'],[{...record,aiAnalysis:JSON.stringify({...analysis,analysisRunId:'new-run'})},'analysis_changed'],[{...record,sourceUrl:'https://example.com/other'},'exact_analysis_or_source_match_missing']] as const){
  let reads=0;await assert.rejects(resolveSocialReferenceReuseOnly(input,{readRecord:async()=>{reads++;return changed;}}),new RegExp(reason));assert.equal(reads,1);
 }
});
test('mutable processing metadata does not invalidate the same media and analysis run',async()=>{
 const changed={...record,aiAnalysis:JSON.stringify({...analysis,analysisQueueState:'completed',analysisWorkerAttempt:3,previewPersistedAt:'2026-10-12T00:00:00.000Z'})};
 const result=await resolveSocialReferenceReuseOnly(input,{readRecord:async()=>changed});
 assert.equal(result.referenceVideoAnalysis.durationSeconds,38);
});
test('missing source or malformed pin fails before any storage access',async()=>{
 for(const bad of [{...input,referenceSources:[]},{...input,binding:{...input.binding,analysisHash:'invalid'}}]){
  await assert.rejects(resolveSocialReferenceReuseOnly(bad,{readRecord:async()=>{throw Error('must-not-read');}}),/social_reference_reuse_gap/);
 }
});
test('normal resolver cache miss rejects visibly before legacy collector or analysis fallback',async()=>{
 let reads=0;
 await assert.rejects(resolveSocialTaskReferenceScript({...input,referenceReuse:input.binding,referenceStore:{getById:async(collection,id)=>{reads++;assert.equal(collection,'trend_videos');assert.equal(id,record.id);return null;}}}),/social_reference_reuse_gap:cache_missing/);
 assert.equal(reads,1);
});
test('normal product cache selection derives all hashes server-side from one exact snapshot',async()=>{
 let reads=0;const before=JSON.stringify(record);
 const pin=await buildSocialReferenceReuseBinding({...input,recordId:record.id,source:input.referenceSources[0]!},
  {readRecord:async id=>{reads++;assert.equal(id,record.id);return record;}});
 assert.deepEqual(pin,input.binding);assert.equal(reads,1);assert.equal(JSON.stringify(record),before);
 const changed={...record,aiAnalysis:JSON.stringify({...analysis,analysisRunId:'later-run'})};
 await assert.rejects(resolveSocialReferenceReuseOnly({...input,binding:pin},{readRecord:async()=>changed}),/analysis_changed/);
});
test('cache selection cannot pin another tenant, unrelated URL, missing analysis or synthetic record',async()=>{
 const selection={...input,recordId:record.id,source:input.referenceSources[0]!};
 for(const row of [{...record,tenantId:'other'},{...record,sourceUrl:'https://example.com/unselected'},
  {...record,aiAnalysis:'{}'},{...record,synthetic:true},{...record,aiAnalysis:JSON.stringify({...analysis,analysisMode:'summary',analysisQuality:'text'})}])
  await assert.rejects(buildSocialReferenceReuseBinding(selection,{readRecord:async()=>row}),/social_reference_reuse_gap/);
});
