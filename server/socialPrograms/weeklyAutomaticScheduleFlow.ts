import type {DataStore,Record_} from '../storage/datastore.js';
import {createWeeklyExecutionPipelineService} from './weeklyExecutionPipeline.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {supplementConsumerHash} from './weeklySupplementRequests.js';
import {bindWeeklyPreproductionAuthority} from '../runtime/weeklyPreproductionProducer.js';
import {SocialProgramError} from './service.js';
import type {SocialDiscoveryMode} from '../../shared/contracts/socialContentWorkflow.js';

export interface WeeklyAutomaticExecutionScope {
  tenantId:string;
  actorUserId:string;
  programId:string;
  packageId:string;
  packageVersion:number;
}

export interface ApprovedWeeklyDiscoveryAuthority {
  scopeId:string;
  scopeVersion:number;
  requestedModes:SocialDiscoveryMode[];
}

export async function uniqueApprovedWeeklyDiscoveryAuthority(
  store:DataStore,
  tenantId:string,
):Promise<ApprovedWeeklyDiscoveryAuthority|null>{
  const scopes=await store.list<Record_>('social_discovery_scopes',{where:{tenant_id:tenantId,status:'active'},perPage:20});
  const approved=scopes.items.filter(row=>{
    const payload=row.payload as any;
    return payload?.approval?.status==='approved'&&payload.approval.scopeVersion===row.version&&Array.isArray(payload?.discoveryBrief?.discoveryModes);
  });
  if(approved.length!==1)return null;
  const row=approved[0]!,payload=row.payload as any;
  const revision=payload.weeklyAccountRevision;
  if(revision){
    // The account revision replaces, rather than extends, the inherited
    // multi-platform keyword authority for this weekly package.
    if(revision.targetCount!==5||typeof revision.accountUrl!=='string'||
      payload.discoveryBrief.weeklyAccountCollectionTarget?.accountUrl!==revision.accountUrl||
      payload.discoveryBrief.weeklyAccountCollectionTarget?.targetCount!==5||
      !payload.discoveryBrief.discoveryModes.includes('account')||
      payload.discoveryBrief.modePolicies?.account?.enabled!==true)return null;
    return {scopeId:String(row.id),scopeVersion:Number(row.version),requestedModes:['account']};
  }
  const requestedModes=[...new Set(payload.discoveryBrief.discoveryModes)]
    .filter((mode):mode is SocialDiscoveryMode=>['momentum','account','innovation'].includes(String(mode)));
  if(!requestedModes.length)return null;
  return {scopeId:String(row.id),scopeVersion:Number(row.version),requestedModes};
}

/**
 * Shared post-schedule boundary used by both the authenticated route and
 * server-owned scope recovery. It reuses the exact local consumer, admission,
 * task graph and preproduction binding contracts; it creates no parallel flow.
 */
export async function connectAndBindWeeklyAutomaticSchedule(
  store:DataStore,
  scope:WeeklyAutomaticExecutionScope,
  discovery?:ApprovedWeeklyDiscoveryAuthority|null,
  activation:'ordinary'|'scoped'='ordinary',
){
  const pipeline=createWeeklyExecutionPipelineService(store);
  if(activation==='scoped')await pipeline.connectScopedLocalConsumer(scope);
  else await pipeline.connectLocalConsumer(scope);
  const launched=await pipeline.startIndependent(scope);
  const tasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,scope.packageVersion);
  const outline=tasks.filter(task=>task.schedule.stepKind==='business_outline');
  if(outline.length!==1)throw new SocialProgramError('weekly_template_outline_consumer_invalid',409,'周任务缺少唯一经营提纲消费者。');
  await bindWeeklyPreproductionAuthority({store,...scope,taskId:outline[0]!.taskId,kind:'outline',expectedConsumerInputHash:supplementConsumerHash(outline[0]!)});
  const authority=discovery===undefined?await uniqueApprovedWeeklyDiscoveryAuthority(store,scope.tenantId):discovery;
  if(authority){
    for(const task of tasks.filter(task=>task.schedule.stepKind==='benchmark_collection')){
      await bindWeeklyPreproductionAuthority({store,...scope,taskId:task.taskId,kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(task),discovery:authority});
    }
  }
  // This is the only immediate scan in the scoped activation path. The
  // ordinary route keeps its historical connect/start behavior intact.
  if(activation==='scoped')await pipeline.scanScopedLocalConsumer(scope);
  return {launched,tasks,discoveryAuthority:authority??null};
}
