import {WEEKLY_TASK_WORKSPACE_SCHEMA_VERSION,type WeeklyTaskWorkspace} from '../../shared/contracts/weeklyTaskWorkspace';
import {authHeader,getToken} from './auth';

export type WeeklyTaskWorkspaceScope={programId:string;packageId:string;packageVersion:number;executionTaskId:string};

export class WeeklyTaskWorkspaceApiError extends Error{
  constructor(readonly status:number,readonly code:string,message:string){super(message);this.name='WeeklyTaskWorkspaceApiError';}
}

async function responseBody(response:Response):Promise<Record<string,unknown>>{
  const body:unknown=await response.json().catch(()=>({}));
  return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
}

export function parseWeeklyTaskWorkspace(value:unknown,scope:WeeklyTaskWorkspaceScope):WeeklyTaskWorkspace {
  const item=value as WeeklyTaskWorkspace|null;
  if(!item||item.schemaVersion!==WEEKLY_TASK_WORKSPACE_SCHEMA_VERSION||Object.entries(scope).some(([key,expected])=>item[key as keyof WeeklyTaskWorkspace]!==expected)||!item.tenantId||!item.workspaceId||!item.taskIdempotencyKey||!Array.isArray(item.upstreamTaskIds)||item.upstreamTaskIds.some(id=>typeof id!=='string')||!Array.isArray(item.resultRefs)||!Array.isArray(item.blockingCodes)||!item.runtime||!Array.isArray(item.runtime.pauseReasons)||!Array.isArray(item.runtime.completedWork)||!Array.isArray(item.runtime.actualCost?.evidenceRefs)||!Array.isArray(item.runtime.checkpoints)||!Array.isArray(item.runtime.nextActions)||!Array.isArray(item.runtime.recovery?.providerReceipts))throw new WeeklyTaskWorkspaceApiError(409,'weekly_task_workspace_identity_changed','任务生产现场与当前周包或执行任务不一致，请刷新后重试。');
  return item;
}

export async function readWeeklyTaskWorkspace(scope:WeeklyTaskWorkspaceScope):Promise<WeeklyTaskWorkspace>{
  const token=getToken();
  if(!token)throw Error('请登录后读取任务生产现场。');
  const response=await fetch(`/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/execution-tasks/${encodeURIComponent(scope.executionTaskId)}/workspace?version=${scope.packageVersion}`,{headers:authHeader(),cache:'no-store',redirect:'error'});
  const body=await responseBody(response);
  if(getToken()!==token)throw Error('登录身份变化，请重新打开任务生产现场。');
  if(!response.ok)throw new WeeklyTaskWorkspaceApiError(response.status,String(body.code??body.error??''),String(body.message??'任务生产现场读取失败。'));
  return parseWeeklyTaskWorkspace(body.item,scope);
}

export async function backfillWeeklyTaskWorkspaces(scope:Omit<WeeklyTaskWorkspaceScope,'executionTaskId'>):Promise<void>{
  const token=getToken();
  if(!token)throw Error('请登录后补建任务生产现场。');
  const response=await fetch(`/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/task-workspaces/backfill`,{method:'POST',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify({packageVersion:scope.packageVersion}),cache:'no-store',redirect:'error'});
  const body=await responseBody(response);
  if(getToken()!==token)throw Error('登录身份变化，请重新打开任务生产现场。');
  if(!response.ok)throw new WeeklyTaskWorkspaceApiError(response.status,String(body.code??body.error??''),String(body.message??'历史任务生产现场补建失败。'));
}

/** A user opening an old persisted task explicitly authorizes repairing its missing workspace. */
export async function readOrRepairWeeklyTaskWorkspace(scope:WeeklyTaskWorkspaceScope):Promise<WeeklyTaskWorkspace>{
  try{return await readWeeklyTaskWorkspace(scope);}catch(error){
    if(!(error instanceof WeeklyTaskWorkspaceApiError)||error.code!=='weekly_task_workspace_missing')throw error;
    await backfillWeeklyTaskWorkspaces(scope);
    return readWeeklyTaskWorkspace(scope);
  }
}
