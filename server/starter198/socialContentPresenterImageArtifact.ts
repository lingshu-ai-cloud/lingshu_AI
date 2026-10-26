import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {FirstFrameResult} from '../lib/firstFrameGenerator.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import type {createSocialContentPaidOperationPermit,SocialPaidExecutionDependency} from '../lib/socialContentPaidOperationPermit.js';
import type {StoryboardFirstFrameQualityEvaluation} from '../lib/storyboardFirstFrameQualityEvaluation.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';

const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
// Keep legacy cache keys intact; new bound plans use the existing canonical
// hash so datastore JSON key ordering cannot turn a paid result into a miss.
const artifactIdentity=(value:unknown,intent:SocialPaidOperationIntent)=>intent.executionBindingPolicy?paidProductionHash(value):hash(JSON.stringify(value));
type Permit=ReturnType<typeof createSocialContentPaidOperationPermit>;
interface ImageReceipt {
 schemaVersion:'presenter-image-artifact.v1';
 identityHash:string;outputSha256:string;mimeType:FirstFrameResult['mimeType'];
 provider:string;model:string;providerRequestId:string;receiptRef:string;estimatedCostCny:number;
 createdAt?:string;
}
async function atomicWrite(file:string,bytes:Buffer|string){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const temp=`${file}.${randomUUID()}.tmp`,handle=await fs.open(temp,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 await fs.rename(temp,file);
 const directory=await fs.open(path.dirname(file),'r');
 try{await directory.sync();}finally{await directory.close();}
}
export {atomicWrite as writePresenterArtifactFile};

/** One paid image, one immutable recovery artifact. This uses the existing
 * permit as the submission authority; an absent cache never clears its claim.
 * The supplier bytes and receipt are durable BEFORE marking the ledger complete.
 */
export async function preparePaidPresenterImage(input:{
 scope:SocialTaskBudgetScope;intent:SocialPaidOperationIntent;requestFingerprint:string;
 root:string;permit:Permit;parentArtifacts?:SocialPaidExecutionDependency[];generate:(executionBindingHash?:string)=>Promise<FirstFrameResult>;
}):Promise<FirstFrameResult&{receiptRef:string;reused:boolean;createdAt:string}>{
 const identityHash=artifactIdentity({scope:input.scope,intent:input.intent,requestFingerprint:input.requestFingerprint},input.intent);
 const base=path.join(input.root,hash(input.scope.tenantId),identityHash),imageFile=`${base}.image`,receiptFile=`${base}.json`;
 let receipt:ImageReceipt|null=null;
 try{receipt=JSON.parse(await fs.readFile(receiptFile,'utf8'));}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('presenter_image_artifact_corrupt');}
 if(receipt){
  if(receipt.schemaVersion!=='presenter-image-artifact.v1'||receipt.identityHash!==identityHash||receipt.provider!==input.intent.provider||receipt.model!==input.intent.model
   ||!['image/jpeg','image/png','image/webp'].includes(receipt.mimeType)||!receipt.providerRequestId?.trim())throw Error('presenter_image_artifact_binding_changed');
  let bytes:Buffer;
  try{bytes=await fs.readFile(imageFile);}catch{throw Error('presenter_image_artifact_bytes_missing');}
  const receiptRef=`${receipt.provider}:${receipt.providerRequestId}:${hash(bytes)}`;
  if(hash(bytes)!==receipt.outputSha256||receipt.receiptRef!==receiptRef)throw Error('presenter_image_artifact_bytes_changed');
  const original=await input.permit.assertRecovery(input.intent.operationId);
  if(original.submission.inputContractHash!==input.intent.inputContractHash)throw Error('presenter_image_artifact_binding_changed');
  if(original.status==='completed'&&original.receiptRef!==receiptRef)throw Error('presenter_image_artifact_receipt_changed');
  // A crash can happen after local receipt persistence and before ledger write.
  // This settles the original claim; it does not submit a new supplier request.
  if(original.status!=='completed'||input.intent.executionBindingPolicy)await input.permit.markOutcome(input.intent.operationId,'completed',receiptRef,{sha256:receipt.outputSha256});
  return{bytes,mimeType:receipt.mimeType,provider:receipt.provider as FirstFrameResult['provider'],model:receipt.model,providerRequestId:receipt.providerRequestId,estimatedCostCny:receipt.estimatedCostCny,receiptRef,reused:true,createdAt:receipt.createdAt??(await fs.stat(receiptFile)).mtime.toISOString()};
 }
 if(input.permit.isProvenUnsubmitted&&!(await input.permit.isProvenUnsubmitted(input.intent.operationId)))throw Error('presenter_image_artifact_recovery_required');
 const binding=input.intent.executionBindingPolicy?await input.permit.bindExecution({operationId:input.intent.operationId,requestFingerprint:input.requestFingerprint,dependencies:input.parentArtifacts??[]}):null;
 const result=await input.generate(binding?.bindingHash);
 if(result.provider!==input.intent.provider||result.model!==input.intent.model||!result.providerRequestId?.trim()||!result.bytes.length)throw Error('presenter_image_artifact_provider_result_invalid');
 const outputSha256=hash(result.bytes),receiptRef=`${result.provider}:${result.providerRequestId}:${outputSha256}`,createdAt=new Date().toISOString();
 await atomicWrite(imageFile,result.bytes);
 await atomicWrite(receiptFile,JSON.stringify({schemaVersion:'presenter-image-artifact.v1',identityHash,outputSha256,mimeType:result.mimeType,provider:result.provider,model:result.model,providerRequestId:result.providerRequestId,receiptRef,estimatedCostCny:result.estimatedCostCny,createdAt} satisfies ImageReceipt));
 await input.permit.markOutcome(input.intent.operationId,'completed',receiptRef,{sha256:outputSha256});
 return{...result,receiptRef,reused:false,createdAt};
}

interface InspectionResult {
 evaluation:StoryboardFirstFrameQualityEvaluation;
 providerReceipt:unknown;
 reportHash:string;receiptRef:string;
}
/** Independent QA is another paid operation. Re-reading a completed report
 * must not submit the same Qwen operation again or overwrite a failed report.
 */
export async function preparePaidPresenterInspection(input:{
 scope:SocialTaskBudgetScope;intent:SocialPaidOperationIntent;inputFingerprint:string;
 root:string;permit:Permit;parentArtifacts?:SocialPaidExecutionDependency[];
 evaluate:(executionBindingHash?:string)=>Promise<Pick<InspectionResult,'evaluation'|'providerReceipt'>>;
}):Promise<InspectionResult>{
 const identityHash=artifactIdentity({scope:input.scope,intent:input.intent,inputFingerprint:input.inputFingerprint},input.intent);
 const receiptFile=path.join(input.root,hash(input.scope.tenantId),`${identityHash}.qa.json`);
 let cached:(InspectionResult&{identityHash:string;schemaVersion:string})|null=null;
 try{cached=JSON.parse(await fs.readFile(receiptFile,'utf8'));}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('presenter_inspection_artifact_corrupt');}
 if(cached){
  const reportHash=hash(JSON.stringify({evaluation:cached.evaluation,providerReceipt:cached.providerReceipt}));
  const id=String((cached.providerReceipt as {id?:unknown})?.id||'').trim();
  if(cached.schemaVersion!=='presenter-inspection-artifact.v1'||cached.identityHash!==identityHash||!id||cached.reportHash!==reportHash||cached.receiptRef!==`qwen:${id}:${reportHash}`)throw Error('presenter_inspection_artifact_changed');
  const prior=await input.permit.assertRecovery(input.intent.operationId);
  if(prior.submission.inputContractHash!==input.intent.inputContractHash||(prior.status==='completed'&&prior.receiptRef!==cached.receiptRef))throw Error('presenter_inspection_artifact_receipt_changed');
  if(prior.status!=='completed'||input.intent.executionBindingPolicy)await input.permit.markOutcome(input.intent.operationId,'completed',cached.receiptRef,{sha256:cached.reportHash});
  return cached;
 }
 if(input.permit.isProvenUnsubmitted&&!(await input.permit.isProvenUnsubmitted(input.intent.operationId)))throw Error('presenter_inspection_artifact_recovery_required');
 const binding=input.intent.executionBindingPolicy?await input.permit.bindExecution({operationId:input.intent.operationId,requestFingerprint:input.inputFingerprint,dependencies:input.parentArtifacts??[]}):null;
 const result=await input.evaluate(binding?.bindingHash),id=String((result.providerReceipt as {id?:unknown})?.id||'').trim();
 if(!id)throw Error('presenter_first_frame_qa_receipt_missing');
 const reportHash=hash(JSON.stringify({evaluation:result.evaluation,providerReceipt:result.providerReceipt})),receiptRef=`qwen:${id}:${reportHash}`;
 await atomicWrite(receiptFile,JSON.stringify({...result,identityHash,schemaVersion:'presenter-inspection-artifact.v1',reportHash,receiptRef}));
 await input.permit.markOutcome(input.intent.operationId,'completed',receiptRef,{sha256:reportHash});
 return{...result,reportHash,receiptRef};
}
