import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase.js';
import {WEEKLY_PRODUCTION_REPAIR_CASES} from '../socialPrograms/weeklyProductionRepairCases.js';
import {WEEKLY_CREATIVE_REPAIR_CONFIGURATIONS,type CreativeRepairConfiguration} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {readWeeklyCancellationReceipt} from '../socialPrograms/weeklyCancellation.js';
import {socialJson,socialObject,socialRequestHash,SocialContentWorkflowError} from '../starter198/socialContentValidation.js';

export interface WeeklyCreativeRepairProof {
 type:'weekly_creative_repair_authority';version:1;tenantId:string;caseId:string;caseRecordHash:string;
 caseRequestHash:string;configurationRecordHash:string;childTaskId:string;parentTaskId:string;parentRunId:string;parentArtifactHash:string;
 packageId:string;packageVersion:number;publicationTaskId:string;originalAuthorityHash:string;issuedAt:string;recordHash:string;
}
type AuthorityContext={proof:WeeklyCreativeRepairProof;authority:Record<string,unknown>;bindingKey:string;repairCase:WeeklyProductionRepairCase;configuration:CreativeRepairConfiguration};
const fail=():never=>{throw new SocialContentWorkflowError('weekly_creative_repair_authority_invalid',409);};
const exact=async<T extends Record_>(store:DataStore,collection:string,where:Record<string,string|number>)=>{const rows=await store.list<T>(collection,{where,perPage:2});if(rows.totalItems!==1||rows.items.length!==1)fail();return rows.items[0]!;};
const verified=<T extends {recordHash:string}>(row:Record_,tenantId:string):T=>{const value=socialObject(socialJson(row.payload)) as unknown as T|null;if(!value||row.tenant_id!==tenantId||row.content_hash!==socialRequestHash(value))fail();const{recordHash,...body}=value;if(recordHash!==socialRequestHash(body))fail();return value;};

async function source(input:{store:DataStore;tenantId:string;caseId:string;now:Date;allowExpired:boolean;requireReady:boolean}){
 const caseRow=await exact(input.store,WEEKLY_PRODUCTION_REPAIR_CASES,{tenant_id:input.tenantId,case_id:input.caseId}),item=verified<WeeklyProductionRepairCase>(caseRow,input.tenantId);
 if(item.tenantId!==input.tenantId||item.caseId!==input.caseId||item.kind!=='creative_revision'||item.trigger.type!=='user_changes_requested'||item.execution&&input.requireReady||!['ready','running','awaiting_audit','resolved'].includes(item.state))fail();
 if(input.requireReady&&item.state!=='ready')fail();
 const configurationRow=await exact(input.store,WEEKLY_CREATIVE_REPAIR_CONFIGURATIONS,{tenant_id:input.tenantId,case_id:input.caseId}),configuration=verified<CreativeRepairConfiguration>(configurationRow,input.tenantId);
 if(configuration.tenantId!==input.tenantId||configuration.caseId!==item.caseId||configuration.parentArtifactHash!==item.parent.artifactHash||configuration.decisionOperationId!==item.trigger.operationId||configuration.feedbackHash!==item.trigger.noteHash||configuration.ownerUserId!==item.ownerUserId||configuration.reviewerUserId!==item.reviewerUserId||configuration.deadlineAt!==item.deadlineAt||configuration.estimatedDurationMinutes!==item.estimatedDurationMinutes||configuration.maximumCostCny!==item.maximumCostCny||!input.allowExpired&&Date.parse(configuration.deadlineAt)<=input.now.getTime())fail();
 if(await readWeeklyCancellationReceipt({dataStore:input.store,tenantId:input.tenantId,programId:item.programId,packageId:item.packageId,packageVersion:item.packageVersion}))fail();
 const packageRow=await exact(input.store,'social_weekly_operating_packages',{tenant_id:input.tenantId,program_id:item.programId,package_id:item.packageId,version:item.packageVersion}),pkg=socialObject(socialJson(packageRow.payload));if(pkg?.programId!==item.programId||pkg.packageId!==item.packageId||pkg.version!==item.packageVersion||pkg.status!=='active'||pkg.executionGraphVersion!==3)fail();
 const parent=await exact(input.store,'starter_social_content_tasks',{tenant_id:input.tenantId,task_id:item.parent.taskId});
 const authority=socialObject(socialObject(socialJson(parent.brief))?._weeklyAuthority);if(!authority||parent.run_id!==item.parent.runId||parent.weekly_plan_id!==item.packageId||parent.create_idempotency_key!==`weekly-production:${item.packageId}:${item.packageVersion}:${item.publicationTaskId}`)fail();
 const frozen=socialObject(authority.weeklyPackage),publication=socialObject(authority.publicationTask);if(frozen?.programId!==item.programId||frozen.packageId!==item.packageId||frozen.version!==item.packageVersion||publication?.publicationTaskId!==item.publicationTaskId)fail();
 const artifact=await exact(input.store,'starter_social_content_artifacts',{tenant_id:input.tenantId,task_id:item.parent.taskId,artifact_id:item.parent.artifactRef.id}),content=socialObject(socialJson(artifact.content));
 if(!content||artifact.content_hash!==item.parent.artifactHash||artifact.content_hash!==socialRequestHash({resourceRef:artifact.resource_ref,content})||artifact.status!=='changes_requested'||artifact.last_operation_id!==item.trigger.operationId)fail();
 const operation=await exact(input.store,'starter_social_content_operations',{tenant_id:input.tenantId,operation_id:item.trigger.operationId});if(operation.operation!=='decide_social_content_artifact'||operation.target_id!==item.parent.taskId||operation.request_hash!==item.trigger.operationRequestHash||!['processing','succeeded'].includes(String(operation.status)))fail();
 return{item,configuration,authority,caseRow,configurationRow};
}

/** Server-only issuer. The returned proof is still revalidated against durable records at every protected entry. */
export async function issueWeeklyCreativeRepairAuthority(input:{store:DataStore;tenantId:string;caseId:string;childTaskId:string;expectedCaseHash:string;expectedConfigurationHash:string;now?:Date}){
 if(!input.childTaskId||input.childTaskId!==input.childTaskId.trim())fail();
 const actual=await source({...input,now:input.now??new Date(),allowExpired:false,requireReady:true});
 if(actual.item.recordHash!==input.expectedCaseHash||actual.configuration.recordHash!==input.expectedConfigurationHash)fail();
 const body={type:'weekly_creative_repair_authority' as const,version:1 as const,tenantId:input.tenantId,caseId:input.caseId,caseRecordHash:actual.item.recordHash,caseRequestHash:actual.item.requestHash,configurationRecordHash:actual.configuration.recordHash,childTaskId:input.childTaskId,parentTaskId:actual.item.parent.taskId,parentRunId:actual.item.parent.runId,parentArtifactHash:actual.item.parent.artifactHash,packageId:actual.item.packageId,packageVersion:actual.item.packageVersion,publicationTaskId:actual.item.publicationTaskId,originalAuthorityHash:socialRequestHash(actual.authority),issuedAt:(input.now??new Date()).toISOString()};
 const proof={...body,recordHash:socialRequestHash(body)},bindingKey=`weekly-creative-repair:${actual.item.packageId}:${actual.item.packageVersion}:${actual.item.publicationTaskId}:${actual.item.caseId}`;
 return{proof,bindingKey,authority:actual.authority};
}

/** Never accepts the embedded authority as sufficient evidence; all server-owned sources are read again. */
export async function resolveWeeklyCreativeRepairAuthority(input:{store:DataStore;tenantId:string;task:Record<string,unknown>;now?:Date}):Promise<AuthorityContext|null>{
 const brief=socialObject(socialJson(input.task.brief)),raw=socialObject(brief?._weeklyCreativeRepairProof);if(!raw)return null;
 const proof=raw as unknown as WeeklyCreativeRepairProof,{recordHash,...body}=proof;
 if(proof.type!=='weekly_creative_repair_authority'||proof.version!==1||recordHash!==socialRequestHash(body)||proof.tenantId!==input.tenantId||input.task.tenant_id!==input.tenantId||input.task.task_id!==proof.childTaskId)fail();
 const bindingKey=`weekly-creative-repair:${proof.packageId}:${proof.packageVersion}:${proof.publicationTaskId}:${proof.caseId}`;if(input.task.create_idempotency_key!==bindingKey)fail();
 const started=Boolean(String(input.task.run_id??'').trim()||String(input.task.orchestrator_item_id??'').trim());
 const actual=await source({store:input.store,tenantId:input.tenantId,caseId:proof.caseId,now:input.now??new Date(),allowExpired:started,requireReady:false});
 if(proof.caseRequestHash!==actual.item.requestHash||proof.configurationRecordHash!==actual.configuration.recordHash||proof.parentTaskId!==actual.item.parent.taskId||proof.parentRunId!==actual.item.parent.runId||proof.parentArtifactHash!==actual.item.parent.artifactHash||proof.packageId!==actual.item.packageId||proof.packageVersion!==actual.item.packageVersion||proof.publicationTaskId!==actual.item.publicationTaskId||proof.originalAuthorityHash!==socialRequestHash(actual.authority)||socialRequestHash(socialObject(brief?._weeklyAuthority))!==socialRequestHash(actual.authority))fail();
 if(!started){if(actual.item.state!=='ready'||actual.item.execution||proof.caseRecordHash!==actual.item.recordHash)fail();}
 else{
  if(!['running','awaiting_audit','resolved'].includes(actual.item.state)||!actual.item.execution)fail();
  const mappingRow=await exact(input.store,'social_weekly_creative_repair_child_executions',{tenant_id:input.tenantId,case_id:proof.caseId}),mapping=socialObject(socialJson(mappingRow.payload));if(!mapping||mappingRow.content_hash!==socialRequestHash(mapping))fail();const mappingHash=mapping.recordHash,{recordHash:_,...mappingBody}=mapping;if(typeof mappingHash!=='string'||mappingHash!==socialRequestHash(mappingBody)||mapping.state!=='running'||mapping.caseRequestHash!==proof.caseRequestHash||mapping.configurationHash!==proof.configurationRecordHash||mapping.parentTaskId!==proof.parentTaskId||mapping.parentRunId!==proof.parentRunId||mapping.parentArtifactHash!==proof.parentArtifactHash||mapping.childTaskId!==proof.childTaskId||mapping.childBindingKey!==bindingKey||mapping.runId!==input.task.run_id||actual.item.execution.operationId!==proof.childTaskId||actual.item.execution.runId!==mapping.runId||actual.item.execution.jobId!==mapping.jobId)fail();
 }
 return{proof,authority:actual.authority,bindingKey,repairCase:actual.item,configuration:actual.configuration};
}
