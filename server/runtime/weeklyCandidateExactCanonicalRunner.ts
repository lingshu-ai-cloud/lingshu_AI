import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {store as routeStore} from '../storage/index.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {exactQwenScope} from '../agents/exactQwenScope.js';
import {getQwenProviderBinding} from '../agents/qwen.js';
import {executeExistingCandidateMedia} from './weeklyCandidateModelRevision.js';
import {verifiedWeeklyCandidateCanonicalMedia,weeklyCandidateExactRecordBindingHash} from './weeklyCandidateExactAnalysisOperation.js';
import {prepareDeployedWeeklyCandidateExactFormalPorts} from './weeklyCandidateExactFormalPorts.js';

type Job=WeeklyPreproductionJob|WeeklyPreproductionRetryAttempt;
type Input={job:Job;run:SocialInspirationCollectionRun;record:Record_;operationId:string};
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

/** Explicit server composition for the existing exact video analyzer. This
 * runner neither issues a five-candidate authority nor settles a paid call;
 * callers must wrap it in the formal authority and per-request paid scope. */
export function createWeeklyCandidateExactCanonicalRunner(input:{store:DataStore;mediaRoot:string;execute?:typeof executeExistingCandidateMedia}){
 return async({job,run,record,operationId}:Input):Promise<void>=>{
  if(input.store!==routeStore)throw Error('weekly_candidate_exact_runner_store_mismatch');
  if(record.tenantId!==job.tenantId||run.discoveryScopeId!==job.authority?.scopeId||run.discoveryScopeVersion!==job.authority?.scopeVersion||
   !/^[\w-]+$/.test(job.tenantId)||!/^[\w-]+$/.test(record.id)||!operationId)throw Error('weekly_candidate_exact_runner_scope_changed');
  const scope=exactQwenScope(),binding=getQwenProviderBinding();
  if(!scope?.paidGuardRequired||!scope.beforeProviderRequest||scope.model!=='qwen3-vl-plus'||
   scope.endpoint!==binding.baseUrl||scope.credentialDigest!==binding.credentialSha256)throw Error('weekly_candidate_exact_runner_paid_scope_required');
  const current=await input.store.getById<Record_>('trend_videos',record.id);
  if(!current||weeklyCandidateExactRecordBindingHash(current)!==weeklyCandidateExactRecordBindingHash(record))throw Error('weekly_candidate_exact_runner_record_changed');
  const canonical=await verifiedWeeklyCandidateCanonicalMedia(current,input.mediaRoot);
  if(!canonical)throw Error('weekly_candidate_exact_runner_canonical_media_required');
  const relative=`tenants/${job.tenantId}/reference-videos/${record.id}.mp4`;
  if(current.videoFileId!==relative)throw Error('weekly_candidate_exact_runner_media_binding_changed');
  const source=path.resolve(input.mediaRoot,relative),tenant=await fs.realpath(path.resolve(input.mediaRoot,'tenants',job.tenantId));
  const actual=await fs.realpath(source);
  if(!actual.startsWith(tenant+path.sep))throw Error('weekly_candidate_exact_runner_media_path_changed');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-exact-canonical-'));
  try{
   const frozen=path.join(directory,'source.mp4');
   await fs.copyFile(actual,frozen);
   const latest=await input.store.getById<Record_>('trend_videos',record.id);
   if(sha(await fs.readFile(frozen))!==canonical.sha256||!latest||
    weeklyCandidateExactRecordBindingHash(latest)!==weeklyCandidateExactRecordBindingHash(record))
    throw Error('weekly_candidate_exact_runner_source_changed');
   await (input.execute??executeExistingCandidateMedia)(record,operationId,frozen);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
 };
}

/** Production-facing composition: deliberately no route-supplied executor or
 * ledger root. The independent issuer and original provider/billing readers
 * remain mandatory, and no default registration of this adapter exists. */
export function prepareDeployedWeeklyCandidateExactCanonicalPorts(input:
 Omit<Parameters<typeof prepareDeployedWeeklyCandidateExactFormalPorts>[0],'runAnalysis'>&{store:DataStore;mediaRoot:string}){
 const {store,mediaRoot,...formal}=input;
 if(store!==routeStore||!path.isAbsolute(mediaRoot))throw Error('weekly_candidate_exact_runner_deployed_configuration_invalid');
 return prepareDeployedWeeklyCandidateExactFormalPorts({...formal,runAnalysis:createWeeklyCandidateExactCanonicalRunner({store,mediaRoot})});
}
