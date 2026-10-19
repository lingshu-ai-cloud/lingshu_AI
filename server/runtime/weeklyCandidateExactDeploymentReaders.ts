import type {DataStore,Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {WeeklyCandidateExactAuthorityReader,WeeklyCandidateExactSignedAuthority,WeeklyCandidateExactTrustedIssuer} from './weeklyCandidateExactFormalAuthority.js';
import type {WeeklyCandidateExactAuditReader} from './weeklyCandidateExactConservativeSettlement.js';

export const WEEKLY_CANDIDATE_EXACT_AUTHORITIES='social_weekly_candidate_exact_authorities';
export const WEEKLY_CANDIDATE_EXACT_TRUSTED_ISSUERS='social_weekly_candidate_exact_trusted_issuers';
export const WEEKLY_CANDIDATE_EXACT_AUDIT_RECORDS='social_weekly_candidate_exact_audit_records';
export const WEEKLY_CANDIDATE_EXACT_REVOCATIONS='social_weekly_candidate_exact_revocations';
const fail=(code:string):never=>{throw Error(`weekly_candidate_exact_deployment_${code}`);};
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

type StoredAuthority={schema:'weekly-candidate-exact-signed-authority-record.v1';tenantId:string;programId:string;packageId:string;packageVersion:number;jobId:string;runId:string;signed:WeeklyCandidateExactSignedAuthority;recordHash:string};
type StoredIssuer=WeeklyCandidateExactTrustedIssuer&{schema:'weekly-candidate-exact-trusted-issuer.v1';status:'active'|'revoked';recordHash:string};
type StoredAudit={schema:'weekly-candidate-exact-audit-record.v1';tenantId:string;requestId:string;operationId:string;candidateId:string;apiKeyId:string;model:'qwen3-vl-plus';status:200;usage:{prompt_tokens:number;completion_tokens:number;total_tokens:number};sourceEvidenceHash:string;observedAt:string;recordHash:string};

function checked<T extends {recordHash:string}>(row:Record_,schema:string):T{
 const value=row.payload as T&{schema?:unknown};
 if(!value||value.schema!==schema||row.record_hash!==value.recordHash||value.recordHash!==socialRequestHash({...value,recordHash:''}))return fail('record_corrupt');
 return value;
}

/** Read-only platform-audit import boundary, shared by signed legacy
 * authorities and package-derived production escrows. Missing rows remain
 * unsettled; this reader never manufactures usage or a provider receipt. */
export function createStoredWeeklyCandidateExactAuditReader(store:DataStore,tenantId:string):WeeklyCandidateExactAuditReader{
 return {readOriginalAuditRequest:async({requestId,operationId,candidateId})=>{
  const rows=await store.list<Record_>(WEEKLY_CANDIDATE_EXACT_AUDIT_RECORDS,{where:{tenant_id:tenantId,request_id:requestId},perPage:2});
  if(rows.totalItems===0)return null;
  if(rows.totalItems!==1||rows.items.length!==1)return fail('audit_ambiguous');
  const audit=checked<StoredAudit>(rows.items[0]!,'weekly-candidate-exact-audit-record.v1');
  if(audit.tenantId!==tenantId||audit.requestId!==requestId||audit.operationId!==operationId||audit.candidateId!==candidateId||audit.model!=='qwen3-vl-plus'||audit.status!==200||!digest(audit.sourceEvidenceHash)||!Number.isFinite(Date.parse(audit.observedAt))||
   !Number.isSafeInteger(audit.usage.prompt_tokens)||!Number.isSafeInteger(audit.usage.completion_tokens)||!Number.isSafeInteger(audit.usage.total_tokens)||audit.usage.prompt_tokens<0||audit.usage.completion_tokens<0||audit.usage.total_tokens!==audit.usage.prompt_tokens+audit.usage.completion_tokens)return fail('audit_changed');
  return {requestId:audit.requestId,apiKeyId:audit.apiKeyId,model:audit.model,status:audit.status,usage:audit.usage,sourceEvidenceHash:audit.sourceEvidenceHash};
 }};
}

/** Production reader only. It never signs, approves or imports evidence. */
export async function createStoredWeeklyCandidateExactReaders(input:{store:DataStore;tenantId:string;programId:string;packageId:string;packageVersion:number;jobId:string;runId:string}){
 const where={tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId,package_version:input.packageVersion,job_id:input.jobId,run_id:input.runId};
 const authorities=await input.store.list<Record_>(WEEKLY_CANDIDATE_EXACT_AUTHORITIES,{where,perPage:2});
 if(authorities.totalItems===0)return null;
 if(authorities.totalItems!==1||authorities.items.length!==1)return fail('authority_ambiguous');
 const authority=checked<StoredAuthority>(authorities.items[0]!,'weekly-candidate-exact-signed-authority-record.v1');
 if(authority.tenantId!==input.tenantId||authority.programId!==input.programId||authority.packageId!==input.packageId||authority.packageVersion!==input.packageVersion||authority.jobId!==input.jobId||authority.runId!==input.runId)return fail('authority_scope_changed');
 const issuerRows=await input.store.list<Record_>(WEEKLY_CANDIDATE_EXACT_TRUSTED_ISSUERS,{where:{tenant_id:input.tenantId,status:'active'},perPage:100});
 if(issuerRows.items.length!==issuerRows.totalItems)return fail('issuer_list_incomplete');
 const trustedIssuers=issuerRows.items.map(row=>checked<StoredIssuer>(row,'weekly-candidate-exact-trusted-issuer.v1')).filter(i=>i.status==='active').map(({issuerId,keyId,reviewerId,tenantId,publicKeyPem})=>({issuerId,keyId,reviewerId,tenantId,publicKeyPem}));
 const authorityReader:WeeklyCandidateExactAuthorityReader={
  read:async()=>authority.signed,
  trustedIssuers,
  isRevoked:async(authorizationId,authorizationHash)=>{
   const rows=await input.store.list<Record_>(WEEKLY_CANDIDATE_EXACT_REVOCATIONS,{where:{tenant_id:input.tenantId,authorization_id:authorizationId},perPage:2});
   if(rows.totalItems>1||rows.items.length!==rows.totalItems)return true;
   if(!rows.items[0])return false;
   const value=rows.items[0].payload as {authorizationId?:unknown;authorizationHash?:unknown;revoked?:unknown;recordHash?:unknown};
   if(value.authorizationId!==authorizationId||value.authorizationHash!==authorizationHash||value.revoked!==true||!digest(value.recordHash)||rows.items[0].record_hash!==value.recordHash||value.recordHash!==socialRequestHash({...value,recordHash:''}))return true;
   return true;
  },
 };
 const auditReader=createStoredWeeklyCandidateExactAuditReader(input.store,input.tenantId);
 return {authorityReader,auditReader,authorityRecordHash:authority.recordHash};
}
