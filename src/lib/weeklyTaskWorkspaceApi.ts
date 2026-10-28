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
  if(item.runtime.pendingMaterials!==undefined&&(!Array.isArray(item.runtime.pendingMaterials)||item.runtime.pendingMaterials.some(slot=>!slot||typeof slot.shotId!=='string'||!slot.shotId.trim()||!['factory','product','consumer_demo','general'].includes(slot.theme)||!Number.isFinite(slot.requiredSeconds)||slot.requiredSeconds<=0||slot.reason!=='awaiting_theme_material')||new Set(item.runtime.pendingMaterials.map(slot=>slot.shotId)).size!==item.runtime.pendingMaterials.length))throw new WeeklyTaskWorkspaceApiError(409,'weekly_task_workspace_identity_changed','待补分镜证据无效，请刷新后重试。');
  if(item.runtime.initialMaterialBlocks!==undefined&&(!Array.isArray(item.runtime.initialMaterialBlocks)||item.runtime.initialMaterialBlocks.some(slot=>!slot||typeof slot.shotId!=='string'||!/^[\w:.-]{1,120}$/.test(slot.shotId)||(slot.reason==='awaiting_shoot'?slot.materialType!=='talking_head'||typeof slot.shootingTaskId!=='string'||!/^[\w:.-]{1,200}$/.test(slot.shootingTaskId):slot.reason!=='awaiting_theme_material'||slot.shootingTaskId!==null||!['factory','product','consumer_demo','general'].includes(slot.materialType))||(slot.referenceDurationSeconds!==null&&(!Number.isFinite(slot.referenceDurationSeconds)||slot.referenceDurationSeconds<=0||slot.referenceDurationSeconds>30)))||new Set(item.runtime.initialMaterialBlocks.map(slot=>slot.shotId)).size!==item.runtime.initialMaterialBlocks.length))throw new WeeklyTaskWorkspaceApiError(409,'weekly_task_workspace_identity_changed','初始素材受阻证据无效，请刷新后重试。');
  if(item.runtime.preRunMaterialRequests!==undefined&&(!Array.isArray(item.runtime.preRunMaterialRequests)||item.runtime.preRunMaterialRequests.some(request=>!request||typeof request.requestId!=='string'||!request.requestId.trim()||typeof request.requirement!=='string'||!request.requirement.trim()||request.requirement.length>500||!['missing','pending_verification','accepted','rejected','cancelled'].includes(request.status))||new Set(item.runtime.preRunMaterialRequests.map(request=>request.requestId)).size!==item.runtime.preRunMaterialRequests.length))throw new WeeklyTaskWorkspaceApiError(409,'weekly_task_workspace_identity_changed','素材请求证据无效，请刷新后重试。');
  const quality=item.runtime.videoQuality;
  if(quality!==undefined&&quality!==null&&(!/^[a-f0-9]{64}$/.test(quality.mediaSha256)||(quality.qualityInputHash!==undefined&&!/^[a-f0-9]{64}$/.test(quality.qualityInputHash))||!['passed','blocked','unknown'].includes(quality.subtitleStatus)||!['passed','blocked','unknown'].includes(quality.timelineStatus)||!Array.isArray(quality.samples)||quality.samples.length>3||quality.samples.some(sample=>!sample||(sample.frameSha256!==undefined&&!/^[a-f0-9]{64}$/.test(sample.frameSha256))||!Number.isFinite(sample.atSeconds)||sample.atSeconds<0||sample.atSeconds>30||[sample.subtitlePresent,sample.font,sample.fontSize,sample.color].some(value=>value!==null&&typeof value!=='boolean'))))throw new WeeklyTaskWorkspaceApiError(409,'weekly_task_workspace_identity_changed','成片检查证据无效，请刷新后重试。');
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

export async function acceptWeeklyUnknownVideoQuality(scope:WeeklyTaskWorkspaceScope,input:{expectedJobId:string;expectedRunId:string;expectedMediaSha256:string;confirmSubtitleStyle?:true}):Promise<void>{
  const token=getToken();if(!token)throw Error('请登录后接受当前成片偏差。');
  const response=await fetch(`/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/execution-tasks/${encodeURIComponent(scope.executionTaskId)}/video-quality/accept-unknown`,{method:'POST',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify({packageVersion:scope.packageVersion,...input,acceptUnknown:true}),cache:'no-store',redirect:'error'});
  const body=await responseBody(response);if(getToken()!==token)throw Error('登录身份变化，请重新打开任务生产现场。');
  if(!response.ok)throw new WeeklyTaskWorkspaceApiError(response.status,String(body.code??body.error??''),String(body.message??'接受当前成片偏差失败。'));
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

/** Authenticated bytes for the exact currently blocked film; never a public
 * cache-path URL. A changed account or aborted view cannot consume the reply. */
export async function readWeeklyVideoQualityMedia(scope:WeeklyTaskWorkspaceScope,input:{expectedJobId:string;expectedRunId:string;expectedMediaSha256:string;expectedQualityInputHash:string;frameSha256?:string},signal?:AbortSignal):Promise<Blob>{
  const token=getToken();if(!token)throw Error('请登录后查看当前成片。');
  const query=new URLSearchParams({version:String(scope.packageVersion),jobId:input.expectedJobId,runId:input.expectedRunId,
    mediaSha256:input.expectedMediaSha256,qualityInputHash:input.expectedQualityInputHash,...(input.frameSha256?{frameSha256:input.frameSha256}:{})});
  const response=await fetch(`/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/execution-tasks/${encodeURIComponent(scope.executionTaskId)}/video-quality/media?${query}`,{headers:authHeader(),cache:'no-store',redirect:'error',signal});
  if(getToken()!==token||signal?.aborted)throw Error('登录身份或任务已变化，请重新打开成片预览。');
  if(!response.ok){const body=await responseBody(response);throw new WeeklyTaskWorkspaceApiError(response.status,String(body.code??body.error??''),String(body.message??'当前成片预览读取失败。'));}
  const blob=await response.blob(),expected=input.frameSha256?'image/png':'video/mp4';
  if(getToken()!==token||signal?.aborted)throw Error('登录身份或任务已变化，请重新打开成片预览。');
  if(blob.type!==expected||!blob.size)throw new WeeklyTaskWorkspaceApiError(409,'weekly_video_quality_media_invalid','当前成片预览内容无效，请刷新后重试。');
  return blob;
}
