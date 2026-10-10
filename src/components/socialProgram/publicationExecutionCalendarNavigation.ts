import type {WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
export interface PublicationExecutionTarget {tenantId:string;programId:string;packageId:string;packageVersion:number;taskId:string;publicationTaskId:string;accountId:string}
export function validPublicationExecutionTarget(card:AgentCalendarTask,scope:{programId:string;packageId:string;packageVersion:number},tasks:WeeklyExecutionTask[]):WeeklyExecutionTask|null{
 const t=card.publicationExecutionTarget;if(!t||card.id!==t.taskId||t.programId!==scope.programId||t.packageId!==scope.packageId||t.packageVersion!==scope.packageVersion||!t.tenantId||!t.publicationTaskId||!t.accountId)return null;
 const found=tasks.filter(task=>task.taskId===t.taskId&&task.tenantId===t.tenantId&&task.programId===t.programId&&task.packageId===t.packageId&&task.packageVersion===t.packageVersion&&task.publicationTaskId===t.publicationTaskId&&task.accountId===t.accountId&&task.workflowKind==='publishing'&&task.schedule.stepKind==='publishing');
 return found.length===1?found[0]!:null;
}
