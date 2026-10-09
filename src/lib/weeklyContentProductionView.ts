import type {WeeklyContentNavigation} from '../../shared/contracts/weeklyContentNavigation';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow';
import type {SocialSceneReworkAvailability} from '../../shared/contracts/socialSceneRework';
import {readWeeklyContentNavigation} from './weeklyContentNavigationApi';
import {socialContentApi} from './socialContentApi';
import {socialSceneReworkApi} from './socialSceneReworkApi';

export async function loadWeeklyContentProductionView(target:WeeklyContentNavigation, ports={read:readWeeklyContentNavigation,task:socialContentApi.getTask,scenes:socialSceneReworkApi.availability}) {
  const binding=await ports.read(target.scope);
  if(Object.entries(target.scope).some(([key,value])=>binding.scope[key as keyof typeof binding.scope]!==value)||binding.contentTaskId!==target.contentTaskId||binding.runId!==target.runId||binding.publicationTaskId!==target.publicationTaskId||binding.bindingKey!==target.bindingKey||(target.artifactRef&&(!binding.artifactRef||binding.artifactRef.type!==target.artifactRef.type||binding.artifactRef.id!==target.artifactRef.id||binding.artifactRef.version!==target.artifactRef.version)))throw Error('原生产绑定已变化，请返回周任务刷新。');
  const task:SocialContentTaskDetail=await ports.task(binding.contentTaskId);
  if(task.taskId!==binding.contentTaskId||task.brief.programRef?.id!==binding.scope.programId)throw Error('生产页面内容任务身份不一致。');
  const ref=binding.artifactRef;
  const matches=ref?task.artifacts.filter(a=>a.taskId===binding.contentTaskId&&a.artifactId===ref.id&&Number(a.version.replace(/^v/,''))===ref.version&&a.kind==='short_video'&&a.origin==='agent'):[];
  if(ref&&matches.length!==1)throw Error('原成片版本不存在或不唯一，不替换为最新成片。');
  if(!ref&&task.runId!==binding.runId)throw Error('原生产运行已变化，尚无对应成片凭据。');
  let scenes:SocialSceneReworkAvailability|null=null;
  if(ref)scenes=await ports.scenes({tenantId:binding.scope.tenantId,taskId:binding.contentTaskId,sourceRunId:binding.runId,parentArtifactId:ref.id});
  return {binding,task,artifact:matches[0]??null,scenes,historical:task.runId!==binding.runId};
}
