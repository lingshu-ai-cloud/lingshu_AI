import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';

/** Historical unstarted customer work uses the same independent channel graph in every read model. */
export function normalizeCustomerTaskDependencies(task:WeeklyExecutionTask):WeeklyExecutionTask {
 if(!task.schedule)return task;
 const unstarted=!task.schedule.actualStartedAt&&!task.resultRefs.length&&!['succeeded','cancelled','dead_letter','leased'].includes(task.status);
 if(!unstarted)return task;
 if(task.schedule.stepKind==='customer_channel_readiness'&&task.dependsOnTaskIds.length)return {...task,dependsOnTaskIds:[],inheritedBlockingTaskIds:[]};
 if(task.schedule.stepKind==='customer_inquiry_handoff'&&task.dependsOnTaskIds.length>1){
  const readinessId=task.dependsOnTaskIds.at(-1)!;
  return {...task,dependsOnTaskIds:[readinessId],inheritedBlockingTaskIds:task.inheritedBlockingTaskIds.filter(id=>id===readinessId)};
 }
 return task;
}
