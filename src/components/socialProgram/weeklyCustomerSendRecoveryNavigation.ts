import type {WeeklyCustomerSendRecovery} from '../../../shared/contracts/weeklyCustomerSendRecovery';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
import {calendarClock,calendarDateTime} from './calendarTime';
export interface CustomerSendRecoveryScope {tenantId:string;programId:string;packageId:string;packageVersion:number}
export interface CustomerSendRecoveryTarget extends CustomerSendRecoveryScope {id:string;runId:string;taskId:string;itemId:string;channel:'whatsapp'}
export function validCustomerSendRecoveryTarget(card:AgentCalendarTask,scope:CustomerSendRecoveryScope):CustomerSendRecoveryTarget|null{
 const t=card.sendRecoveryTarget;
 return t&&card.id===`send-recovery:${t.id}`&&t.channel==='whatsapp'&&t.tenantId===scope.tenantId&&t.programId===scope.programId&&t.packageId===scope.packageId&&t.packageVersion===scope.packageVersion&&[t.id,t.runId,t.taskId,t.itemId].every(s=>typeof s==='string'&&!!s)?t:null;
}
export function hasResolvedCustomerSendRecoveryProof(item:WeeklyCustomerSendRecovery):boolean{
 const p=item.resolvedProof;
 return item.status==='resolved'&&!!item.resolvedAt&&/(?:Z|[+-]\d{2}:\d{2})$/.test(item.resolvedAt)&&Number.isFinite(Date.parse(item.resolvedAt))&&item.version>1&&!!p&&p.taskId===item.taskId&&p.runId===item.runId&&Array.isArray(p.receiptIds)&&p.receiptIds.length>0&&p.receiptIds.every(id=>typeof id==='string'&&!!id)&&new Set(p.receiptIds).size===p.receiptIds.length&&/^[a-f0-9]{64}$/.test(p.evidenceHash)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(p.verifiedAt)&&Number.isFinite(Date.parse(p.verifiedAt));
}
export function projectCustomerSendRecoveries(items:WeeklyCustomerSendRecovery[],scope:CustomerSendRecoveryScope):AgentCalendarTask[]{
 const seen=new Set<string>();return items.flatMap(item=>{
  if(item.tenantId!==scope.tenantId||item.programId!==scope.programId||item.packageId!==scope.packageId||item.packageVersion!==scope.packageVersion||seen.has(item.id)||item.channel!=='whatsapp'||!Number.isFinite(Date.parse(item.deadlineAt)))return [];
  seen.add(item.id);const clock=calendarClock(item.deadlineAt),planned=calendarDateTime(item.deadlineAt,clock);
  // GET must provide a revalidated recovered-task proof; resolvedAt alone is insufficient.
  const completed=hasResolvedCustomerSendRecoveryProof(item);
  return [{id:`send-recovery:${item.id}`,agent:'human',date:planned.date,time:planned.time,calendarClock:clock,timeSemantics:'finish',title:'S7 · WhatsApp 发送异常核验',context:`实际客户 ${item.customerId} · 原发送任务 ${item.taskId}`,output:completed?'后端已核验签名回执并恢复原任务；未重发消息':item.status==='resolved'?'已记录解决；原任务恢复凭据待后端重核':'核对原发送异常的真实签名回执，不重新发送',minutes:null,status:completed?'completed':'blocked',assignee:item.ownerUserId,dueAt:item.deadlineAt,deadlineTracked:true,availableForHuman:true,submission:completed?'accepted':'missing',actualFinishedAt:completed?item.resolvedAt!:undefined,deliveryTiming:completed?(Date.parse(item.resolvedAt!)<=Date.parse(item.deadlineAt)?'on_time':'late'):undefined,reason:completed?undefined:item.status==='resolved'?'尚缺后端重核的原任务恢复凭据':item.reason,sendRecoveryTarget:{...scope,id:item.id,runId:item.runId,taskId:item.taskId,itemId:item.itemId,channel:item.channel}} as AgentCalendarTask];
 });
}
