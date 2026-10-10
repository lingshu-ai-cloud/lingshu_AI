import { authHeader } from './auth';
import type { WeeklyCustomerRunCandidate } from '../../server/runtime/socialWeeklyCustomerBridge';
export type { WeeklyCustomerRunCandidate };
const path = (programId: string, packageId: string) => `/api/overseas/social-programs/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}`;
async function request<T>(url: string, body?: unknown): Promise<T> {
  const headers = authHeader();
  const response = await fetch(url, { method:body ? 'POST' : 'GET', headers:{...headers,...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {}) });
  const result=await response.json().catch(()=>{throw new Error('客服接口未返回有效数据，请检查本地服务。');});
  if (headers.Authorization !== authHeader().Authorization) throw new Error('登录身份已改变，请重新读取原客服运行。');
  if (!response.ok) throw new Error(result.message || result.error || '客服生产运行读取或绑定失败，请检查周包版本和运行归属。');
  return result as T;
}
export const weeklyCustomerRunApi = {
  candidates: async (programId:string,packageId:string,packageVersion:number) => {
    const result = await request<{items:WeeklyCustomerRunCandidate[];boundRunId:string|null}>(`${path(programId,packageId)}/customer-run-candidates?version=${packageVersion}`);
    if (!Array.isArray(result.items) || !result.items.every(item => typeof item.runId === 'string' && item.runId && typeof item.goalId === 'string' && Array.isArray(item.customerTaskKeys)) || !(result.boundRunId === null || typeof result.boundRunId === 'string')) throw new Error('客服接口缺少真实运行列表，请检查本地服务。');
    return result;
  },
  bind: async (programId:string,packageId:string,packageVersion:number,runId:string) => {
    const result = await request<{item:{run_id:string}}>(`${path(programId,packageId)}/customer-run-binding`,{packageVersion,runId});
    if (result.item?.run_id !== runId) throw new Error('客服绑定回执与所选运行不一致，请刷新核验。');
    return result;
  },
};
