import {authHeader,getToken} from './auth';
import type {WeeklyContentNavigationScope} from '../../shared/contracts/weeklyContentNavigation';
export interface WeeklyReferenceReviewTarget {recordId:string;sourceVersion:string;tenantId:string;programId:string;packageId:string;packageVersion:number;contentTaskId:string;executionTaskId:string}
export function parseWeeklyReferenceReviewTarget(value:unknown,scope:WeeklyContentNavigationScope,recordId:string,contentTaskId:string):WeeklyReferenceReviewTarget {
 const v=value as WeeklyReferenceReviewTarget|null;
 if(!v||v.recordId!==recordId||v.contentTaskId!==contentTaskId||v.executionTaskId!==scope.executionTaskId||v.tenantId!==scope.tenantId||v.programId!==scope.programId||v.packageId!==scope.packageId||v.packageVersion!==scope.packageVersion||!Number.isSafeInteger(v.packageVersion)||v.packageVersion<1||typeof v.sourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceVersion))throw Error('参考绑定与当前周任务不一致，请重新读取任务。');
 return v;
}
export async function readWeeklyReferenceReviewNavigation(scope:WeeklyContentNavigationScope,recordId:string,contentTaskId:string){
 const token=getToken();if(!token)throw Error('请登录后读取原参考。');
 const r=await fetch(`/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/execution-tasks/${encodeURIComponent(scope.executionTaskId)}/reference-review-navigation?version=${scope.packageVersion}&recordId=${encodeURIComponent(recordId)}`,{headers:authHeader(),cache:'no-store',redirect:'error'});
 const v=await r.json();if(getToken()!==token)throw Error('登录身份变化，请重新读取任务。');if(!r.ok)throw Error(v?.message??'原参考核验失败。');return parseWeeklyReferenceReviewTarget(v.item,scope,recordId,contentTaskId);
}
