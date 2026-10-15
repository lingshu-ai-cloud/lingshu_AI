import type {DataStore} from '../storage/datastore.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {readWeeklyCustomerChannelReadiness} from '../runtime/socialWeeklyCustomerChannelAdapter.js';
import {readWeeklyPreproductionExecutionGate} from '../runtime/weeklyPreproductionProducer.js';
import {readCustomerMessagingAuthorization} from '../digitalEmployees/customerMessagingPolicy.js';

export function classifyWeeklyBlocker(code:string):'user_input'|'technical'|'upstream'{
 if(code.startsWith('upstream:'))return 'upstream';
 if(/required|unavailable|not_authorized|not_approved|not_ready|binding_missing|account_ambiguous|business_dispatch|business_goal|capacity_plan|automation_policy|configuration_inactive|customer_agent_not_enabled/.test(code)&&! /worker|adapter|storage|consumer/.test(code))return 'user_input';
 return 'technical';
}
/** Read-only audit of every durable node, not the merged calendar cards. No provider calls. */
export async function auditWeeklyTasks(store:DataStore,tasks:WeeklyExecutionTask[]){
 const byId=new Map(tasks.map(t=>[t.taskId,t])),observed=new Map<string,string[]>();
 const channels=new Map<string,Awaited<ReturnType<typeof readCustomerMessagingAuthorization>>>();
 for(const task of tasks){
  const codes=[...task.ownBlockingReasons];
  if(task.lastError&&!codes.includes(task.lastError.code))codes.push(task.lastError.code);
  if(['business_outline','benchmark_collection'].includes(task.schedule.stepKind)&&!['succeeded','cancelled'].includes(task.status)){
   const gate=await readWeeklyPreproductionExecutionGate(store,task);
   if(!gate.ready&&gate.code&&!codes.includes(gate.code))codes.push(gate.code);
  }
  if(task.schedule.stepKind==='customer_channel_readiness'&&!['succeeded','cancelled'].includes(task.status)){
   const channel=task.inputSnapshot.customerChannel;
   if(channel==='whatsapp'||channel==='messenger'||channel==='instagram'){
    if(!channels.has(channel))channels.set(channel,await readCustomerMessagingAuthorization(task.tenantId,channel,{dataStore:store}));
    for(const code of channels.get(channel)!.reasons)if(!codes.includes(code))codes.push(code);
   }
   try{await readWeeklyCustomerChannelReadiness(store,task);}catch(e){const code=e instanceof Error?e.message:'weekly_customer_channel_unavailable';if(!codes.includes(code))codes.push(code);}
  }
  observed.set(task.taskId,codes);
 }
 const memo=new Map<string,Array<{taskId:string;code:string;category:ReturnType<typeof classifyWeeklyBlocker>}>>();
 function roots(id:string,path=new Set<string>()):Array<{taskId:string;code:string;category:ReturnType<typeof classifyWeeklyBlocker>}>{
  if(path.has(id))return [{taskId:id,code:'weekly_dependency_cycle',category:'technical'}];
  if(memo.has(id))return memo.get(id)!;
  const task=byId.get(id);if(!task)return [{taskId:id,code:'weekly_dependency_missing',category:'technical'}];
  if(task.status==='succeeded')return [];
  const next=new Set(path).add(id),out=(observed.get(id)??[]).map(code=>({taskId:id,code,category:classifyWeeklyBlocker(code)}));
  for(const parent of task.dependsOnTaskIds)out.push(...roots(parent,next));
  const result=[...new Map(out.map(v=>[`${v.taskId}:${v.code}`,v])).values()];memo.set(id,result);return result;
 }
 const items=tasks.map(t=>({taskId:t.taskId,step:t.schedule.stepKind,actor:t.schedule.responsibleActor,date:typeof t.inputSnapshot?.calendarAssignmentDate==='string'?t.inputSnapshot.calendarAssignmentDate:null,status:t.status,attempt:t.attempt,scheduledStartAt:t.schedule.estimatedStartAt,actualStartedAt:t.schedule.actualStartedAt,lastObservedAt:t.lastError?.occurredAt??null,resultRefs:t.resultRefs,ownReasons:(observed.get(t.taskId)??[]).map(code=>({code,category:classifyWeeklyBlocker(code)})),waitingFor:t.dependsOnTaskIds.filter(id=>byId.get(id)?.status!=='succeeded'),rootCauses:roots(t.taskId)}));
 const byStep:Record<string,{total:number;statuses:Record<string,number>}>= {},rootCounts:Record<string,number>={};
 for(const item of items){const step=byStep[item.step]??={total:0,statuses:{}};step.total++;step.statuses[item.status]=(step.statuses[item.status]??0)+1;for(const code of new Set(item.rootCauses.map(r=>r.code)))rootCounts[code]=(rootCounts[code]??0)+1;}
 return {auditedAt:new Date().toISOString(),total:items.length,byStep,rootCounts,items};
}
