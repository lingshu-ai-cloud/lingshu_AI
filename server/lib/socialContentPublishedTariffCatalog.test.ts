import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {createSocialContentPublishedTariffReader,QWEN_PUBLISHED_TARIFF_VALIDITY_MS} from './socialContentPublishedTariffs.js';
import {createSocialContentVerifiedTariffReader,socialTariffRecordHash,type SocialTariffEvidencePayload,type SocialVerifiedTariffPayload} from './socialContentVerifiedTariffs.js';
import type {SocialPaidOperationIntent} from './socialContentTaskBudgetAuthority.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const model='qwen3-vl-flash';
const baseUrl='https://dashscope.aliyuncs.com/compatible-mode/v1';
const credentialSha256='1'.repeat(64);
const accountRef=`qwen:${sha(JSON.stringify({baseUrl,credentialSha256}))}`;
const intent:SocialPaidOperationIntent={operationId:'analysis',provider:'qwen',model,accountRef,stage:'material_video_analysis',shotId:null,inputContractHash:'a'.repeat(64),maximumUnits:{inputTokens:10000,outputTokens:2000}};
const checkedAt=new Date('2026-10-01T00:00:00Z');
const sourceBody=()=>`window.__ICE_PAGE_PROPS__=${JSON.stringify({docDetailData:{storeData:{data:{title:model,alias:`/model-studio/${model}`,website:'cn',language:'zh',content:'<h2>模型价格 </h2><section id="华北2-北京"><table><thead><tr><th>计费项</th><th>价格（元）</th><th>单位</th></tr></thead><tbody><tr><td>输入</td><td>0.3</td><td>每百万 tokens</td></tr><tr><td>输出</td><td>3</td><td>每百万 tokens</td></tr></tbody></table></section><h2>限流</h2>'}}}})};`;

async function fixture(){
 let networkReads=0;
 const tariff=await createSocialContentPublishedTariffReader({
  now:()=>checkedAt,
  readProviderBinding:async()=>({provider:'qwen',model,baseUrl,credentialSha256}),
  fetchOfficial:async url=>{networkReads++;return{url,status:200,body:sourceBody()};},
 }).read(intent);
 assert.ok(tariff);
 const sourceSha256=sha(sourceBody());
 const payload:SocialVerifiedTariffPayload={schemaVersion:1,tenantId:'tenant',tariff,evidenceSha256:sourceSha256,verifiedBy:'tariff-refresh-worker',verifiedAt:checkedAt.toISOString()};
 const evidencePayload:SocialTariffEvidencePayload={schemaVersion:1,tenantId:'tenant',tariff:structuredClone(tariff),sourceRef:tariff.publicPricingEvidence.sourceUrl,sourceSha256,verifiedBy:'tariff-refresh-worker',verifiedAt:checkedAt.toISOString()};
 const fields={tenant_id:'tenant',provider:intent.provider,model:intent.model,account_ref:intent.accountRef,stage:intent.stage};
 const tariffRow:Record_={id:'tariff',...fields,status:'active',payload,record_hash:socialTariffRecordHash(payload)};
 const evidenceRow:Record_={id:tariff.evidenceRef,...fields,status:'verified',payload:evidencePayload,record_hash:socialTariffRecordHash(evidencePayload),source_body:sourceBody()};
 const store={list:async()=>({items:[tariffRow],totalItems:1,totalPages:1,page:1,perPage:2}),getById:async()=>evidenceRow} as unknown as Pick<DataStore,'list'|'getById'>;
 return{tariff,payload,evidencePayload,tariffRow,evidenceRow,store,networkReads:()=>networkReads,resign:()=>{tariffRow.record_hash=socialTariffRecordHash(payload);evidenceRow.record_hash=socialTariffRecordHash(evidencePayload);}};
}

test('durable published catalogue authorizes production offline throughout its refresh window',async()=>{
 const f=await fixture();assert.equal(f.networkReads(),1);
 const clock=()=>checkedAt.getTime()+30*24*3600000;
 const cached=await createSocialContentVerifiedTariffReader(f.store,'tenant',clock).read(intent);
 assert.deepEqual(cached,f.tariff);
 assert.equal(f.networkReads(),1,'film-time tariff read must not reload vendor documentation');
});

test('offline catalogue rejects expiry, source tampering and account substitution',async()=>{
 let f=await fixture();
 await assert.rejects(createSocialContentVerifiedTariffReader(f.store,'tenant',()=>checkedAt.getTime()+QWEN_PUBLISHED_TARIFF_VALIDITY_MS+1).read(intent),/invalid_or_expired/);
 f=await fixture();f.evidenceRow.source_body=sourceBody()+'changed';
 await assert.rejects(createSocialContentVerifiedTariffReader(f.store,'tenant',()=>checkedAt.getTime()+1).read(intent),/source_bytes_changed/);
 f=await fixture();f.tariffRow.account_ref='qwen:foreign';
 await assert.rejects(createSocialContentVerifiedTariffReader(f.store,'tenant',()=>checkedAt.getTime()+1).read(intent),/scope_mismatch/);
});
