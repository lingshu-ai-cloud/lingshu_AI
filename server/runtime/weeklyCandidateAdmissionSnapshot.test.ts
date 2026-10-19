import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_,ListQuery} from '../storage/datastore.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {assessWeeklyReferenceCandidate,readWeeklyCandidateAdmissionSnapshot,readWeeklyReferenceCandidateAdmissionSnapshot} from './weeklyCandidateAdmissionSnapshot.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import type {CandidateContextAssessment} from '../socialDiscovery/candidateContextAssessment.js';
import type {CandidateSemanticAssessment} from '../socialDiscovery/candidateSemanticAssessment.js';

function reader(rows:Record<string,Record_[]>):DataStore{
 const data=structuredClone(rows);
 return {
  async getById<T>(collection:string,id:string){return structuredClone(data[collection]?.find(row=>row.id===id)??null) as T|null;},
  async list<T>(collection:string,query:ListQuery={}){const found=(data[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));const page=query.page??1,perPage=query.perPage??30;return {items:structuredClone(found.slice((page-1)*perPage,page*perPage)) as T[],totalItems:found.length,totalPages:Math.max(1,Math.ceil(found.length/perPage)),page,perPage};},
  async create(){throw Error('read_only_snapshot_wrote');},async update(){throw Error('read_only_snapshot_wrote');},async delete(){throw Error('read_only_snapshot_wrote');},
 };
}
const origin={runId:'current-run',scopeId:'scope',scopeVersion:1,mode:'momentum',queryRef:'factory',observedAt:'2026-10-18T00:00:00Z'};
const parent={id:'parent-row',tenant_id:'tenant',runId:'parent-run'} as Record_;
const sourceSelection=[{mode:'momentum',platform:'tiktok',queryRef:'factory'}];
const run={id:'child-row',tenant_id:'tenant',runId:'current-run',status:'failed',discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{retry:{parentRunId:'parent-run',parentRunHash:socialRequestHash(parent),sourceSelection}}},evidenceOutcomes:{momentum:{suggestionCandidateIds:['current'],acceptedCandidateIds:[],acceptedEvidenceRefs:[],failedCandidateIds:['current']}}} as unknown as SocialInspirationCollectionRun;
const job={jobId:'child',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,consumerTaskId:'task',authority:{scopeId:'scope',scopeVersion:1},retry:{parentRunId:'parent-run',parentRunHash:socialRequestHash(parent),sourceSelection}} as WeeklyPreproductionRetryAttempt;
function fixture(){return {social_discovery_runs:[parent,run as unknown as Record_],trend_videos:[{id:'current',tenantId:'tenant',platform:'tiktok',sourceUrl:'https://www.tiktok.com/@factory/video/123456',aiAnalysis:JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[origin]})}],social_candidate_evidence:[{id:'old-score',tenant_id:'tenant',candidateId:'current',evidenceId:'old-score',version:1,evidence:{qualityScore:{decision:'rejected'}},g1:{runId:'current-run'}}]} as Record<string,Record_[]>;}

test('reference-grade semantic evidence can be accepted without granting production admission',()=>{
 const fact={ref:{type:'enterprise_fact',id:'product',version:1},statement:'Cloud Cleanser'};
 const context={tenantId:'tenant',candidateId:'current',programId:'program',packageId:'package',packageVersion:1,keyword:{scopeId:'scope',scopeVersion:1},recordHash:'context-hash',productFacts:[fact],observations:[{shotIndex:1}]} as CandidateContextAssessment;
 const semantic={tenantId:'tenant',candidateId:'current',contextHash:'context-hash',dimensions:{relevance:{state:'assessed',value:.84,evidence:[{factRef:'enterprise_fact:product@1',shotIndex:1,quote:'Cleanser closeup'}]}}} as CandidateSemanticAssessment;
 const base={context,semantic,scopeId:'scope',scopeVersion:1,selectedProductName:'Cloud Cleanser',candidateId:'current',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,hasExactEvidence:true,hasCandidateAnalysisHandoff:true,hasAccount:true};
 assert.equal(assessWeeklyReferenceCandidate(base),'accepted');
 assert.equal(assessWeeklyReferenceCandidate({...base,hasCandidateAnalysisHandoff:false}),'pending','post-content production handoff cannot unlock pre-director reference admission');
 assert.equal(assessWeeklyReferenceCandidate({...base,selectedProductName:'Other'}),'pending');
 assert.equal(assessWeeklyReferenceCandidate({...base,scopeVersion:2}),'pending');
 assert.equal(assessWeeklyReferenceCandidate({...base,semantic:{...semantic,dimensions:{...semantic.dimensions,relevance:{...semantic.dimensions.relevance,value:.69}}}}),'rejected');
 assert.equal(assessWeeklyReferenceCandidate({...base,semantic:{...semantic,dimensions:{...semantic.dimensions,relevance:{...semantic.dimensions.relevance,evidence:[{factRef:'enterprise_fact:foreign@1',shotIndex:1,quote:'Cleanser closeup',reason:'foreign fact'}]}}}}),'pending');
});

test('reference snapshot never turns a metadata candidate into a qualified mother',async()=>{
 const observed=await readWeeklyReferenceCandidateAdmissionSnapshot({store:reader(fixture()),job,run,mediaRoot:'/no-such-media-root'});
 assert.deepEqual(observed,[{candidateId:'current',evidenceRef:null,exactHandoffRef:null,accountId:null,postAdmission:'pending',referenceAdmission:'pending'}]);
});

test('historical blocked score remains pending across a fresh DataStore instance; snapshot makes no writes',async()=>{
 const stored=fixture();const input={job,run,mediaRoot:'/no-such-media-root'};
 const first=await readWeeklyCandidateAdmissionSnapshot({store:reader(stored),...input});
 const afterRestart=await readWeeklyCandidateAdmissionSnapshot({store:reader(structuredClone(stored)),...input});
 assert.deepEqual(afterRestart,first);
 assert.deepEqual(first,[{candidateId:'current',evidenceRef:null,exactHandoffRef:null,accountId:null,postAdmission:'pending'}]);
 assert.deepEqual(stored,fixture());
});

test('foreign or stale origin and altered parent hash fail closed, never count old accepted evidence',async()=>{
 const stored=fixture();stored.trend_videos![0]!.aiAnalysis=JSON.stringify({analysisQuality:'video',discoveryOrigins:[{...origin,runId:'old-run'}]});
 await assert.rejects(readWeeklyCandidateAdmissionSnapshot({store:reader(stored),job,run,mediaRoot:'/no-such-media-root'}),/origin_invalid/);
 const valid=fixture();await assert.rejects(readWeeklyCandidateAdmissionSnapshot({store:reader(valid),job:{...job,retry:{...job.retry,parentRunHash:'changed'}},run,mediaRoot:'/no-such-media-root'}),/lineage_invalid/);
});

test('original weekly run is read-only admitted as pending; forged root key cannot borrow child evidence',async()=>{
 const rootKey='weekly-root',rootRunId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key:rootKey})}`;
 const rootRun={...run,id:'root-row',tenant_id:'tenant',runId:rootRunId,scopeSnapshot:{weeklyProducer:{key:rootKey},modePolicies:{momentum:{platforms:['tiktok']}}},queryBasis:{momentum:['factory']}} as unknown as SocialInspirationCollectionRun;
 const rootJob={...job,originalRunKey:rootKey,retry:undefined} as unknown as WeeklyPreproductionRetryAttempt;
 const stored=fixture();stored.social_discovery_runs=[rootRun as unknown as Record_];
 stored.trend_videos![0]!.aiAnalysis=JSON.stringify({analysisQuality:'metadata',discoveryOrigins:[{...origin,runId:rootRunId}]});
 assert.equal((await readWeeklyCandidateAdmissionSnapshot({store:reader(stored),job:rootJob,run:rootRun,mediaRoot:'/no-such-media-root'}))[0]?.postAdmission,'pending');
 await assert.rejects(readWeeklyCandidateAdmissionSnapshot({store:reader(stored),job:{...rootJob,originalRunKey:'forged'},run:rootRun,mediaRoot:'/no-such-media-root'}),/lineage_invalid/);
});

test('metadata accepted IDs are inspected, not silently omitted from post-analysis admission',async()=>{
 const stored=fixture();
 const acceptedRun={...run,evidenceOutcomes:{momentum:{acceptedCandidateIds:['current'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as SocialInspirationCollectionRun;
 stored.social_discovery_runs=[parent,acceptedRun as unknown as Record_];
 assert.deepEqual((await readWeeklyCandidateAdmissionSnapshot({store:reader(stored),job,run:acceptedRun,mediaRoot:'/no-such-media-root'})).map(item=>[item.candidateId,item.postAdmission]),[['current','pending']]);
});

test('two fresh local DataStore processes read the same persisted blocked candidates without mutation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-admission-reader-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const saved=fixture();
 for(const [collection,rows] of Object.entries(saved))await fs.writeFile(path.join(directory,`${collection}.json`),JSON.stringify(rows));
 const moduleUrl=new URL('./weeklyCandidateAdmissionSnapshot.ts',import.meta.url).href;
 const storeUrl=new URL('../storage/pbStore.ts',import.meta.url).href;
 const authorityUrl=new URL('../storage/dataAuthority.ts',import.meta.url).href;
 const code=`const {pbStore}=await import(${JSON.stringify(storeUrl)});const {runWithDataAuthority}=await import(${JSON.stringify(authorityUrl)});const {readWeeklyCandidateAdmissionSnapshot}=await import(${JSON.stringify(moduleUrl)});const job=${JSON.stringify(job)};const run=${JSON.stringify(run)};const result=await runWithDataAuthority('local',()=>readWeeklyCandidateAdmissionSnapshot({store:pbStore,job,run,mediaRoot:'/no-such-media-root'}));console.log(JSON.stringify(result));`;
 const read=()=>new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',code],{env:{...process.env,NODE_ENV:'test',ENABLE_LOCAL_DEV_FALLBACK:'true',LOCAL_STORE_DIR:directory},stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',status=>status===0?resolve(output.trim()):reject(Error(error)));});
 const first=await read(),second=await read();assert.equal(second,first);assert.equal(JSON.parse(first)[0].postAdmission,'pending');
 for(const [collection,rows] of Object.entries(saved))assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,`${collection}.json`),'utf8')),rows);
});
