import {verifiedProductionSlots} from './socialSceneReworkNavigation';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow';
import type {SocialSceneReworkAvailability} from '../../shared/contracts/socialSceneRework';
export interface ScopedSceneTarget {tenantId:string;programId:string;packageId:string;packageVersion:number;executionTaskId:string;contentTaskId:string;contentTaskVersion:string;sourceRunId:string;parentArtifactId:string;sceneId:string;projectId:string}
export function parseScopedSceneTarget(value:unknown):ScopedSceneTarget|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(!['tenantId','programId','packageId','executionTaskId','contentTaskId','contentTaskVersion','sourceRunId','parentArtifactId','sceneId','projectId'].every(k=>typeof v[k]==='string'&&(v[k] as string).trim().length>0)||!Number.isSafeInteger(v.packageVersion)||(v.packageVersion as number)<1)return null;
 return v as unknown as ScopedSceneTarget;
}
export function validateScopedSceneTarget(target:ScopedSceneTarget,tasks:WeeklyExecutionTask[],task:SocialContentTaskDetail,project:{id:string;spec?:Record<string,unknown>},availability:SocialSceneReworkAvailability){
 const matches=tasks.filter(t=>t.tenantId===target.tenantId&&t.programId===target.programId&&t.packageId===target.packageId&&t.packageVersion===target.packageVersion&&t.taskId===target.executionTaskId);
 if(matches.length!==1||matches[0]!.workflowKind!=='content'||matches[0]!.productionProgress?.contentTaskId!==target.contentTaskId||matches[0]!.productionProgress?.runId!==target.sourceRunId||task.taskId!==target.contentTaskId||task.version!==target.contentTaskVersion||task.runId!==target.sourceRunId||task.brief.programRef?.id!==target.programId||task.agentWorkflow?.weeklyPackage?.packageId!==target.packageId||task.agentWorkflow?.weeklyPackage?.version!==String(target.packageVersion)||project.id!==target.projectId||project.spec?.socialContentTaskId!==target.contentTaskId||availability.tenantId!==target.tenantId||availability.taskId!==target.contentTaskId||availability.sourceRunId!==target.sourceRunId||availability.parentArtifactId!==target.parentArtifactId||task.artifacts.filter(a=>a.taskId===task.taskId&&a.artifactId===target.parentArtifactId&&a.origin==='agent').length!==1)throw Error('受阻任务、周包版本、视频或原成片身份不一致。请返回原周任务核对真实上游。');
 const slots=verifiedProductionSlots(availability,project);
 if(slots.filter(s=>s.sourceSceneId===target.sceneId).length!==1)throw Error('指定失败镜头缺少真实生产快照槽位。');
 const scenes=availability.scenes.filter(s=>s.sceneId===target.sceneId&&s.status==='failed');
 if(scenes.length!==1)throw Error('指定失败分镜不存在、已恢复或缺少唯一核验凭据。请返回原周任务读取最新状态。');
 return scenes[0]!;
}
export function sceneStudioNavigationDetail(target:ScopedSceneTarget){return {page:'smartAssets',view:'create',directStudio:true,socialContentTaskId:target.contentTaskId,socialContentPage:'smartAssets',sceneTarget:target};}
