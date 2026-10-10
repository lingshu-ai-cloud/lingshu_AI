import type {loadWeeklyContentProductionView} from './weeklyContentProductionView';
import type {SocialDirectorG5Scope} from '../../shared/contracts/socialDirectorG5Review';
/** Exact original owned artifact evidence, never the latest task run. */
export function weeklyContentReviewScope(view:Awaited<ReturnType<typeof loadWeeklyContentProductionView>>):SocialDirectorG5Scope|null{
 if(view.historical||!view.artifact||!view.scenes||!view.binding.runId)return null;
 const b=view.binding,a=view.artifact,s=view.scenes;
 if(view.task.taskId!==b.contentTaskId||view.task.runId!==b.runId||a.taskId!==b.contentTaskId||!b.artifactRef||a.artifactId!==b.artifactRef.id||Number(a.version.replace(/^v/,''))!==b.artifactRef.version||s.tenantId!==b.scope.tenantId||s.taskId!==b.contentTaskId||s.sourceRunId!==b.runId||s.parentArtifactId!==a.artifactId)throw Error('原成片审核范围已变化，请刷新周任务。');
 return {tenantId:b.scope.tenantId,taskId:b.contentTaskId,runId:b.runId,artifactId:a.artifactId};
}
