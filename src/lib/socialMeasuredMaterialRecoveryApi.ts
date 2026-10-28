import {authHeader, getToken} from './auth';

export type MaterialRecoveryCommand = {action:'resume_material_supply';jobId:string;runId:string;expectedVersion:string;slotId:string;materialId:string};
export type MaterialRecoveryReceipt = {taskId:string;runId:string;jobId:string;status:string};

export class MaterialRecoveryRejected extends Error {}

/** Submit only a frozen original task, run, slot and library record. */
export async function recoverMeasuredMaterial(taskId:string, command:MaterialRecoveryCommand, operationKey:string):Promise<MaterialRecoveryReceipt> {
  const token=getToken();
  if(!token)throw Error('请登录后继续原任务。');
  const response=await fetch(`/api/overseas/starter-198/social-content/tasks/${encodeURIComponent(taskId)}/recover-execution`,{
    method:'POST',headers:{...authHeader(),'Content-Type':'application/json','Idempotency-Key':operationKey},
    body:JSON.stringify(command),cache:'no-store',redirect:'error',
  });
  const body:unknown=await response.json().catch(()=>null);
  if(getToken()!==token)throw Error('登录身份已变化，请重新读取原任务。');
  if(!response.ok){const b=body as {message?:unknown;code?:unknown}|null;throw new (response.status>=400&&response.status<500?MaterialRecoveryRejected:Error)(typeof b?.message==='string'?b.message:typeof b?.code==='string'?b.code:'恢复结果待核验。');}
  const b=body as Record<string,unknown>|null;
  if(!b||b.taskId!==taskId||b.runId!==command.runId||b.jobId!==command.jobId||typeof b.status!=='string')throw Error('恢复回执与原任务不一致，请重新读取原任务。');
  return b as MaterialRecoveryReceipt;
}
