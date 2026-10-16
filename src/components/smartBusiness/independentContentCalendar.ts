import type {WorkflowTask} from '../../lib/digitalEmployees';
import type {AgentCalendarTask} from './AgentWeeklyCalendar';
export function projectIndependentContentCalendar(tasks:WorkflowTask[],runId:string):AgentCalendarTask[]{
 return tasks.filter(t=>t.run_id===runId&&t.output?.assistantIndependent).flatMap(task=>{
  const state=task.output.assistantIndependent as {dueAt?:string},projectId=String(task.output.projectId||'');
  if(!state.dueAt||!Number.isFinite(Date.parse(state.dueAt)))return[];
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(state.dueAt));
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(state.dueAt));
  return[{id:task.id,date,time,agent:'content' as const,title:task.title,context:task.description,output:task.output.delivery?'交付物已回收，等待验收':task.blocked_reason||'进入生产页面继续',minutes:null,status:task.status==='succeeded'?'completed' as const:task.status==='failed'?'failed' as const:'blocked' as const,dueAt:state.dueAt,calendarClock:{offsetMinutes:480,timeZone:'Asia/Shanghai',label:'北京时间',source:'frozen_iana' as const},productionExecutionTaskId:task.id,independentProjectId:projectId,independentRunId:runId}];
 });
}
export function openIndependentContent(card:AgentCalendarTask):boolean{
 if(!card.independentProjectId||!card.independentRunId)return false;
 window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'smartAssets',view:'create',directStudio:true,workflowRunId:card.independentRunId,workflowTaskId:card.id,businessRef:{taskKey:'content_production',entityId:card.independentProjectId}}}));return true;
}
