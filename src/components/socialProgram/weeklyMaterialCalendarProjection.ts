import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import type { WeeklyMaterialRequest, MaterialConsumer } from '../../../server/socialPrograms/weeklyMaterialRequests';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import {calendarDateTime,frozenCalendarClock} from './calendarTime';
export type MaterialCalendarAction = 'upload' | 'verification';
export type WeeklyMaterialCalendarTask = AgentCalendarTask & {
  materialRequestId:string;materialAction:MaterialCalendarAction;materialConsumerTaskIds:string[];
};
export interface WeeklyMaterialCalendarScope {
  tenantId:string;programId:string;packageId:string;packageVersion:number;weekStart:string;weekEnd:string;
}
export interface WeeklyMaterialCalendarProjection {
  tasks:WeeklyMaterialCalendarTask[];
  unscheduledVerification:Array<{requestId:string;title:string;assigneeUserId:string;consumerTaskIds:string[];reason:string}>;
  sharedReferences:Array<{requestId:string;action:MaterialCalendarAction;deadline:string;consumerTaskIds:string[];affectedPublicationIds:string[];reason:'outside_current_week';status:AgentCalendarTask['status'];submission:AgentCalendarTask['submission'];assigneeUserId:string;availableForHuman:boolean}>;
  issues:Array<{requestId:string;reason:string}>;
}
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
function instant(value:unknown):Date|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const [year,month,day]=value.slice(0,10).split('-').map(Number);const check=new Date(Date.UTC(year!,month!-1,day!));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month!-1||check.getUTCDate()!==day)return null;
  const result=new Date(value);return Number.isFinite(result.getTime())?result:null;
}
export function isMaterialCalendarTask(task:AgentCalendarTask):task is WeeklyMaterialCalendarTask {
  const value=task as Partial<WeeklyMaterialCalendarTask>;
  return task.agent==='human'&&Boolean(text(value.materialRequestId))&&['upload','verification'].includes(value.materialAction||'');
}
/** A physical request is scheduled once at each genuine deadline. Other consuming weeks reference
 * its identity instead of reproducing upload work or moving its date to the selected week. */
export function projectWeeklyMaterialCalendar(requests:WeeklyMaterialRequest[],scope:WeeklyMaterialCalendarScope,executionTasks:WeeklyExecutionTask[]):WeeklyMaterialCalendarProjection {
  const result:WeeklyMaterialCalendarProjection={tasks:[],unscheduledVerification:[],sharedReferences:[],issues:[]};
  const ownedTasks=new Map(executionTasks.filter(task=>task.tenantId===scope.tenantId&&task.programId===scope.programId&&task.packageId===scope.packageId&&task.packageVersion===scope.packageVersion&&Boolean(task.publicationTaskId)&&['content','adaptation'].includes(task.scope)&&['material_readiness','asset_generation','storyboard','video_generation'].includes(task.schedule?.stepKind)).map(task=>[task.taskId,task.publicationTaskId!] as const));
  const identities=new Map<string,WeeklyMaterialRequest[]>();
  for(const request of requests){if(request.tenantId!==scope.tenantId||request.programId!==scope.programId||!text(request.requestId))continue;const group=identities.get(request.requestId)??[];group.push(request);identities.set(request.requestId,group);}
  for(const [requestId,copies] of identities){
    if(copies.some(copy=>JSON.stringify(copy)!==JSON.stringify(copies[0]))){result.issues.push({requestId,reason:'共享素材任务存在冲突版本，请重新加载核验'});continue;}
    const request=copies[0]!;
    const consumers=(Array.isArray(request.consumers)?request.consumers:[]).filter((consumer:MaterialConsumer)=>consumer.packageId===scope.packageId&&consumer.packageVersion===scope.packageVersion&&ownedTasks.has(consumer.taskId));
    if(!consumers.length)continue;
    if(new Set(consumers.map(consumer=>consumer.taskId)).size!==consumers.length){result.issues.push({requestId,reason:'素材消费者身份重复，请重新核验'});continue;}
    const consumerTaskIds=consumers.map(consumer=>consumer.taskId);
    const affectedPublicationIds=[...new Set(consumerTaskIds.map(taskId=>ownedTasks.get(taskId)).filter((id):id is string=>Boolean(id)))].sort();
    if(!['missing','pending_verification','accepted','rejected','cancelled'].includes(request.status)){result.issues.push({requestId,reason:'素材任务状态无效，等待真实记录核验'});continue;}
    const due=instant(request.dueAt);
    if(!due||!text(request.assigneeUserId)||!text(request.reviewerUserId)){result.issues.push({requestId,reason:'素材上传截止或指定真人身份缺失'});continue;}
    const latest=request.submissions?.at(-1);
    const submitted=Boolean(latest&&Number.isSafeInteger(latest.version)&&latest.version>0&&instant(latest.submittedAt)&&latest.submittedBy===request.assigneeUserId&&Array.isArray(latest.materials)&&latest.materials.length&&latest.materials.every(material=>text(material.recordId)&&/^[a-f0-9]{64}$/i.test(material.sha256)&&Number.isFinite(material.byteSize)&&material.byteSize>0&&['image','video'].includes(material.type)));
    const verification=latest?.verification;
    const reviewed=Boolean(submitted&&verification&&instant(verification.reviewedAt)&&verification.reviewedBy===request.reviewerUserId&&['accepted','rejected'].includes(verification.decision)&&Array.isArray(verification.consumerDecisions)&&request.consumers.every(consumer=>verification.consumerDecisions.filter(decision=>decision.taskId===consumer.taskId).length===1)&&verification.consumerDecisions.length===request.consumers.length&&verification.consumerDecisions.every(decision=>typeof decision.accepted==='boolean'&&text(decision.factCheck)&&text(decision.rightsCheck)&&text(decision.visualCheck))&&verification.consumerDecisions.every(decision=>decision.accepted)===(verification.decision==='accepted'));
    const cancellation=request.status==='cancelled';
    const pending=request.status==='pending_verification';
    const accepted=request.status==='accepted'&&reviewed&&verification?.decision==='accepted';
    const rejected=request.status==='rejected'&&reviewed&&verification?.decision==='rejected';
    if((pending&&!submitted)||(['accepted','rejected'].includes(request.status)&&(!reviewed||verification?.decision!==request.status))){result.issues.push({requestId,reason:'上传或核验状态缺少当前提交版本的真实证据'});continue;}
    const emit=(action:MaterialCalendarAction,date:Date,card:Omit<WeeklyMaterialCalendarTask,'id'|'date'|'time'|'materialAction'>)=>{
      const deadline=action==='upload'?request.dueAt:request.verificationDueAt!;
      const clock=frozenCalendarClock([request.timeZone],deadline);
      const {date:day,time}=calendarDateTime(date.getTime(),clock);
      if(day<scope.weekStart||day>scope.weekEnd){result.sharedReferences.push({requestId,action,deadline:action==='upload'?request.dueAt:request.verificationDueAt!,consumerTaskIds,affectedPublicationIds,reason:'outside_current_week',status:card.status,submission:card.submission,assigneeUserId:card.assignee||'',availableForHuman:card.availableForHuman===true});return;}
      result.tasks.push({...card,id:`material:${scope.tenantId}:${scope.programId}:${requestId}:${action}`,date:day,time,calendarClock:clock,materialAction:action,affectedPublicationIds});
    };
    emit('upload',due,{agent:'human',title:`上传必需素材 · ${request.requirementKey}`,context:`${request.requirements} · 本周关联 ${consumerTaskIds.length} 个真实生产任务`,output:pending?'真实素材已提交，等待独立核验':accepted?'当前提交版本已逐项核验通过':rejected?'素材核验未通过，请按消费者要求补交':cancellation?'素材任务已取消':'提交符合镜头、事实和权利要求的真实素材',minutes:null,status:cancellation?'cancelled':pending||accepted?'completed':rejected?'blocked':'planned',assignee:request.assigneeUserId,dueAt:request.dueAt,submission:pending?'pending':accepted?'accepted':rejected?'rejected':'missing',humanAction:'upload',availableForHuman:!cancellation&&!pending&&!accepted,materialRequestId:requestId,materialConsumerTaskIds:consumerTaskIds});
    const verificationDate=instant(request.verificationDueAt);
    if(!verificationDate){if(!cancellation)result.unscheduledVerification.push({requestId,title:`核验必需素材 · ${request.requirementKey}`,assigneeUserId:request.reviewerUserId,consumerTaskIds,reason:'尚未指定独立核验截止，不能把上传截止当核验截止'});continue;}
    const passed=reviewed?verification!.consumerDecisions.filter(decision=>consumerTaskIds.includes(decision.taskId)&&decision.accepted).length:0;
    emit('verification',verificationDate,{agent:'human',title:`核验必需素材 · ${request.requirementKey}`,context:`逐一核验事实、权利与镜头要求 · 本周关联 ${consumerTaskIds.length} 个真实生产任务`,output:reviewed?`当前提交版本核验完成；本周消费者通过 ${passed}/${consumerTaskIds.length}${passed<consumerTaskIds.length?'，未通过项等待补交':''}`:'为当前提交版本逐项记录事实、权利与镜头核验结论',minutes:null,status:cancellation?'cancelled':reviewed?'completed':pending?'planned':'blocked',reason:!reviewed&&!pending&&!cancellation?'等待指定提交人上传真实素材':undefined,assignee:request.reviewerUserId,dueAt:request.verificationDueAt!,submission:reviewed?'accepted':'missing',humanAction:'approval',availableForHuman:pending&&!cancellation,materialRequestId:requestId,materialConsumerTaskIds:consumerTaskIds});
  }
  return result;
}
/** A previous-week prerequisite remains actionable; referencing it does not create another task. */
export function materialReferenceIsOverdue(reference:WeeklyMaterialCalendarProjection['sharedReferences'][number],now=Date.now()):boolean {
  return reference.availableForHuman&&!['completed','cancelled'].includes(reference.status)&&Boolean(reference.submission&&['missing','rejected'].includes(reference.submission))&&Number.isFinite(Date.parse(reference.deadline))&&now>Date.parse(reference.deadline);
}
