import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../../shared/contracts/socialProgram';
import type {SocialContentTaskDetail} from '../../../shared/contracts/socialContentWorkflow';
import type {SocialSceneReworkAvailability} from '../../../shared/contracts/socialSceneRework';
import {validateScopedSceneTarget,type ScopedSceneTarget} from '../../lib/scopedSceneNavigation';
export {isWeeklyContentNavigationExecution} from '../../../shared/contracts/weeklyContentNavigation';
export const isSceneContentExecution=(task:WeeklyExecutionTask)=>task.workflowKind==='content'&&['material_readiness','asset_generation','video_generation','quality_check','rework'].includes(task.schedule.stepKind);
export function sceneCalendarExecution(pkg:Pick<WeeklyOperatingPackage,'programId'|'packageId'|'version'>,tasks:WeeklyExecutionTask[],card:{id:string;productionTaskId?:string;productionExecutionTaskId?:string}){
 const scoped=tasks.filter(t=>t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version);
 const exact=scoped.filter(t=>t.taskId===(card.productionExecutionTaskId||card.id)&&t.workflowKind==='content');
 if(exact.length!==1||new Set(scoped.map(t=>t.tenantId)).size!==1)throw Error('日历卡与当前租户、周包或真实内容执行任务不一致，请刷新原周任务。');
 const actual=exact[0]!;
 if(!actual.productionProgress?.contentTaskId||!actual.productionProgress.runId)throw Error(`执行任务 ${actual.taskId} 尚未关联真实内容任务或生产运行；请核对上游 ${actual.dependsOnTaskIds.join('、')||'本周编导输入与生产启动'}。`);
 if(card.productionTaskId&&card.productionTaskId!==actual.productionProgress.contentTaskId)throw Error('日历内容绑定与当前执行任务生产观察不一致，请刷新真实上游。');
 return actual;
}
export function sceneCalendarChoices(execution:WeeklyExecutionTask,task:SocialContentTaskDetail,projects:Array<{id:string;title?:string;status?:string;spec?:Record<string,unknown>}>,receipts:SocialSceneReworkAvailability[]){
 const matches=projects.filter(p=>p.status!=='template'&&p.spec?.socialContentTaskId===task.taskId);
 if(!matches.length)throw Error(`内容任务 ${task.taskId} 尚无真实三栏视频项目，请在原内容任务补齐制作项目。`);
 const choices:Array<{target:ScopedSceneTarget;label:string;reasons:string[]}>=[];
 for(const receipt of receipts){
  const binding=receipt.productionWorkspaceBinding;
  if(!binding)throw Error(`原成片 ${receipt.parentArtifactId} 缺少可核验的视频项目血缘：${receipt.productionWorkspaceGap||'真实生产快照尚未建立'}。请核对实际生产上游。`);
  const boundProjects=matches.filter(p=>p.id===binding.projectId);
  if(boundProjects.length!==1)throw Error(`原成片 ${receipt.parentArtifactId} 关联的视频项目不存在或不唯一，请核对真实上游。`);
  const project=boundProjects[0]!;
  for(const scene of receipt.scenes.filter(s=>s.status==='failed')){
  const target:ScopedSceneTarget={tenantId:execution.tenantId,programId:execution.programId,packageId:execution.packageId,packageVersion:execution.packageVersion,executionTaskId:execution.taskId,contentTaskId:task.taskId,contentTaskVersion:task.version,sourceRunId:execution.productionProgress?.runId||'',parentArtifactId:receipt.parentArtifactId,sceneId:scene.sceneId,projectId:project.id};
  validateScopedSceneTarget(target,[execution],task,project,receipt);
  if(projects.filter(p=>p.id===project.id).length!==1)throw Error('视频项目身份重复，无法定位。');
  choices.push({target,label:`${project.title||project.id} · 成片 ${receipt.parentArtifactId} · ${task.artifacts.find(a=>a.artifactId===receipt.parentArtifactId)?.version} · ${task.artifacts.find(a=>a.artifactId===receipt.parentArtifactId)?.platform||'平台未指定'} · 失败分镜 ${scene.sceneId} / 镜头 ${scene.shotId}`,reasons:scene.checks?.filter(c=>!c.passed).map(c=>c.message)||[]});
 }
 }
 if(!choices.length)throw Error(`内容任务 ${task.taskId} 未读取到已核验失败分镜；请核对原成片质检或上游素材，不猜测分镜。`);
 return choices;
}
