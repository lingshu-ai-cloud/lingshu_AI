import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ffmpegStatic from 'ffmpeg-static';
import type {DataStore,Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {mappingReceiptId} from '../socialDiscovery/apifyRunKvMappingReceipt.js';
import {apifyTokenFingerprint,APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME} from '../socialDiscovery/apifyTokenFingerprint.js';
import {advanceWeeklyCandidateCanonicalMedia,createStoredWeeklyRunKvBindingReader,WEEKLY_CANDIDATE_CANONICAL_MEDIA_OPERATIONS,WEEKLY_CANDIDATE_CANONICAL_MEDIA_READ_RECEIPTS} from './weeklyCandidateCanonicalMedia.js';

const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function store():DataStore{
 const tables=new Map<string,Map<string,Record_>>();const table=(c:string)=>{let t=tables.get(c);if(!t){t=new Map();tables.set(c,t);}return t;};
 return {supportsAtomicCompareAndSwap:()=>true,getById:async(c:string,id:string)=>structuredClone(table(c).get(id)??null),create:async(c:string,row:Record<string,unknown>)=>{if(table(c).has(String(row.id)))return null;table(c).set(String(row.id),structuredClone(row as Record_));return structuredClone(row as Record_);},update:async()=>false,compareAndSwap:async(c:string,id:string,expected:Record<string,unknown>,data:Record<string,unknown>)=>{const row=table(c).get(id);if(!row||Object.entries(expected).some(([k,v])=>row[k]!==v))return false;table(c).set(id,{...row,...data});return true;},delete:async()=>false,list:async(c:string,query?:{where?:Record<string,string|number|boolean>})=>{const items=[...table(c).values()].filter(row=>Object.entries(query?.where??{}).every(([k,v])=>row[k]===v));return {items:structuredClone(items),totalItems:items.length,totalPages:items.length?1:0,page:1,perPage:100};}} as unknown as DataStore;
}
async function fixture(t:test.TestContext,original=false){
 const mediaRoot=await fs.mkdtemp(path.join(os.tmpdir(),'canonical-media-'));t.after(()=>fs.rm(mediaRoot,{recursive:true,force:true}));
 const source=path.join(mediaRoot,'source.mp4');execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x288:r=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-y',source]);
 const bytes=await fs.readFile(source),storeInstance=store();
 const job={tenantId:'tenant123',programId:'program123',packageId:'package123',packageVersion:7,jobId:'job12345',authority:{scopeId:'scope12345',scopeVersion:3}};
 const run={id:'runrow123',tenant_id:job.tenantId,runId:original?'weekly_discovery_123':'RUNabc123',discoveryScopeId:'scope12345',discoveryScopeVersion:3,
  ...(original?{scopeSnapshot:{weeklyProducer:{key:'weekly-preproduction:fixture',originalDatasetProviderRunId:'RUNabc123',originalDatasetId:'DATAabc123',originalDatasetDigest:'a'.repeat(64),originalDatasetCandidateIds:['candidate123']}}}:{})};
 const record={id:'candidate123',tenantId:'tenant123',platform:'tiktok',sourceUrl:'https://www.tiktok.com/@factory/video/7533731959172861206',videoFileId:'',aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{runId:run.runId,scopeId:'scope12345',scopeVersion:3,mode:'account',queryRef:'https://www.tiktok.com/@factory',...(original?{weeklyOriginalAccountCollection:{originalRunKey:'weekly-preproduction:fixture',accountUrl:'https://www.tiktok.com/@factory',actorInputSha256:'b'.repeat(64)}}:{})}]})};
 const binding={tenantId:job.tenantId,packageId:job.packageId,packageVersion:job.packageVersion,jobId:job.jobId,runId:original?'RUNabc123':run.runId,datasetId:'DATAabc123',defaultKeyValueStoreId:'KVabc123',datasetVideoId:'7533731959172861206',recordKey:'video.mp4',mappingReceiptId:''};
 const keys=generateKeyPairSync('ed25519');const statement={kind:'apify-run-kv-mapping-human-review.v1' as const,issuerId:'independent-reviewer',keyId:'key-1',reviewerId:'auditor',submittedBy:'uploader',...binding,datasetOffset:0,runGetSha256:'a'.repeat(64),datasetItemGetSha256:'b'.repeat(64),runKvKeysGetSha256:'c'.repeat(64),mediaSha256:hash(bytes),mediaByteLength:bytes.length,reviewedAt:'2020-01-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z'};
 const signed={statement,signatureBase64url:sign(null,Buffer.from(JSON.stringify(statement)),keys.privateKey).toString('base64url')};binding.mappingReceiptId=mappingReceiptId(signed);
 const authorities=[{issuerId:statement.issuerId,keyId:statement.keyId,reviewerId:statement.reviewerId,tenantId:job.tenantId,publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}).toString()}];
 await storeInstance.create('trend_videos',record);await storeInstance.create('social_discovery_runs',run);
 await storeInstance.create('social_apify_run_kv_mapping_receipts',{id:binding.mappingReceiptId,tenant_id:job.tenantId,content_hash:hash(JSON.stringify(signed)),payload:signed});
 return {mediaRoot,bytes,store:storeInstance,job,run,record,binding,authorities};
}
test('no independent KV permit means blocked with zero GET and no paid operation',async t=>{
 const f=await fixture(t);let reads=0;
 const common={store:f.store,job:f.job as any,run:f.run as any,record:f.record,mediaRoot:f.mediaRoot,binding:f.binding};
 assert.equal((await advanceWeeklyCandidateCanonicalMedia(common)).code,'weekly_postanalysis_canonical_media_permit_required');
 const ports={token:'fixture-token',mappingAuthorities:f.authorities,isMappingRevoked:async()=>false,readPermit:async()=>null,readSameRun:async()=>{reads++;throw Error('must not read');}};
 assert.equal((await advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any})).code,'weekly_postanalysis_canonical_media_permit_required');
 assert.equal(reads,0);assert.equal((await f.store.list(WEEKLY_CANDIDATE_CANONICAL_MEDIA_OPERATIONS)).totalItems,0);
 const legacyRaw={...ports,readPermit:async(scope:any)=>({permitId:'legacy-raw',ledgerOperationId:'kv-ledger-op',ledgerOutcomeHash:'a'.repeat(64),tokenFingerprint:hash('fixture-token'),scopeHash:socialRequestHash(scope),kind:'apify_same_run_kv_get',status:'authorized'})};
 await assert.rejects(advanceWeeklyCandidateCanonicalMedia({...common,ports:legacyRaw as any}),/permit_invalid/,'a new operation cannot issue an unversioned raw-digest permit');
 assert.equal((await f.store.list(WEEKLY_CANDIDATE_CANONICAL_MEDIA_OPERATIONS)).totalItems,0);
});
test('original discovery run binds a different Apify run and requires its KV wallet before any paid claim',async t=>{
 const f=await fixture(t,true);let permitReads=0,providerReads=0;
 const ports={token:'fixture-token',mappingAuthorities:f.authorities,isMappingRevoked:async()=>false,
  readPermit:async()=>{permitReads++;return null;},assertPaidRead:async()=>{throw Error('no paid read');},readSameRun:async()=>{providerReads++;throw Error('no provider read');}};
 const input={store:f.store,job:f.job as any,run:f.run as any,record:f.record,mediaRoot:f.mediaRoot,binding:f.binding,ports:ports as any};
 assert.equal((await advanceWeeklyCandidateCanonicalMedia(input)).code,'weekly_postanalysis_original_kv_wallet_required');
 assert.equal(permitReads,0);assert.equal(providerReads,0);
 assert.equal((await f.store.list(WEEKLY_CANDIDATE_CANONICAL_MEDIA_OPERATIONS)).totalItems,0);
 await assert.rejects(advanceWeeklyCandidateCanonicalMedia({...input,binding:{...f.binding,runId:'WRONGrun123'}}),/lineage_invalid/);
 assert.equal((await advanceWeeklyCandidateCanonicalMedia({...input,ports:{...ports,assertOriginalKvWalletReady:async()=>true} as any})).code,'weekly_postanalysis_canonical_media_permit_required');
 assert.equal(permitReads,1);assert.equal(providerReads,0);
});
test('default read-only adapter reconnects imported candidate to its one stored signed mapping',async t=>{
 const f=await fixture(t,true),read=createStoredWeeklyRunKvBindingReader(f.store);
 assert.deepEqual(await read(f.record.id),f.binding);
 await f.store.create('social_apify_run_kv_mapping_receipts',{id:'duplicate-map-1',tenant_id:f.job.tenantId,payload:(await f.store.getById<Record_>('social_apify_run_kv_mapping_receipts',f.binding.mappingReceiptId))!.payload});
 assert.equal(await read(f.record.id),null,'ambiguous mappings cannot be selected');
 assert.equal(await read('missing-candidate'),null);
});
test('original Dataset direct media binds by video id and canonicalizes without a KV permit',async t=>{
 const f=await fixture(t,true),stageDir=path.join(f.mediaRoot,'stage');await fs.mkdir(stageDir);const filePath=path.join(stageDir,'7533731959172861206.mp4'),receiptPath=path.join(stageDir,'7533731959172861206.json'),sourceUrlSha256='c'.repeat(64),contentSha256=hash(f.bytes);await fs.writeFile(filePath,f.bytes);
 const staged={videoId:'7533731959172861206',datasetId:'DATAabc123',providerRunId:'RUNabc123',sourceUrlSha256,contentSha256,byteLength:f.bytes.length,filePath,receiptPath};await fs.writeFile(receiptPath,JSON.stringify(staged));
 const producer={...(f.run as any).scopeSnapshot.weeklyProducer,jobId:f.job.jobId,packageId:f.job.packageId,packageVersion:f.job.packageVersion,originalDatasetDirectMedia:{'7533731959172861206':{...staged}}};const run={...f.run,id:'directrunrow',runId:'weekly_direct_1',scopeSnapshot:{weeklyProducer:producer}};const record={...f.record,id:'candidate456',aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{runId:run.runId,scopeId:'scope12345',scopeVersion:3,mode:'account',queryRef:'https://www.tiktok.com/@factory',weeklyOriginalAccountCollection:{originalRunKey:'weekly-preproduction:fixture',accountUrl:'https://www.tiktok.com/@factory',actorInputSha256:'b'.repeat(64)}}]})};producer.originalDatasetCandidateIds=[record.id];await f.store.create('social_discovery_runs',run);await f.store.create('trend_videos',record);
 const binding=await createStoredWeeklyRunKvBindingReader(f.store)(record.id);assert(binding&&'kind' in binding&&binding.kind==='original_dataset_direct_media');
 const result=await advanceWeeklyCandidateCanonicalMedia({store:f.store,job:f.job as any,run:run as any,record,mediaRoot:f.mediaRoot,binding});assert.equal(result.state,'completed');
 const saved=await f.store.getById<Record_>('trend_videos',record.id);assert.equal(saved?.videoFileId,`tenants/${f.job.tenantId}/reference-videos/${record.id}.mp4`);assert.equal(JSON.parse(String(saved?.aiAnalysis)).contentSha256,contentSha256);
 const again=await advanceWeeklyCandidateCanonicalMedia({store:f.store,job:f.job as any,run:run as any,record:saved!,mediaRoot:f.mediaRoot,binding});assert.equal(again.state,'completed');
});
test('a denied paid GET preflight creates no unknown claim and can resume with the same mapping',async t=>{
 const f=await fixture(t);let reads=0;const checked:Array<{kind:string;url:string}>=[];
 const common={store:f.store,job:f.job as any,run:f.run as any,record:f.record,mediaRoot:f.mediaRoot,binding:f.binding};
 const permit=(scope:any)=>({permitId:'permit123',ledgerOperationId:'kv-ledger-op',ledgerOutcomeHash:'a'.repeat(64),tokenFingerprintScheme:APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME,tokenFingerprint:apifyTokenFingerprint('fixture-token',APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME),scopeHash:socialRequestHash(scope),kind:'apify_same_run_kv_get',status:'authorized'});
 let deny=true;
 const ports={token:'fixture-token',mappingAuthorities:f.authorities,isMappingRevoked:async()=>false,readPermit:async(scope:any)=>permit(scope),
  assertPaidRead:async(_permit:any,_scope:any,request:{kind:string;url:string})=>{checked.push(request);if(deny&&request.kind==='kv_media_get')throw Error('cost ceiling unavailable');},
  readSameRun:async(input:any)=>{reads++;await fs.mkdir(input.outputDirectory,{recursive:true});const filePath=path.join(input.outputDirectory,`${hash(f.bytes)}.mp4`);await fs.writeFile(filePath,f.bytes);return {...f.binding,filePath,contentSha256:hash(f.bytes),byteLength:f.bytes.length,durationSeconds:1,width:160,height:288};}};
 const blocked=await advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any});
 assert.equal(blocked.code,'weekly_postanalysis_canonical_media_permit_required');
 assert.equal(reads,0);
 assert.equal((await f.store.list(WEEKLY_CANDIDATE_CANONICAL_MEDIA_OPERATIONS)).totalItems,0);
 assert.deepEqual(checked.map(value=>value.kind),['run_get','dataset_item_get','kv_keys_get','kv_media_get']);
 assert.equal(checked[0]?.url,`https://api.apify.com/v2/actor-runs/${f.run.runId}`);
 assert.equal(checked[1]?.url,`https://api.apify.com/v2/datasets/${f.binding.datasetId}/items?format=json&clean=false&offset=0&limit=1`);
 assert.equal(checked[2]?.url,`https://api.apify.com/v2/key-value-stores/${f.binding.defaultKeyValueStoreId}/keys?limit=1000`);
 assert.equal(checked[3]?.url,`https://api.apify.com/v2/key-value-stores/${f.binding.defaultKeyValueStoreId}/records/${f.binding.recordKey}`);
 deny=false;
 assert.equal((await advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any})).state,'completed');
 assert.equal(reads,1);
});
test('same-run receipt is canonicalized once; restart completes from local bytes without another GET',async t=>{
 const f=await fixture(t);let reads=0;
 const common={store:f.store,job:f.job as any,run:f.run as any,record:f.record,mediaRoot:f.mediaRoot,binding:f.binding};
 const ports={token:'fixture-token',mappingAuthorities:f.authorities,isMappingRevoked:async()=>false,readPermit:async(scope:any)=>({permitId:'permit123',ledgerOperationId:'kv-ledger-op',ledgerOutcomeHash:'a'.repeat(64),tokenFingerprintScheme:APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME,tokenFingerprint:apifyTokenFingerprint('fixture-token',APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME),scopeHash:socialRequestHash(scope),kind:'apify_same_run_kv_get',status:'authorized'}),assertPaidRead:async()=>{},readSameRun:async(input:any)=>{reads++;await fs.mkdir(input.outputDirectory,{recursive:true});const filePath=path.join(input.outputDirectory,`${hash(f.bytes)}.mp4`);await fs.writeFile(filePath,f.bytes);return {...f.binding,filePath,contentSha256:hash(f.bytes),byteLength:f.bytes.length,durationSeconds:1,width:160,height:288};}};
 const first=await advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any});assert.equal(first.state,'completed');assert.equal(reads,1);
 const saved=await f.store.getById<Record_>('trend_videos',f.record.id);assert.ok(saved);assert.equal(saved.videoFileId,`tenants/${f.job.tenantId}/reference-videos/${f.record.id}.mp4`);assert.equal(JSON.parse(String(saved.aiAnalysis)).contentSha256,hash(f.bytes));
 assert.deepEqual(await fs.readFile(path.join(f.mediaRoot,String(saved.videoFileId))),f.bytes);
 const again=await advanceWeeklyCandidateCanonicalMedia({...common,record:saved,ports:ports as any});assert.equal(again.state,'completed');assert.equal(reads,1);
});
test('unknown GET without persisted adapter return never promotes an arbitrary file on restart',async t=>{
 const f=await fixture(t);let reads=0;const common={store:f.store,job:f.job as any,run:f.run as any,record:f.record,mediaRoot:f.mediaRoot,binding:f.binding};
 const ports={token:'fixture-token',mappingAuthorities:f.authorities,isMappingRevoked:async()=>false,readPermit:async(scope:any)=>({permitId:'permit123',ledgerOperationId:'kv-ledger-op',ledgerOutcomeHash:'a'.repeat(64),tokenFingerprintScheme:APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME,tokenFingerprint:apifyTokenFingerprint('fixture-token',APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME),scopeHash:socialRequestHash(scope),kind:'apify_same_run_kv_get',status:'authorized'}),assertPaidRead:async()=>{},readSameRun:async(input:any)=>{reads++;await fs.mkdir(input.outputDirectory,{recursive:true});await fs.writeFile(path.join(input.outputDirectory,`${hash(f.bytes)}.mp4`),f.bytes);throw Error('crash before return');}};
 assert.equal((await advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any})).state,'unknown');
 assert.equal((await advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any})).state,'unknown');
 assert.equal(reads,1);assert.equal((await f.store.list(WEEKLY_CANDIDATE_CANONICAL_MEDIA_READ_RECEIPTS)).totalItems,0);assert.equal((await f.store.getById<Record_>('trend_videos',f.record.id))?.videoFileId,'');
});
test('unsigned or revoked mapping and unsafe canonical path create no unknown operation or GET',async t=>{
 const f=await fixture(t);let reads=0;const common={store:f.store,job:f.job as any,run:f.run as any,record:f.record,mediaRoot:f.mediaRoot,binding:f.binding};
 const ports={token:'fixture-token',mappingAuthorities:[],isMappingRevoked:async()=>false,readPermit:async(scope:any)=>({permitId:'permit123',ledgerOperationId:'kv-ledger-op',ledgerOutcomeHash:'a'.repeat(64),tokenFingerprintScheme:APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME,tokenFingerprint:apifyTokenFingerprint('fixture-token',APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME),scopeHash:socialRequestHash(scope),kind:'apify_same_run_kv_get',status:'authorized'}),assertPaidRead:async()=>{},readSameRun:async()=>{reads++;throw Error('must not read');}};
 await assert.rejects(advanceWeeklyCandidateCanonicalMedia({...common,ports:ports as any}),/mapping_receipt_invalid/);
 await assert.rejects(advanceWeeklyCandidateCanonicalMedia({...common,ports:{...ports,mappingAuthorities:f.authorities,isMappingRevoked:async()=>true} as any}),/mapping_revoked_or_unknown/);
 await assert.rejects(advanceWeeklyCandidateCanonicalMedia({...common,record:{...f.record,id:'../evil'},ports:{...ports,mappingAuthorities:f.authorities} as any}),/lineage_invalid/);
 assert.equal(reads,0);assert.equal((await f.store.list(WEEKLY_CANDIDATE_CANONICAL_MEDIA_OPERATIONS)).totalItems,0);
});
