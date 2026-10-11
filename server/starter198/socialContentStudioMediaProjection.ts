import type {DataStore} from '../storage/datastore.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {socialJson,socialObject,socialRequestHash} from './socialContentValidation.js';
import {createPersistedStudioReceiptAdoptionAdapter,type StudioAdoptionScope} from './socialContentStudioAdoption.js';
import {frozenStudioProjectSpec} from './socialContentStudioFrozenBridge.js';
/** Projects a verified completed candidate for viewing. It neither assigns a shot nor approves an artifact. */
export async function projectFrozenStudioAdoptedMedia(input:{dataStore:DataStore;scope:StudioAdoptionScope;projectId:string;shotId:string;expectedUpdatedAt:string;dryRun?:boolean;registerMedia:(asset:{filePath:string;sha256:string;providerTaskId:string})=>Promise<{fileRef:string;url:string}>}){
 const {scope}=input,project=await input.dataStore.getById<any>('studio_projects',input.projectId),spec=frozenStudioProjectSpec(project?.spec),contract=socialObject(spec.resolvedStudioContract);
 if(!project||project.tenant_id!==scope.tenantId||contract?.taskId!==scope.taskId||contract.runId!==scope.runId||contract.jobId!==scope.jobId)throw Error('studio_media_projection_scope_changed');
 const job=await readContentExecutionJob(input.dataStore,scope.tenantId,scope.taskId,scope.runId),binding=socialObject(job?.checkpoints['social.executor']?.payload),approved=socialObject(binding?.approvedContext);
 const shot=(approved?.assetSupplyPlan as any)?.shots?.find((s:any)=>s.shotId===input.shotId);
 if(!shot||job?.id!==scope.jobId||contract.inputHash!==binding?.inputHash||contract.planHash!==approved?.revisionPlanHash)throw Error('studio_media_projection_frozen_binding_changed');
 const result=await createPersistedStudioReceiptAdoptionAdapter({dataStore:input.dataStore,scope}).execute({tenantId:scope.tenantId,taskId:scope.taskId,shot,baselineScene:{} as any,availableAssets:[],outputDirectory:''});
 if(!result?.asset.localPath||!result.asset.contentHash||!result.asset.providerTaskId)throw Error('studio_media_projection_completed_proof_missing');
 const previous=socialObject(contract.adoptedAssets)?.[input.shotId] as any;
 if(previous?.sha256===result.asset.contentHash&&previous?.providerTaskId===result.asset.providerTaskId)return {replayed:true,media:previous};
 if(String(project.updated_at||project.updated||'')!==input.expectedUpdatedAt)throw Error('studio_project_version_conflict');
 const evidence={providerTaskId:result.asset.providerTaskId,sha256:result.asset.contentHash,durationSeconds:result.asset.duration,shotId:input.shotId,qualityEvidence:result.asset.segments.at(-1),humanApproved:false,artifactCompleted:false};
 if(input.dryRun)return {replayed:false,dryRun:true,media:evidence};
 const file=await input.registerMedia({filePath:result.asset.localPath,sha256:result.asset.contentHash,providerTaskId:result.asset.providerTaskId});
 if(!file.fileRef||!file.url)throw Error('studio_media_projection_file_missing');
 const media={...evidence,...file},nextContract={...contract,adoptedAssets:{...socialObject(contract.adoptedAssets),[input.shotId]:media}},next={...spec,resolvedStudioContract:nextContract};
 if(!input.dataStore.compareAndSwap||!await input.dataStore.compareAndSwap('studio_projects',input.projectId,{tenant_id:scope.tenantId,updated_at:input.expectedUpdatedAt},{spec:next,updated_at:new Date().toISOString()}))throw Error('studio_project_version_conflict');
 const saved=await input.dataStore.getById<any>('studio_projects',input.projectId);
 if(socialRequestHash(socialObject(socialJson(saved?.spec))?.resolvedStudioContract??null)!==socialRequestHash(nextContract))throw Error('studio_media_projection_unconfirmed');
 return {replayed:false,media};
}
