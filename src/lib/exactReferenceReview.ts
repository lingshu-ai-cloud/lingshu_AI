/** Weekly sourceVersion belongs to the canonical weekly source, not a shot-review version. */
export interface ExactReferenceReviewTarget {
  recordId:string; executionTaskId:string; sourceVersion:string; tenantId:string; programId:string;
  packageId:string; packageVersion:number; contentTaskId:string;
}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
export function hasExactReferenceReview(detail:unknown):boolean{return object(detail)&&Object.prototype.hasOwnProperty.call(detail,'exactReferenceReview');}
export function parseExactReferenceReview(detail:unknown):ExactReferenceReviewTarget|null{
 if(!object(detail)||!object(detail.exactReferenceReview))return null;
 const target=detail.exactReferenceReview;
 for(const key of ['recordId','executionTaskId','sourceVersion','tenantId','programId','packageId','contentTaskId'])if(typeof target[key]!=='string'||!target[key]||target[key]!==target[key].trim())return null;
 if(typeof target.sourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(target.sourceVersion))return null;
 if(!Number.isSafeInteger(target.packageVersion)||Number(target.packageVersion)<=0)return null;
 return {recordId:target.recordId as string,executionTaskId:target.executionTaskId as string,sourceVersion:target.sourceVersion as string,tenantId:target.tenantId as string,programId:target.programId as string,packageId:target.packageId as string,packageVersion:Number(target.packageVersion),contentTaskId:target.contentTaskId as string};
}
/** Presence, including malformed targets, excludes legacy fuzzy navigation. */
export function allowsLegacyReferenceNavigation(detail:unknown):boolean{return !hasExactReferenceReview(detail);}

export async function loadExactReferenceReview(target:ExactReferenceReviewTarget,ports:{token:()=>string|null;verify:(target:ExactReferenceReviewTarget)=>Promise<ExactReferenceReviewTarget>;fetch:typeof fetch}){
 const token=ports.token();if(!token)throw Error('reference_review_login_required');
 const check=()=>{if(ports.token()!==token)throw Error('reference_review_login_changed');};
 const current=await ports.verify(target);check();
 for(const key of Object.keys(target) as Array<keyof ExactReferenceReviewTarget>)if(current[key]!==target[key])throw Error('reference_review_source_changed');
 const r=await ports.fetch(`/api/overseas/videos/${encodeURIComponent(target.recordId)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error'});
 const record:unknown=await r.json();check();
 if(!r.ok||!object(record)||record.id!==target.recordId||record.tenantId!==target.tenantId||record.canManage!==true)throw Error('reference_review_record_not_owned');
 const h=await ports.fetch(`/api/overseas/videos/${encodeURIComponent(target.recordId)}/review-handoff`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error'});
 const handoff:unknown=await h.json();check();if(!h.ok||!object(handoff)||handoff.referenceRecordId!==target.recordId||!Array.isArray(handoff.shots)||!Array.isArray(handoff.issues)||typeof handoff.productionExecutionAllowed!=='boolean'||!['review_only','production_ready'].includes(String(handoff.status)))throw Error('reference_review_handoff_unavailable');
 // Recheck canonical source after both exact reads; review and weekly source versions differ.
 const fresh=await ports.verify(target);check();for(const key of Object.keys(target) as Array<keyof ExactReferenceReviewTarget>)if(fresh[key]!==target[key])throw Error('reference_review_source_changed');
 return {record,handoff};
}

export function exactReferenceReviewErrorMessage(error:unknown):string {
 const code=error instanceof Error?error.message:'';
 if(code.includes('login'))return '登录身份已变化或未登录，请重新登录并从原周任务打开参考审核。';
 if(code.includes('source_changed'))return '原周参考版本已变化，请返回任务日历重新读取，不能审核其他版本。';
 if(code.includes('record_not_owned'))return '原参考不存在或当前账号无管理权限，请返回原周任务核对参考来源。';
 if(code.includes('handoff'))return '原参考审核交接不可用或记录身份不一致，请返回原周任务重新核验。';
 return '原参考核验失败，请返回原周任务重新打开；不会改为其他参考。';
}
