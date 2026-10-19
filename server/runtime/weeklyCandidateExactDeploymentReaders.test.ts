import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {createStoredWeeklyCandidateExactReaders,WEEKLY_CANDIDATE_EXACT_AUDIT_RECORDS,WEEKLY_CANDIDATE_EXACT_AUTHORITIES,WEEKLY_CANDIDATE_EXACT_TRUSTED_ISSUERS} from './weeklyCandidateExactDeploymentReaders.js';

const seal=<T extends {recordHash:string}>(value:T)=>({...value,recordHash:socialRequestHash({...value,recordHash:''})});

test('deployment reader exposes only one hash-sealed independent authority and exact audit row',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),scope={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:f.task.packageVersion,jobId:'job-exact',runId:'run-exact'};
 const signed={statement:{authorizationId:'auth'},signatureBase64url:'signature'} as any;
 const authority=seal({schema:'weekly-candidate-exact-signed-authority-record.v1' as const,...scope,signed,recordHash:''});
 await f.store.create(WEEKLY_CANDIDATE_EXACT_AUTHORITIES,{id:'authority',tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,job_id:scope.jobId,run_id:scope.runId,record_hash:authority.recordHash,payload:authority});
 const issuer=seal({schema:'weekly-candidate-exact-trusted-issuer.v1' as const,tenantId:scope.tenantId,issuerId:'issuer',keyId:'key',reviewerId:'reviewer',publicKeyPem:'public',status:'active' as const,recordHash:''});
 await f.store.create(WEEKLY_CANDIDATE_EXACT_TRUSTED_ISSUERS,{id:'issuer',tenant_id:scope.tenantId,status:'active',record_hash:issuer.recordHash,payload:issuer});
 const audit=seal({schema:'weekly-candidate-exact-audit-record.v1' as const,tenantId:scope.tenantId,requestId:'request-1',operationId:'operation-1',candidateId:'candidate-1',apiKeyId:'key-id',model:'qwen3-vl-plus' as const,status:200 as const,usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},sourceEvidenceHash:'a'.repeat(64),observedAt:new Date().toISOString(),recordHash:''});
 await f.store.create(WEEKLY_CANDIDATE_EXACT_AUDIT_RECORDS,{id:'audit',tenant_id:scope.tenantId,request_id:audit.requestId,record_hash:audit.recordHash,payload:audit});
 const readers=await createStoredWeeklyCandidateExactReaders({store:f.store,...scope});assert(readers);
 assert.deepEqual(await readers.authorityReader.read(),signed);assert.equal(readers.authorityReader.trustedIssuers.length,1);assert.equal(await readers.authorityReader.isRevoked('auth','b'.repeat(64)),false);
 assert.deepEqual(await readers.auditReader.readOriginalAuditRequest({requestId:audit.requestId,operationId:audit.operationId,candidateId:audit.candidateId}),{requestId:audit.requestId,apiKeyId:audit.apiKeyId,model:audit.model,status:200,usage:audit.usage,sourceEvidenceHash:audit.sourceEvidenceHash});
 assert.equal(await readers.auditReader.readOriginalAuditRequest({requestId:'missing',operationId:audit.operationId,candidateId:audit.candidateId}),null);
 await f.store.update(WEEKLY_CANDIDATE_EXACT_AUDIT_RECORDS,'audit',{record_hash:'0'.repeat(64)});
 await assert.rejects(readers.auditReader.readOriginalAuditRequest({requestId:audit.requestId,operationId:audit.operationId,candidateId:audit.candidateId}),/record_corrupt/);
});
