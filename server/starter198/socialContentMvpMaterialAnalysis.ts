import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import type {SocialContentAutoProductionRuntime} from './socialContentProductionExecution.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {createPersistedStudioReceiptAdoptionAdapter,type StudioAdoptionScope} from './socialContentStudioAdoption.js';
import {socialObject} from './socialContentValidation.js';
/** Reuses actual B QA comparison against the byte-identical original product; never grades new imagery. */
export function createMvpCanonicalMaterialAnalysis(input:{dataStore:DataStore;scope:StudioAdoptionScope}):NonNullable<SocialContentAutoProductionRuntime['analyzeAssets']>{
return async value=>{
if(value.tenantId!==input.scope.tenantId)throw Error('canonical_material_analysis_scope_changed');
const job=await readContentExecutionJob(input.dataStore,input.scope.tenantId,input.scope.taskId,input.scope.runId);
if(!job||job.id!==input.scope.jobId)throw Error('canonical_material_analysis_job_changed');
const executor=socialObject(job.checkpoints['social.executor']?.payload);
const approved=executor?.approvedContext as any,shot=approved?.assetSupplyPlan?.shots?.find((s:any)=>s.shotId==='S04');
if(!shot)throw Error('canonical_material_analysis_binding_missing');
const adapter=createPersistedStudioReceiptAdoptionAdapter(input),result=await adapter.execute({tenantId:input.scope.tenantId,taskId:input.scope.taskId,shot,baselineScene:{} as any,availableAssets:[],outputDirectory:''});
if(!result)throw Error('canonical_material_source_QA_missing');
const provenance=socialObject(result.asset.segments.at(-1))?.studioAdoption as {sourceReceiptRefs?:string[]}|undefined;
const hashes=new Set((provenance?.sourceReceiptRefs??[]).filter(ref=>ref.startsWith('product_source_sha256:')).map(ref=>ref.slice('product_source_sha256:'.length)));
const quality=socialObject(result.asset.segments[0])?.quality as {checks?:{product_identity?:{verdict?:string;note?:string;evidenceFrames?:string[]}}}|undefined;
const observation=quality?.checks?.product_identity;
if(observation?.verdict!=='pass'||!observation.note||!observation.evidenceFrames?.length||!hashes.size)throw Error('canonical_material_product_observation_missing');
const assets=[];
for(const asset of value.assets){
if(asset.visualObservations.length||asset.segments.length){assets.push(asset);continue;}
if(asset.type!=='image'||!asset.localPath||!asset.contentHash||!hashes.has(asset.contentHash))throw Error('canonical_material_analysis_missing_no_paid_fallback');
const hash=createHash('sha256');for await(const part of createReadStream(asset.localPath))hash.update(part);
if(hash.digest('hex')!==asset.contentHash)throw Error('canonical_material_source_bytes_changed');
assets.push({...asset,visualObservations:[observation.note],segments:[{canonicalSourceVisualQa:{sourceSha256:asset.contentHash,providerTaskId:result.sourceRef,observation,evidenceRefs:provenance?.sourceReceiptRefs,assessment:'existing product-reference observation reused; no new media inspection'}}]});
}
return {assets,failures:[]};
};
}
