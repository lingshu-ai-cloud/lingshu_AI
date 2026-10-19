import {STARTER_COLLECTIONS,type Starter198Repository} from './repository.js';
import {socialJson,socialObject,socialRequestHash,socialText,SocialContentWorkflowError} from './socialContentValidation.js';
import {withSocialContentSubjectLease,assertSocialContentSubjectLease} from './socialContentMutation.js';
import {shanghaiNaturalWeek,CONTENT_CREATION_QUOTA_COLLECTION} from '../socialPrograms/contentCreationQuota.js';
import type {SocialContentOrderBinding} from './socialContentOrderAdmission.js';

export interface LegacyExecutionEvidence {verified:boolean;missingProofs:string[];evidence:Record<string,unknown>}
type Input={repository:Starter198Repository;tenantId:string;taskId:string;
 /** Server-owned audit of file-backed budgets and Studio sidecars, not HTTP input. */
 inspectLegacyExecutionEvidence?:(input:{tenantId:string;taskId:string})=>Promise<LegacyExecutionEvidence>};
export interface LegacyOrderMigrationInspection {
 status:'eligible'|'blocked'|'already_migrated';taskId:string;evidenceHash:string;missingProofs:string[];
 binding?:SocialContentOrderBinding;evidence:Record<string,unknown>;
}
/** A historical draft can recover its own identity, never a guessed parent or
 * an execution allowance. Started/repair records require separate reconciliation. */
export async function inspectSocialContentLegacyOrderMigration(input:Input):Promise<LegacyOrderMigrationInspection>{
 const store=input.repository.dataStore,missing:string[]=[];
 const tasks=await input.repository.list(STARTER_COLLECTIONS.socialContentTasks,input.tenantId,{where:{task_id:input.taskId},perPage:2});
 const task=tasks.items.length===1&&tasks.totalItems===1?tasks.items[0]:null;
 if(!task||task.tenant_id!==input.tenantId)missing.push('task_identity_missing_or_ambiguous');
 const evidence:Record<string,unknown>={task};
 const done=(binding?:SocialContentOrderBinding,status?:LegacyOrderMigrationInspection['status']):LegacyOrderMigrationInspection=>({status:status??(missing.length?'blocked':'eligible'),taskId:input.taskId,evidenceHash:socialRequestHash(evidence),missingProofs:missing,binding,evidence});
 if(!task)return done();
 const existing=socialObject(socialJson(task.content_order));
 if(existing){
  const provenance=socialObject(existing.legacyMigration);
  if(existing.schemaVersion==='social-content-order.v1'&&existing.contentId===input.taskId&&existing.budgetTaskId===input.taskId
    &&provenance?.schemaVersion==='social-content-legacy-order-migration.v1')return done(existing as unknown as SocialContentOrderBinding,'already_migrated');
  missing.push('existing_order_requires_independent_reconciliation');return done();
 }
 if(!store){missing.push('authoritative_store_missing');return done();}
 const external=input.inspectLegacyExecutionEvidence?await input.inspectLegacyExecutionEvidence({tenantId:input.tenantId,taskId:input.taskId}):null;
 evidence.legacyExecutionAccounting=external;
 if(external?.missingProofs.length)missing.push(...external.missingProofs);
 if(!external?.verified&&!external?.missingProofs.length)missing.push('legacy_studio_and_file_budget_audit_required');
 const brief=socialObject(socialJson(task.brief));
 if(brief?._weeklyCreativeRepairProof||brief?._productionRevision||brief?._weeklyAuthority
   ||socialText(task.parent_task_id)||socialText(task.revision_of_task_id))missing.push('trusted_revision_or_weekly_root_and_original_cost_mapping_required');
 if(!['draft','plan_review'].includes(socialText(task.status))||socialText(task.run_id)||socialText(task.orchestrator_item_id))missing.push('historical_run_slot_and_cost_mapping_required');
 const key=socialText(task.create_idempotency_key),hash=socialText(task.create_request_hash),actor=socialText(task.created_by);
 const ops=await input.repository.list(STARTER_COLLECTIONS.socialContentOperations,input.tenantId,{where:{idempotency_key:key},perPage:2});
 evidence.creationOperations=ops;
 const op=ops.totalItems===1&&ops.items.length===1?ops.items[0]:null,receipt=socialObject(socialJson(op?.result));
 if(!key||!hash||!actor||!op||op.tenant_id!==input.tenantId||op.operation!=='create_social_content_task'||op.target_id!=='task-collection'
   ||op.status!=='succeeded'||op.request_hash!==hash||op.created_by!==actor||!socialText(op.operation_id)
   ||receipt?.schemaVersion!=='social-content.operation-result.v1'||receipt.operationId!==op.operation_id||receipt.targetId!=='task-collection')missing.push('exact_successful_authenticated_creation_receipt_required');
 const duplicates=await input.repository.list(STARTER_COLLECTIONS.socialContentTasks,input.tenantId,{where:{create_idempotency_key:key},perPage:2});
 evidence.creationIdentityMatches=duplicates;
 if(duplicates.totalItems!==1||duplicates.items[0]?.id!==task.id)missing.push('creation_command_task_mapping_ambiguous');
 const created=new Date(String(task.created_at??task.created??''));
 if(!Number.isFinite(created.getTime()))missing.push('original_creation_timestamp_required');
 for(const collection of ['content_execution_jobs',STARTER_COLLECTIONS.orchestratorInbox,STARTER_COLLECTIONS.socialContentArtifacts,STARTER_COLLECTIONS.socialDeliveryPackages,STARTER_COLLECTIONS.socialContentLineage]){
  const result=await store.list<any>(collection,{where:{tenant_id:input.tenantId,task_id:input.taskId},perPage:1000});
  evidence[collection]=result;
  if(result.totalItems!==result.items.length)missing.push(`incomplete_history:${collection}`);
  if(result.items.length)missing.push(`historical_execution_mapping_required:${collection}`);
 }
 const allOps=await input.repository.list(STARTER_COLLECTIONS.socialContentOperations,input.tenantId,{where:{target_id:input.taskId},perPage:1000});
 evidence.taskOperations=allOps;
 if(allOps.totalItems!==allOps.items.length)missing.push('incomplete_task_operation_history');
 if(allOps.items.some(row=>/start|production|render|delivery|revision|rework/.test(socialText(row.operation))))missing.push('execution_operation_reconciliation_required');
 const pools=await store.list<any>(CONTENT_CREATION_QUOTA_COLLECTION,{where:{tenant_id:input.tenantId},perPage:1000});
 evidence.quotaHistory=pools;
 if(pools.totalItems!==pools.items.length)missing.push('incomplete_quota_history');
 if(pools.items.some(row=>{const payload=socialObject(socialJson(row.payload)),orders=socialObject(payload?.orders);return Object.values(orders??{}).some((value:any)=>value.contentId===input.taskId||value.productionTaskId===input.taskId||value.revisions?.some((r:any)=>r.executionTaskId===input.taskId));}))missing.push('existing_quota_slot_mapping_requires_reconciliation');
 const programs=await store.list<any>('social_programs',{where:{tenant_id:input.tenantId},perPage:1000});
 evidence.programs=programs;
 if(programs.totalItems!==programs.items.length)missing.push('incomplete_program_history');
 const ref=socialObject(brief?.programRef),explicit=socialText(ref?.id);
 const candidates=programs.items.filter(p=>{
  const at=Date.parse(String(p.created_at??p.created??''));
  return p.tenant_id===input.tenantId&&socialText(p.program_id)&&Number.isFinite(at)&&at<=created.getTime()&&(!explicit||p.program_id===explicit);
 });
 if(candidates.length!==1)missing.push('unique_program_existing_at_original_creation_required');
 evidence.programResolution={source:explicit?'persisted_program_reference':'unique_historical_program',programId:candidates.length===1?candidates[0].program_id:null};
 // Prefix is provenance of the documented UI call, not an authorization grant.
 const entry=key.startsWith('assistant-production-')?'assistant':'workspace';
 evidence.entryResolution={entry,source:key.startsWith('assistant-production-')?'GlobalAssistant.assistant-production-key':'legacy_content_workspace_default',executionAuthorization:false};
 const binding:SocialContentOrderBinding={schemaVersion:'social-content-order.v1',contentId:input.taskId,budgetTaskId:input.taskId,entry,programId:candidates.length===1?candidates[0].program_id:null,originWeek:Number.isFinite(created.getTime())?shanghaiNaturalWeek(created):null};
 return done(missing.length?undefined:binding);
}
export const planSocialContentLegacyOrderMigration=inspectSocialContentLegacyOrderMigration;

export async function applySocialContentLegacyOrderMigration(input:Input&{actorId:string;expectedEvidenceHash:string;now?:Date}){
 if(!socialText(input.actorId))throw new SocialContentWorkflowError('social_content_legacy_migration_actor_required',403);
 return withSocialContentSubjectLease({repository:input.repository,tenantId:input.tenantId,subjectId:input.taskId,action:async()=>{
  const plan=await inspectSocialContentLegacyOrderMigration(input);
  if(plan.status==='already_migrated'){
   const provenance=socialObject((plan.binding as any).legacyMigration);
   if(provenance?.evidenceHash!==input.expectedEvidenceHash)throw new SocialContentWorkflowError('social_content_legacy_migration_evidence_changed',409);
   return plan;
  }
  if(plan.evidenceHash!==input.expectedEvidenceHash)throw new SocialContentWorkflowError('social_content_legacy_migration_evidence_changed',409);
  if(plan.status!=='eligible'||!plan.binding)throw new SocialContentWorkflowError('social_content_legacy_migration_unverified',409);
  const store=input.repository.dataStore;
  if(!store?.compareAndSwap||!await store.supportsAtomicCompareAndSwap?.())throw new SocialContentWorkflowError('social_content_legacy_migration_atomic_store_required',409);
  const task=plan.evidence.task as any;
  const legacyMigration={schemaVersion:'social-content-legacy-order-migration.v1',actorId:input.actorId,appliedAt:(input.now??new Date()).toISOString(),evidenceHash:plan.evidenceHash,
   evidence:plan.evidence,snapshot:{recordId:task.id,taskId:task.task_id,version:task.version,contentOrder:task.content_order??null},effects:{quotaReservation:false,execution:false,costMutation:false}};
  const binding={...plan.binding,legacyMigration};
  await assertSocialContentSubjectLease({repository:input.repository,tenantId:input.tenantId,subjectId:input.taskId});
  if(!await store.compareAndSwap(STARTER_COLLECTIONS.socialContentTasks,task.id,{tenant_id:input.tenantId,content_order:task.content_order,version:task.version,status:task.status,run_id:task.run_id,brief:task.brief},{content_order:binding}))throw new SocialContentWorkflowError('social_content_legacy_migration_conflict',409);
  return {...plan,status:'already_migrated' as const,binding};
 }});
}
