import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import {readWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {readIndependentAdmission} from '../socialPrograms/weeklyIndependentAdmission.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {weeklyCandidateExactJobBindingHash} from './weeklyCandidateExactFormalPorts.js';
import {weeklyCandidateExactRunBindingHash} from './weeklyCandidateExactRunBinding.js';
import {qwenVisionInputLimit} from '../lib/qwenVisionInputLimit.js';
import {withPaidOperationLock} from '../lib/paidOperationLock.js';

export const WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS='social_weekly_candidate_exact_production_escrows';
// qwen3-vl-plus can consume a one-million-token visual context. Two fully
// saturated child calls already reserve almost seven CNY; a third cannot fit
// inside the accepted ten-yuan mother-film envelope alongside production.
export const WEEKLY_EXACT_MAX_REQUESTS_PER_CANDIDATE=2 as const;
const inputCnyPerMillion=3,outputCnyPerMillion=30,maximumOutputTokens=16384;
const micros=(value:number)=>Math.ceil(value*1_000_000-1e-9);
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string):never=>{throw Error(`weekly_candidate_exact_production_escrow_${code}`);};
type Job=WeeklyPreproductionJob|WeeklyPreproductionRetryAttempt;

export interface WeeklyCandidateExactProductionEscrow {
 schema:'weekly-candidate-exact-production-escrow.v1';escrowId:string;tenantId:string;programId:string;packageId:string;packageVersion:number;
 packageHash:string;templateAdoptionHash:string;independentAdmissionHash:string;jobId:string;jobHash:string;runId:string;runHash:string;
 model:'qwen3-vl-plus';endpoint:string;credentialSha256:string;tariffEvidenceHash:string;auditApiKeyId:string;
 weeklyProductionMaximumCny:number;perMotherIncludingRevisionsMaximumCny:10;maximumRequestsPerCandidate:2;
 maximumCnyPerCandidate:number;maximumCnyTotal:number;
 candidates:Array<{candidateId:string;mediaSha256:string;operationId:string}>;
 authorizesPublishing:false;authorizesAcceptance:false;authorizesCustomerMessages:false;createdAt:string;recordHash:string;
}
type Ledger={schema:'weekly-candidate-exact-production-escrow-ledger.v1';escrowHash:string;limitMicros:number;perMotherLimitMicros:number;entries:Record<string,{candidateId:string;mediaSha256:string;reservedMicros:number;state:'reserved'|'carried_forward';motherContentId:string|null;contentLedgerRef:string|null}>};

function write(file:string,value:Ledger){const directory=path.dirname(file);fs.mkdirSync(directory,{recursive:true,mode:0o700});const temporary=`${file}.${randomUUID()}.tmp`,fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
function read(file:string,escrow:WeeklyCandidateExactProductionEscrow):Ledger{if(!fs.existsSync(file))return{schema:'weekly-candidate-exact-production-escrow-ledger.v1',escrowHash:escrow.recordHash,limitMicros:micros(escrow.weeklyProductionMaximumCny),perMotherLimitMicros:10_000_000,entries:{}};let value:Ledger;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fail('ledger_corrupt');}if(value.schema!=='weekly-candidate-exact-production-escrow-ledger.v1'||value.escrowHash!==escrow.recordHash||value.limitMicros!==micros(escrow.weeklyProductionMaximumCny)||value.perMotherLimitMicros!==10_000_000||!value.entries||Array.isArray(value.entries))fail('ledger_changed');let total=0;for(const [operationId,entry] of Object.entries(value.entries)){if(!operationId||!escrow.candidates.some(c=>c.operationId===operationId&&c.candidateId===entry.candidateId&&c.mediaSha256===entry.mediaSha256)||entry.reservedMicros!==micros(escrow.maximumCnyPerCandidate)||!['reserved','carried_forward'].includes(entry.state)||(entry.state==='reserved'&&(entry.motherContentId!==null||entry.contentLedgerRef!==null))||(entry.state==='carried_forward'&&(!entry.motherContentId||!entry.contentLedgerRef)))fail('ledger_corrupt');total+=entry.reservedMicros;}if(total>value.limitMicros)fail('weekly_limit_exceeded');return value;}
async function uniquePackage(store:DataStore,job:Job){const rows=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:job.tenantId,program_id:job.programId,package_id:job.packageId,version:job.packageVersion},perPage:2});if(rows.totalItems!==1||rows.items.length!==1)return fail('package_missing_or_ambiguous');const pkg=rows.items[0]!.payload as WeeklyOperatingPackage;if(pkg.packageId!==job.packageId||pkg.programId!==job.programId||pkg.version!==job.packageVersion||!['draft','active'].includes(pkg.status))fail('package_changed');return{row:rows.items[0]!,pkg};}

/**
 * Derive the pre-production hold from the already adopted weekly package.
 * This is not another user approval. Supplier audit evidence remains a
 * separate settlement requirement after the provider request.
 */
export async function prepareWeeklyCandidateExactProductionEscrow(input:{store:DataStore;job:Job;run:SocialInspirationCollectionRun;root:string;provider:{endpoint:string;credentialSha256:string;model:'qwen3-vl-plus';tariffEvidenceHash:string;auditApiKeyId:string};candidates:Array<{candidateId:string;mediaSha256:string;operationId:string}>;now?:()=>number}){
 const {job,run}=input,scope={tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion};
 if(!path.isAbsolute(input.root)||!job.authority||run.discoveryScopeId!==job.authority.scopeId||run.discoveryScopeVersion!==job.authority.scopeVersion||input.candidates.length!==5||new Set(input.candidates.map(c=>c.candidateId)).size!==5||new Set(input.candidates.map(c=>c.operationId)).size!==5||input.candidates.some(c=>!c.candidateId||!c.operationId||!/^[a-f0-9]{64}$/.test(c.mediaSha256)))fail('scope_invalid');
 if(input.provider.model!=='qwen3-vl-plus'||input.provider.endpoint!=='https://maas.qianwenaiapi.com/compatible-mode/v1'||!/^[a-f0-9]{64}$/.test(input.provider.credentialSha256)||!/^[a-f0-9]{64}$/.test(input.provider.tariffEvidenceHash)||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.provider.auditApiKeyId))fail('provider_evidence_invalid');
 const [{row,pkg},adoption,independent]=await Promise.all([uniquePackage(input.store,job),readWeeklyAutomationTemplate(input.store,scope),readIndependentAdmission(input.store,scope)]);
 if(!adoption||!independent||adoption.actorUserId!==independent.actorUserId||adoption.template.perFinishedVideoMaxCny!==10||pkg.socialContentPackage.perItemBudgetCny!==10||!Number.isFinite(pkg.socialContentPackage.weeklyBudgetCny)||pkg.socialContentPackage.weeklyBudgetCny!<=0)fail('weekly_authority_required');
 const maximumCnyPerCandidate=micros(WEEKLY_EXACT_MAX_REQUESTS_PER_CANDIDATE*(qwenVisionInputLimit('qwen3-vl-plus')*inputCnyPerMillion+maximumOutputTokens*outputCnyPerMillion)/1_000_000)/1_000_000;
 if(maximumCnyPerCandidate>10)return fail('per_mother_limit_exceeded');const maximumCnyTotal=maximumCnyPerCandidate*5;if(maximumCnyTotal>pkg.socialContentPackage.weeklyBudgetCny!)return fail('weekly_limit_exceeded');
 const body={schema:'weekly-candidate-exact-production-escrow.v1' as const,tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion,packageHash:socialRequestHash(row.payload),templateAdoptionHash:socialRequestHash(adoption),independentAdmissionHash:socialRequestHash(independent),jobId:job.jobId,jobHash:weeklyCandidateExactJobBindingHash(job),runId:run.runId,runHash:weeklyCandidateExactRunBindingHash(run),model:input.provider.model,endpoint:input.provider.endpoint,credentialSha256:input.provider.credentialSha256,tariffEvidenceHash:input.provider.tariffEvidenceHash,auditApiKeyId:input.provider.auditApiKeyId,weeklyProductionMaximumCny:pkg.socialContentPackage.weeklyBudgetCny!,perMotherIncludingRevisionsMaximumCny:10 as const,maximumRequestsPerCandidate:WEEKLY_EXACT_MAX_REQUESTS_PER_CANDIDATE,maximumCnyPerCandidate,maximumCnyTotal,candidates:[...input.candidates].sort((a,b)=>a.candidateId.localeCompare(b.candidateId)),authorizesPublishing:false as const,authorizesAcceptance:false as const,authorizesCustomerMessages:false as const,createdAt:new Date((input.now??Date.now)()).toISOString()};
 const escrowId=socialRequestHash({...body,createdAt:''}).slice(0,24),item:WeeklyCandidateExactProductionEscrow={...body,escrowId,recordHash:''};item.recordHash=socialRequestHash({...item,recordHash:''});
 const assertCurrent=async(escrow:WeeklyCandidateExactProductionEscrow)=>{const [current,currentAdoption,currentIndependent]=await Promise.all([uniquePackage(input.store,job),readWeeklyAutomationTemplate(input.store,scope),readIndependentAdmission(input.store,scope)]),saved=await input.store.getById<Record_>(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS,escrow.escrowId);if(!saved||saved.tenant_id!==job.tenantId||saved.record_hash!==escrow.recordHash||socialRequestHash(saved.payload)!==socialRequestHash(escrow)||socialRequestHash(current.row.payload)!==escrow.packageHash||!currentAdoption||socialRequestHash(currentAdoption)!==escrow.templateAdoptionHash||!currentIndependent||socialRequestHash(currentIndependent)!==escrow.independentAdmissionHash||weeklyCandidateExactJobBindingHash(job)!==escrow.jobHash||weeklyCandidateExactRunBindingHash(run)!==escrow.runHash)fail('authority_changed');};
 const prior=await input.store.getById<Record_>(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS,escrowId);if(prior){const existing=prior.payload as WeeklyCandidateExactProductionEscrow;if(prior.tenant_id!==job.tenantId||prior.record_hash!==existing.recordHash||existing.recordHash!==socialRequestHash({...existing,recordHash:''})||socialRequestHash({...existing,createdAt:'',recordHash:''})!==socialRequestHash({...item,createdAt:'',recordHash:''}))fail('record_changed');return createEscrowHandle(input.root,existing,()=>assertCurrent(existing));}
 if(!await input.store.create(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS,{id:escrowId,tenant_id:job.tenantId,program_id:job.programId,package_id:job.packageId,package_version:job.packageVersion,job_id:job.jobId,run_id:run.runId,record_hash:item.recordHash,payload:item}))fail('record_write_unknown');
 return createEscrowHandle(input.root,item,()=>assertCurrent(item));
}
function createEscrowHandle(root:string,escrow:WeeklyCandidateExactProductionEscrow,assertCurrent:()=>Promise<void>){const absolute=path.resolve(root),file=path.join(absolute,sha(JSON.stringify([escrow.tenantId,escrow.programId,escrow.packageId,escrow.packageVersion]))+'.json'),lock=path.join(absolute,'.locks');return{escrow,assertCurrent,async reserve(candidateId:string,mediaSha256:string,operationId:string){return withPaidOperationLock(lock,`weekly-exact-production-escrow:${escrow.packageId}:${escrow.packageVersion}`,async()=>{await assertCurrent();const candidate=escrow.candidates.find(c=>c.candidateId===candidateId&&c.mediaSha256===mediaSha256&&c.operationId===operationId);if(!candidate)fail('candidate_changed');const ledger=read(file,escrow),prior=ledger.entries[operationId];if(!prior){const amount=micros(escrow.maximumCnyPerCandidate);if(Object.values(ledger.entries).reduce((sum,e)=>sum+e.reservedMicros,0)+amount>ledger.limitMicros)fail('weekly_limit_exceeded');ledger.entries[operationId]={candidateId,mediaSha256,reservedMicros:amount,state:'reserved',motherContentId:null,contentLedgerRef:null};write(file,ledger);}return{authorizationId:escrow.escrowId,authorizationHash:escrow.recordHash,maximumRequests:escrow.maximumRequestsPerCandidate,maximumCny:escrow.maximumCnyPerCandidate};});},async status(){return withPaidOperationLock(lock,`weekly-exact-production-escrow:${escrow.packageId}:${escrow.packageVersion}`,async()=>structuredClone(read(file,escrow)));}};}
