import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {STARTER_COLLECTIONS,type Starter198Repository} from './repository.js';
import {resolvePreparedProductAssetCostLineage} from './socialContentCostLineage.js';
import {readPreparedSocialProductAssetFallback} from './socialContentProductAssetRevisionPrepare.js';
import {isAuthorizedProductFallback} from './socialContentProductAssetFallback.js';
import {isPresenterFirstFrameAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';
import {listPresenterFirstFrameApprovalsForReview} from './socialContentPresenterFirstFrameApproval.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject,socialRequestHash,socialText,SocialContentWorkflowError} from './socialContentValidation.js';

type Prepared=Parameters<typeof readPreparedSocialProductAssetFallback>[0];
type Freeze={schemaVersion:'social-product-asset-revision-paid-guard.v1';tenantId:string;taskId:string;sourceRunId:string;
 revisionRunId:string;sourceTaskVersion:string;preparedVersion:string;sourceBriefHash:string;sourceScriptHash:string;
 revisedPlanHash:string;lineageHash:string;budgetLedgerRef:string;ledgerHash:string;retainedMicros:number;
 replacementAssetId:string;replacementSha256:string;oldApprovalHashes:string[];recordHash:string};
const fail=(code:string):never=>{throw new SocialContentWorkflowError(`social_content_asset_revision_paid_guard_${code}`,409);};
const readBudget=(tenantId:string,taskId:string,sourceRunId:string,revisionRunId:string,ledgerRoot?:string)=>{
 const ledger=new SocialContentTaskBudget(ledgerRoot,{authorization:async()=>fail('read_only'),quote:async()=>fail('read_only'),
  assertCurrent:async()=>fail('read_only'),verifyRejection:async()=>false});
 const status=ledger.status({tenantId,taskId,runId:sourceRunId,planHash:'0'.repeat(64)});
 if(!status)return fail('original_ten_yuan_ledger_missing');
 if(!Number.isSafeInteger(Math.round(status.retainedCny*1e6))||status.limitCny!==10
  ||status.authorizedLimitCny!==10||status.retainedCny>10||status.hasCorrectionAuthorization)
  return fail('original_ten_yuan_ceiling_invalid');
 const entries=status.entries;
 if(entries.some(entry=>entry.status!=='rejected'&&(entry.executionTaskId??taskId)!==taskId))return fail('foreign_ledger_entry');
 const revisionEntries=entries.filter(entry=>entry.runId===revisionRunId);
 const sourceEntries=entries.filter(entry=>entry.runId!==revisionRunId);
 const sourceRetainedMicros=sourceEntries.filter(entry=>entry.status!=='rejected').reduce((sum,entry)=>sum+entry.reservedMicros,0);
 const retainedMicros=entries.filter(entry=>entry.status!=='rejected').reduce((sum,entry)=>sum+entry.reservedMicros,0);
 if(retainedMicros>10e6)return fail('original_ten_yuan_ceiling_exhausted');
 return {ledgerHash:socialRequestHash({limitCny:status.authorizedLimitCny,entries:sourceEntries}),sourceRetainedMicros,retainedMicros,revisionEntries};
};
async function readApprovals(repository:Starter198Repository,tenantId:string,taskId:string,sourceRunId:string,failedAssetId:string,productId:string){
 const store=repository.dataStore;if(!store)return fail('store_required');
 let approvals:Awaited<ReturnType<typeof listPresenterFirstFrameApprovalsForReview>>;
 try{approvals=await listPresenterFirstFrameApprovalsForReview(store,{tenantId,taskId,runId:sourceRunId});}
 catch{return fail('old_approval_corrupt');}
 const hashes:string[]=[];
 for(const approval of approvals){
  const provenance=approval.assetProvenance;
  if(!provenance||!isPresenterFirstFrameAssetProvenance(provenance))return fail('old_approval_provenance_missing');
  if(provenance.products.some(product=>product.productId===productId&&product.referenceImageIds.includes(failedAssetId)))
   hashes.push(approval.recordHash);
 }
 return hashes.sort();
}

/** Freeze a read-only paid-worker handoff on the existing isolated run. The
 * source task is not transitioned and this record never grants a permit. */
export async function freezeSocialProductAssetRevisionPaidGuard(input:{repository:Starter198Repository;tenantId:string;taskId:string;
 revisionRunId:string;prepared:Prepared;ledgerRoot?:string}){
 const {repository,tenantId,taskId,revisionRunId,prepared}=input;
 if(prepared.repository!==repository||prepared.tenantId!==tenantId||prepared.taskId!==taskId)return fail('scope_invalid');
 const store=repository.dataStore;if(!store?.compareAndSwap||!await store.supportsAtomicCompareAndSwap?.())return fail('atomic_store_required');
 const lineage=await resolvePreparedProductAssetCostLineage(prepared),candidate=await readPreparedSocialProductAssetFallback(prepared);
 const task=await requireSocialTask({repository,tenantId,taskId});
 const marker=socialObject(socialObject(socialJson(task.brief))?._productAssetFallback),revision=socialObject(marker?.revision);
 const run=await repository.get(STARTER_COLLECTIONS.runs,tenantId,revisionRunId),context=socialObject(socialJson(run?.starter_context));
 if(!marker||!revision)return fail('prepared_changed');
 if(!run||run.status!=='waiting_external'||context?.schemaVersion!=='social-product-asset-revision-schedule.v1'
  ||context.tenantId!==tenantId||context.taskId!==taskId||context.sourceRunId!==prepared.sourceRunId
  ||context.preparedVersion!==prepared.expectedPreparedVersion||context.revisedPlanHash!==candidate.revisedPlanHash
  ||context.lineageHash!==lineage.lineageHash||context.budgetLedgerRef!==prepared.budgetLedgerRef
  ||context.replacementAssetId!==revision?.replacementAssetId||context.replacementSha256!==revision?.replacementSha256
  ||!socialText(marker?.sourceTaskVersion))return fail('schedule_changed');
 const budget=readBudget(tenantId,taskId,prepared.sourceRunId,revisionRunId,input.ledgerRoot);
 if(budget.revisionEntries.length)return fail('revision_ledger_already_started');
 const oldApprovalHashes=await readApprovals(repository,tenantId,taskId,prepared.sourceRunId,
  String(marker.failedAssetId),String(marker.productId));
 const body={schemaVersion:'social-product-asset-revision-paid-guard.v1' as const,tenantId,taskId,
  sourceRunId:prepared.sourceRunId,revisionRunId,sourceTaskVersion:String(marker.sourceTaskVersion),
  preparedVersion:prepared.expectedPreparedVersion,sourceBriefHash:socialRequestHash(socialJson(task.brief)),
  sourceScriptHash:socialRequestHash(socialJson(task.replication_script)??null),revisedPlanHash:candidate.revisedPlanHash,
  lineageHash:lineage.lineageHash,budgetLedgerRef:prepared.budgetLedgerRef,ledgerHash:budget.ledgerHash,
  retainedMicros:budget.sourceRetainedMicros,replacementAssetId:String(revision.replacementAssetId),
  replacementSha256:String(revision.replacementSha256),oldApprovalHashes};
 const guard:Freeze={...body,recordHash:socialRequestHash(body)};
 const prior=socialObject(context.paidGuard);
 if(prior){if(socialRequestHash(prior)!==socialRequestHash(guard))return fail('freeze_changed');}
 else if(!await store.compareAndSwap(STARTER_COLLECTIONS.runs,run.id,
  {tenant_id:tenantId,status:run.status,starter_context:run.starter_context},
  {starter_context:{...context,paidGuard:guard}}))return fail('freeze_conflict');
 await readSocialProductAssetRevisionPaidGuard({...input,expectedRecordHash:guard.recordHash});
 return {recordHash:guard.recordHash,retainedCny:budget.retainedMicros/1e6,remainingCny:(10e6-budget.retainedMicros)/1e6,
  authorizesProvider:false as const,authorizesProduction:false as const};
}

/** Valid after a future task/run CAS because it uses the frozen source
 * identity, not readPrepared's pre-transition run_id predicate. Still not a
 * provider permit: a full new-run quote/reservation and QA gate are required. */
export async function readSocialProductAssetRevisionPaidGuard(input:{repository:Starter198Repository;tenantId:string;taskId:string;
 revisionRunId:string;prepared:Prepared;expectedRecordHash:string;ledgerRoot?:string}){
 const {repository,tenantId,taskId,revisionRunId}=input,run=await repository.get(STARTER_COLLECTIONS.runs,tenantId,revisionRunId);
 if(input.prepared.repository!==repository||input.prepared.tenantId!==tenantId||input.prepared.taskId!==taskId
  ||input.prepared.sourceRunId!==socialObject(socialJson(run?.starter_context))?.sourceRunId)return fail('scope_invalid');
 const context=socialObject(socialJson(run?.starter_context)),guard=socialObject(context?.paidGuard) as Freeze|null;
 if(!run||!context||!guard||guard.schemaVersion!=='social-product-asset-revision-paid-guard.v1'
  ||context.schemaVersion!=='social-product-asset-revision-schedule.v1'||guard.tenantId!==tenantId||guard.taskId!==taskId
  ||guard.revisionRunId!==revisionRunId||guard.sourceRunId!==context.sourceRunId
  ||guard.preparedVersion!==context.preparedVersion||guard.revisedPlanHash!==context.revisedPlanHash
  ||guard.lineageHash!==context.lineageHash||guard.budgetLedgerRef!==context.budgetLedgerRef
  ||guard.replacementAssetId!==context.replacementAssetId||guard.replacementSha256!==context.replacementSha256
  ||guard.recordHash!==input.expectedRecordHash)return fail('frozen_subject_changed');
 const {recordHash,...body}=guard;if(socialRequestHash(body)!==recordHash)return fail('frozen_corrupt');
 const task=await requireSocialTask({repository,tenantId,taskId});
 const brief=socialObject(socialJson(task.brief)),marker=socialObject(brief?._productAssetFallback),revision=socialObject(marker?.revision);
 if(!marker||!revision||socialRequestHash(socialJson(task.brief))!==guard.sourceBriefHash
  ||socialRequestHash(socialJson(task.replication_script)??null)!==guard.sourceScriptHash
  ||marker.sourceTaskVersion!==guard.sourceTaskVersion||marker.sourceRunId!==guard.sourceRunId
  ||marker.revisedPlanHash!==guard.revisedPlanHash||marker.budgetLedgerRef!==guard.budgetLedgerRef
  ||revision.replacementAssetId!==guard.replacementAssetId||revision.replacementSha256!==guard.replacementSha256
  ||![guard.sourceRunId,revisionRunId].includes(socialText(task.run_id)))return fail('task_changed');
 const material=await input.prepared.readReplacementMaterial(guard.replacementAssetId,tenantId);
 if(!material||!isAuthorizedProductFallback(material,{tenantId,productId:String(marker.productId),failedAssetId:String(marker.failedAssetId)})
  ||String(material.contentSha256||material.contentHash||'').toLowerCase()!==guard.replacementSha256)return fail('replacement_changed');
 try{const bytes=await input.prepared.readReplacementBytes(guard.replacementAssetId,tenantId);
  const metadata=await sharp(bytes,{failOn:'error'}).metadata();
  if(createHash('sha256').update(bytes).digest('hex')!==guard.replacementSha256||!metadata.width||!metadata.height
   ||metadata.width<64||metadata.height<64)throw Error('changed');
 }catch{return fail('replacement_changed');}
 if(await input.prepared.readBudgetLedgerRef()!==guard.budgetLedgerRef)return fail('budget_changed');
 const budget=readBudget(tenantId,taskId,guard.sourceRunId,revisionRunId,input.ledgerRoot);
 if(budget.ledgerHash!==guard.ledgerHash||budget.sourceRetainedMicros!==guard.retainedMicros
  ||budget.revisionEntries.some(entry=>entry.planHash!==guard.revisedPlanHash)
  ||(socialText(task.run_id)===guard.sourceRunId&&budget.revisionEntries.length))return fail('ledger_changed');
 const approvals=await readApprovals(repository,tenantId,taskId,guard.sourceRunId,String(marker.failedAssetId),String(marker.productId));
 if(socialRequestHash(approvals)!==socialRequestHash(guard.oldApprovalHashes))return fail('old_approvals_changed');
 if(socialText(task.run_id)===revisionRunId){
  const store=repository.dataStore;if(!store)return fail('store_required');
  let approvals:Awaited<ReturnType<typeof listPresenterFirstFrameApprovalsForReview>>;
  try{approvals=await listPresenterFirstFrameApprovalsForReview(store,{tenantId,taskId,runId:revisionRunId});}
  catch{return fail('new_approval_corrupt');}
  for(const value of approvals){
   const products=isPresenterFirstFrameAssetProvenance(value.assetProvenance)?value.assetProvenance.products:[];
   const selected=products.find(product=>product.productId===marker.productId);
   // A different plan's (or failed-QA) approval must not be laundered into the
   // revised run merely because it names the replacement image. The formal
   // confirmed-decision reader remains a separate pre-worker requirement.
   if(value.planHash!==guard.revisedPlanHash||value.qa.passed!==true
    ||guard.oldApprovalHashes.includes(value.recordHash)||!isPresenterFirstFrameAssetProvenance(value.assetProvenance)
    ||!selected||!selected.referenceImageIds.includes(guard.replacementAssetId)
    ||selected.referenceImageSha256s[selected.referenceImageIds.indexOf(guard.replacementAssetId)]!==guard.replacementSha256
    ||selected.referenceImageIds.includes(String(marker.failedAssetId)))return fail('new_approval_invalid');
  }
 }
 return {guard,retainedCny:budget.retainedMicros/1e6,remainingCny:(10e6-budget.retainedMicros)/1e6,
  authorizesProvider:false as const,authorizesProduction:false as const};
}
