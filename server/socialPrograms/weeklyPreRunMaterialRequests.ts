import type {DataStore, Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';

/** Read-only view of existing frozen requests for the actual blocked consumer.
 * These are request-level facts, not inferred scene labels or verified material. */
export type WeeklyPreRunMaterialRequest = {requestId:string; requirement:string; status:'missing'|'pending_verification'|'accepted'|'rejected'|'cancelled'};
const object=(value:unknown):Record<string,unknown>|null=>{
 try {const parsed=typeof value==='string'?JSON.parse(value):value;return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;}catch{return null;}
};
export async function weeklyPreRunMaterialRequests(store:DataStore,task:WeeklyExecutionTask):Promise<WeeklyPreRunMaterialRequest[]> {
 if(task.status!=='blocked'||task.schedule.stepKind!=='material_readiness'||
  !task.ownBlockingReasons.includes('weekly_required_materials_missing')||!task.publicationTaskId)return [];
 const packages=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,version:task.packageVersion},page:1,perPage:2});
 if(packages.totalItems!==1||packages.items.length!==1)return [];
 const row=packages.items[0]!,pkg=object(row.payload),content=object(pkg?.socialContentPackage);
 if(row.tenant_id!==task.tenantId||row.program_id!==task.programId||row.package_id!==task.packageId||row.version!==task.packageVersion||pkg?.programId!==task.programId||pkg?.packageId!==task.packageId||pkg?.version!==task.packageVersion||!Array.isArray(content?.publicationTasks))return [];
 const publications=content.publicationTasks.map(object).filter(pub=>pub?.publicationTaskId===task.publicationTaskId);
 if(publications.length!==1)return [];
 const contract=object(publications[0]?.materialRequirement),ids=contract?.requestIds;
 if(contract?.required!==true||!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id.trim())||new Set(ids).size!==ids.length)return [];
 const output:WeeklyPreRunMaterialRequest[]=[];
 for(const id of ids as string[]){
  const requestRow=await store.getById<Record_>('social_weekly_material_requests',id),request=object(requestRow?.payload);
  if(!requestRow||requestRow.tenant_id!==task.tenantId||requestRow.program_id!==task.programId||request?.requestId!==id||request.tenantId!==task.tenantId||request.programId!==task.programId||requestRow.status!==request.status||!['missing','pending_verification','accepted','rejected','cancelled'].includes(String(request.status))||!Array.isArray(request.consumers))return [];
  const consumers=request.consumers.map(object).filter(consumer=>consumer?.taskId===task.taskId&&consumer.packageId===task.packageId&&consumer.packageVersion===task.packageVersion);
  if(consumers.length!==1||typeof consumers[0]?.requirement!=='string'||!consumers[0].requirement.trim()||consumers[0].requirement.length>500)return [];
  output.push({requestId:id,requirement:consumers[0].requirement,status:request.status as WeeklyPreRunMaterialRequest['status']});
 }
 return output;
}
