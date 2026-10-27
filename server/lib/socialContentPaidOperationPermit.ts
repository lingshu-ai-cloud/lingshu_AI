import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withPaidOperationLock} from './paidOperationLock.js';
import type {SocialContentTaskBudget,SocialTaskBudgetScope,SocialTaskBudgetOperation} from './socialContentTaskBudget.js';
import {assertSocialPaidExecutionDependencies,socialPaidIntentOperation,type SocialPaidOperationIntent} from './socialContentTaskBudgetAuthority.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(reason:string):never=>{throw Error(`social_paid_permit_${reason}`);};
export type PaidOperationSubmission = Omit<SocialPaidOperationIntent,'maximumUnits'> & {actualUnits:Record<string,number>;executionBindingHash?:string};
export interface SocialPaidExecutionDependency {operationId:string;receiptRef:string;artifactSha256:string}
/** Existing voice/product consumers own submission and recovery, not binding
 * new dependency plans. Keep their port limited to the methods they consume. */
export type SocialPaidOperationSubmissionPermit=Pick<ReturnType<typeof createSocialContentPaidOperationPermit>,'beforeSubmit'|'markOutcome'|'assertRecovery'|'isProvenUnsubmitted'>;
interface ExecutionBinding {schemaVersion:'paid-execution-binding.v1';scopeHash:string;operationId:string;intentFingerprint:string;requestFingerprint:string;dependencies:SocialPaidExecutionDependency[];bindingHash:string}
/** Constructed only from the trusted authority's reserved operation plan. Claims
 * are shared-volume durable; a crash before POST is deliberately unknown. */
export function createSocialContentPaidOperationPermit(input:{scope:SocialTaskBudgetScope;operations:SocialTaskBudgetOperation[];
 intents:SocialPaidOperationIntent[];ledger:Pick<SocialContentTaskBudget,'status'|'markOutcome'>;
 root?:string;assertCurrent(scope:SocialTaskBudgetScope):Promise<void>;
 /** Only new provider claims, never existing-operation recovery. */
 assertNewSubmit?(scope:SocialTaskBudgetScope):Promise<void>}){
 const scope=structuredClone(input.scope),operations=structuredClone(input.operations),intents=structuredClone(input.intents);
 for(const intent of intents)if(intent.executionBindingPolicy!==undefined){
  const expected=socialPaidIntentOperation(scope,intent),matches=operations.filter(operation=>operation.operationId===intent.operationId);
  if(matches.length!==1||matches[0]!.fingerprint!==expected.fingerprint)fail('execution_binding_policy_invalid');
 }
 assertSocialPaidExecutionDependencies(intents);
 const root=path.resolve(input.root||process.env.SOCIAL_CONTENT_PAID_PERMIT_DIR||'data/social-content-paid-permits');
 const key=(id:string)=>JSON.stringify([scope.tenantId,scope.taskId,scope.runId,scope.planHash,id]);
 const file=(id:string)=>path.join(root,hash(key(id))+'.json');
 const bindingFile=(id:string)=>path.join(root,hash([key(id),'execution-binding'])+'.binding.json');
 const writeFile=(target:string,row:unknown)=>{fs.mkdirSync(root,{recursive:true,mode:0o700});const temp=target+'.'+randomUUID()+'.tmp';const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(row));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,target);const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}};
 const write=(id:string,row:unknown)=>writeFile(file(id),row);
 const read=(id:string):Record<string,unknown>|null=>{if(!fs.existsSync(file(id)))return null;try{const row=JSON.parse(fs.readFileSync(file(id),'utf8'));const {op,intent}=bound(id);if(row.schemaVersion!==1||row.scopeHash!==hash(scope)||row.operationId!==id||row.fingerprint!==op.fingerprint||!['unknown','accepted','completed'].includes(row.status)||!row.submission||row.submissionHash!==hash(row.submission)||(['operationId','provider','model','accountRef','stage','shotId','inputContractHash'] as const).some(k=>row.submission[k]!==intent[k])||hash(row.actualUnits)!==hash(row.submission.actualUnits))fail('claim_corrupt');if(intent.executionBindingPolicy){const binding=readBinding(id);if(!binding||row.submission.executionBindingHash!==binding.bindingHash)fail('execution_binding_changed');if(row.status==='completed'&&!/^[a-f0-9]{64}$/.test(row.artifactSha256??''))fail('execution_artifact_hash_missing');}return row;}catch{return fail('claim_corrupt');}};
 const bound=(id:string)=>{const ops=operations.filter(o=>o.operationId===id),plans=intents.filter(o=>o.operationId===id);if(ops.length!==1||plans.length!==1)fail('operation_missing_or_ambiguous');return {op:ops[0]!,intent:plans[0]!};};
 const entry=(id:string)=>{const {op}=bound(id);const entries=input.ledger.status(scope)?.entries.filter(e=>e.operationId===id)||[];if(entries.length!==1)fail('reservation_missing');const e=entries[0]!;if((e.executionTaskId??scope.budgetTaskId??scope.taskId)!==scope.taskId||e.runId!==scope.runId||e.planHash!==scope.planHash||(['operationId','fingerprint','provider','model','accountRef','stage','shotId'] as const).some(k=>e[k]!==op[k]))fail('reservation_changed');return e;};
 const assertDependencies=(id:string,dependencies:SocialPaidExecutionDependency[])=>{
  const {intent}=bound(id),policy=intent.executionBindingPolicy;
  const allowed=policy?.schemaVersion==='paid-execution-binding-policy.v1'?[policy.parentOperationIds]:policy?.allowedParentOperationSets;
  const actual=Array.isArray(dependencies)?[...dependencies].map(item=>item?.operationId).sort():[];
  if(!allowed||!Array.isArray(dependencies)||dependencies.some(item=>!item||typeof item.operationId!=='string')||new Set(actual).size!==actual.length
   ||!allowed.some(expected=>expected.length===actual.length&&[...expected].sort().every((parent,index)=>parent===actual[index])))fail('execution_dependencies_changed');
  for(const dependency of dependencies){
   if(!/^[a-f0-9]{64}$/.test(dependency.artifactSha256)||typeof dependency.receiptRef!=='string'||!dependency.receiptRef.trim())fail('execution_dependency_evidence_invalid');
   const parent=entry(dependency.operationId);if(parent.status!=='completed'||parent.receiptRef!==dependency.receiptRef)fail('execution_dependency_not_completed');
   const receipt=read(dependency.operationId);if(receipt?.status!=='completed'||receipt.receiptRef!==dependency.receiptRef||receipt.artifactSha256!==dependency.artifactSha256)fail('execution_dependency_artifact_changed');
  }
 };
 const readBinding=(id:string):ExecutionBinding|null=>{
  if(!fs.existsSync(bindingFile(id)))return null;
  let row:ExecutionBinding;try{row=JSON.parse(fs.readFileSync(bindingFile(id),'utf8'));if(!row||typeof row!=='object'||Array.isArray(row))return fail('execution_binding_corrupt');}catch{return fail('execution_binding_corrupt');}
  const {bindingHash,...body}=row,{op,intent}=bound(id);
  if(!intent.executionBindingPolicy||op.fingerprint!==socialPaidIntentOperation(scope,intent).fingerprint||row.schemaVersion!=='paid-execution-binding.v1'||row.scopeHash!==hash(scope)||row.operationId!==id
   ||row.intentFingerprint!==op.fingerprint||!/^[a-f0-9]{64}$/.test(row.requestFingerprint)||bindingHash!==hash(body))fail('execution_binding_corrupt');
  assertDependencies(id,row.dependencies);return row;
 };
 const assertWholePlanReserved=()=>{
	  const current=input.ledger.status(scope);
	  if(!current)throw Error('social_paid_permit_whole_plan_budget_invalid');
	  if(!Number.isFinite(current.limitCny)||current.limitCny<=0
	   ||!Number.isFinite(current.retainedCny)||current.retainedCny<0)fail('whole_plan_budget_invalid');
  for(const op of operations){
   const entries=current.entries.filter(e=>e.operationId===op.operationId);
   if(entries.length!==1)fail('whole_plan_reservation_missing');
   const e=entries[0]!;
   if((e.executionTaskId??scope.budgetTaskId??scope.taskId)!==scope.taskId||e.status==='rejected'||e.runId!==scope.runId||e.planHash!==scope.planHash
    ||(['operationId','fingerprint','provider','model','accountRef','stage','shotId'] as const).some(k=>e[k]!==op[k]))fail('whole_plan_reservation_changed');
  }
 };
 const result = {
  async bindExecution(request:{operationId:string;requestFingerprint:string;dependencies:SocialPaidExecutionDependency[]}){
   return withPaidOperationLock(path.join(root,'.locks'),key(request.operationId),async()=>{
    await input.assertCurrent(scope);assertWholePlanReserved();const {op,intent}=bound(request.operationId);
    if(!intent.executionBindingPolicy||op.fingerprint!==socialPaidIntentOperation(scope,intent).fingerprint||!/^[a-f0-9]{64}$/.test(request.requestFingerprint))fail('execution_binding_policy_invalid');
    assertDependencies(request.operationId,request.dependencies);
    const body={schemaVersion:'paid-execution-binding.v1' as const,scopeHash:hash(scope),operationId:request.operationId,intentFingerprint:op.fingerprint,requestFingerprint:request.requestFingerprint,dependencies:[...request.dependencies].sort((a,b)=>a.operationId.localeCompare(b.operationId))};
    const binding={...body,bindingHash:hash(body)},prior=readBinding(request.operationId);
    if(prior){if(prior.bindingHash!==binding.bindingHash)fail('execution_binding_conflict');return prior;}
    if(entry(request.operationId).status!=='reserved'||read(request.operationId))fail('execution_binding_recovery_required');
    await input.assertCurrent(scope);writeFile(bindingFile(request.operationId),binding);
    const persisted=readBinding(request.operationId);if(persisted?.bindingHash!==binding.bindingHash)fail('execution_binding_write_failed');return persisted;
   });
  },
  isProvenUnsubmitted:(async(operationId:string)=>withPaidOperationLock(path.join(root,'.locks'),key(operationId),async()=>{
   await input.assertCurrent(scope);return entry(operationId).status==='reserved'&&!read(operationId);
  })) as ((operationId:string)=>Promise<boolean>)|undefined,
  async assertRecovery(operationId:string){return withPaidOperationLock(path.join(root,'.locks'),key(operationId),async()=>{
   await input.assertCurrent(scope);const e=entry(operationId),prior=read(operationId);
   if(!prior||!['unknown','accepted','completed'].includes(e.status))fail('recovery_original_receipt_missing');
   if(prior!.status==='completed'&&(e.status!=='completed'||e.receiptRef!==prior!.receiptRef))fail('claim_corrupt');
   return {operation:structuredClone(bound(operationId).op),status:e.status,receiptRef:e.receiptRef,
    submission:structuredClone(prior!.submission) as PaidOperationSubmission,submissionHash:String(prior!.submissionHash)};
  });},
  async beforeSubmit(request:PaidOperationSubmission){return withPaidOperationLock(path.join(root,'.locks'),key(request.operationId),async()=>{
   await input.assertCurrent(scope);assertWholePlanReserved();const {op,intent}=bound(request.operationId);
   // This is only a budget hold. It has no provider request and must never
   // produce a submission claim, even if a caller retains the film permit.
   if(op.stage==='director_review_capacity'||intent.stage==='director_review_capacity')fail('capacity_not_submittable');
   if((['provider','model','accountRef','stage','shotId','inputContractHash'] as const).some(k=>request[k]!==intent[k])
    ||(['provider','model','accountRef','stage','shotId'] as const).some(k=>op[k]!==intent[k]))fail('request_binding_changed');
   if(intent.executionBindingPolicy){
    const binding=readBinding(request.operationId);if(!binding||request.executionBindingHash!==binding.bindingHash)fail('execution_binding_required');
   }else if(request.executionBindingHash!==undefined)fail('execution_binding_not_planned');
   const actual=Object.keys(request.actualUnits).sort(),maximum=Object.keys(intent.maximumUnits).sort();
   if(!actual.length||JSON.stringify(actual)!==JSON.stringify(maximum)||actual.some(k=>!Number.isFinite(request.actualUnits[k])||request.actualUnits[k]!<0||!Number.isFinite(intent.maximumUnits[k])||request.actualUnits[k]!>intent.maximumUnits[k]!))
    fail(`usage_exceeds_bound:${intent.stage}:actual=${JSON.stringify(request.actualUnits)}:maximum=${JSON.stringify(intent.maximumUnits)}`);
   const e=entry(request.operationId),prior=read(request.operationId);
   if(prior||['accepted','unknown','completed'].includes(e.status))fail('receipt_recovery_required');
   if(e.status!=='reserved')fail('reservation_not_submittable');
   await input.assertCurrent(scope);
   await input.assertNewSubmit?.(scope);
   write(request.operationId,{schemaVersion:1,scopeHash:hash(scope),operationId:request.operationId,fingerprint:op.fingerprint,
    submissionHash:hash(request),submission:structuredClone(request),actualUnits:request.actualUnits,status:'unknown',receiptRef:null});
   // This is the real local submission-boundary receipt, not a fabricated
   // supplier acceptance. Failure keeps the durable claim and reserved charge.
   await input.ledger.markOutcome(scope,request.operationId,'unknown',`paid_permit_claim:${hash(key(request.operationId))}`);
   return {operationId:op.operationId,fingerprint:op.fingerprint};
  });},
  async markOutcome(operationId:string,status:'accepted'|'unknown'|'completed',receiptRef:string,artifact?:{sha256:string}){return withPaidOperationLock(path.join(root,'.locks'),key(operationId),async()=>{
   await input.assertCurrent(scope);entry(operationId);const prior=read(operationId);
   if(!prior||typeof receiptRef!=='string'||!receiptRef.trim()||!['accepted','unknown','completed'].includes(status))fail('receipt_or_claim_missing');
   if(prior!.status==='completed'&&(status!=='completed'||prior!.receiptRef!==receiptRef))fail('outcome_conflict');
   const {intent}=bound(operationId);if(intent.executionBindingPolicy&&status==='completed'&&(!artifact||!/^[a-f0-9]{64}$/.test(artifact.sha256)))fail('execution_artifact_hash_required');
   if(prior!.status==='completed'&&prior!.artifactSha256&&artifact!==undefined&&artifact.sha256!==prior!.artifactSha256)fail('execution_artifact_hash_changed');
   await input.ledger.markOutcome(scope,operationId,status,receiptRef);
   write(operationId,{...prior,status,receiptRef,...(artifact?{artifactSha256:artifact.sha256}:{})});
  });},
 };
 return result as Omit<typeof result,"isProvenUnsubmitted"> & Partial<Pick<typeof result,"isProvenUnsubmitted">>;
}
