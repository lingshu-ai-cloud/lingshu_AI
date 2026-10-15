import type {AgentCalendarTask} from './AgentWeeklyCalendar';
import {agentCalendarResponsibleAgent} from './agentCalendarGroups';

const productionSteps = new Set(['material_preparation','material_readiness','script','storyboard','asset_generation','video_generation','quality_check','rework']);
const customerRuntimeSteps = new Set(['customer_channel_readiness','customer_inquiry_handoff']);
const channelNames = {whatsapp:'WhatsApp',messenger:'Messenger',instagram:'Instagram'} as const;

export function isAlwaysOnCalendarTask(task:AgentCalendarTask):boolean {
  return Boolean(task.customerServiceSummary)||/24\s*小时|全天值守|常驻/.test(task.title);
}

/** One visual card per repeated daily stage; retain every original task and destination. */
export function mergeDailyTaskCards(tasks:AgentCalendarTask[]):AgentCalendarTask[]{
 const groups=new Map<string,AgentCalendarTask[]>();
 for(const task of tasks){
  const scope=task.workspaceTarget;
  const key=scope&&task.executionStep&&!isAlwaysOnCalendarTask(task)
   ?JSON.stringify([scope.programId,scope.packageId,scope.packageVersion,task.date,task.agent,task.executionStep,task.title])
   :task.id;
  groups.set(key,[...(groups.get(key)??[]),task]);
 }
 const owners=new Map<string,string>();
 for(const nodes of groups.values())for(const node of nodes)owners.set(node.id,nodes.length>1?`daily-group:${nodes[0]!.id}`:node.id);
 return [...groups.values()].map(nodes=>{
  if(nodes.length===1)return {...nodes[0]!,dependsOn:nodes[0]!.dependsOn?.map(id=>owners.get(id)??id)};
  const first=nodes[0]!,id=owners.get(first.id)!;
  return {id,date:first.date,time:'06:00',agent:first.agent,executionStep:first.executionStep,title:first.title,
   context:`${nodes.length} 项真实任务`,output:`${nodes.length} 项同日任务，逐项查看交付与生产线程。`,
   minutes:nodes.some(task=>task.minutes===null)?null:nodes.reduce((sum,task)=>sum+(task.minutes??0),0),
   status:customerStatus(nodes),calendarClock:first.calendarClock,dailyTaskGroup:{tasks:nodes},
   // This is only a daily display group. Unioning parallel chains can create an
   // artificial cycle; execution dependencies remain on each original task.
   dependsOn:[],
  };
 });
}

/** Preserve real dependency order within a date; only resident duties lead it. */
export function orderDailyCalendarTasks(tasks:AgentCalendarTask[]):AgentCalendarTask[]{
const rank:Record<string,number>={business_outline:0,context_readiness:1,publishing_calendar:2,benchmark_collection:3,benchmark_scoring:4,director_analysis:5,business_schedule:6,material_preparation:7,script:8,storyboard:9,material_readiness:10,asset_generation:11,video_generation:12,quality_check:13,rework:14,user_approval:15,export:16,render:17,upload:18,publishing:19,performance_monitoring:20,weekly_review:21};
  const dates=[...new Set(tasks.map(task=>task.date))].sort();
  return dates.flatMap(date=>{
    const pending=tasks.filter(task=>task.date===date).sort((a,b)=>Number(isAlwaysOnCalendarTask(b))-Number(isAlwaysOnCalendarTask(a))||(rank[a.executionStep||'']??22)-(rank[b.executionStep||'']??22));
    const result:AgentCalendarTask[]=[];
    while(pending.length){
      const index=pending.findIndex(task=>isAlwaysOnCalendarTask(task)||!task.dependsOn?.some(id=>pending.some(candidate=>candidate.id===id)));
      result.push(pending.splice(index<0?0:index,1)[0]!);
    }
    return result;
  });
}

function addDays(date:string,days:number){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
function customerStatus(tasks:AgentCalendarTask[]):AgentCalendarTask['status']{
  if(tasks.some(task=>task.status==='failed'))return'failed';
  if(tasks.some(task=>task.status==='blocked'))return'blocked';
  if(tasks.some(task=>task.status==='active'))return'active';
  if(tasks.some(task=>task.status==='planned'))return'planned';
  return tasks.length?'completed':'planned';
}

/** The customer agent is an always-on capability, not a stack of hourly jobs. */
export function projectDailyCustomerServiceCards(tasks:AgentCalendarTask[],weekStart?:string):AgentCalendarTask[]{
  const sources=tasks.filter(task=>task.agent==='customer'&&customerRuntimeSteps.has(task.executionStep||''));
  if(!sources.length)return tasks;
  const retained=tasks.filter(task=>!sources.includes(task));
  const first=weekStart&&/^\d{4}-\d{2}-\d{2}$/.test(weekStart)?weekStart:[...sources].sort((a,b)=>a.date.localeCompare(b.date))[0]!.date;
  const overall=customerStatus(sources);
  const channels=(Object.keys(channelNames) as Array<keyof typeof channelNames>).map(channel=>{
    const matching=sources.filter(task=>task.customerExecutionTarget?.channel===channel);
    return{channel,status:customerStatus(matching)};
  });
  const completedCount=sources.filter(task=>['completed','no_data'].includes(task.status)).length;
  const attentionCount=sources.filter(task=>['blocked','failed'].includes(task.status)).length;
  const context=channels.map(item=>`${channelNames[item.channel]} ${item.status==='failed'?'异常':item.status==='blocked'?'需处理':item.status==='active'?'运行中':item.status==='completed'?'正常':'待运行'}`).join(' · ');
  const cards=Array.from({length:7},(_,index):AgentCalendarTask=>({
    id:`customer-always-on:${first}:${index}`,
    date:addDays(first,index),time:'00:00',agent:'customer',executionStep:'customer_always_on',
    title:'24小时常驻客服',context,
    output:'持续承接 WhatsApp、Messenger、Instagram 客户消息；异常、审批与人工交接进入任务详情。',
    minutes:1440,status:overall==='completed'?'active':overall,
    deadlineTracked:false,timeSemantics:'start',calendarClock:sources[0]!.calendarClock,
    customerServiceSummary:{channels,sourceTaskCount:sources.length,completedCount,attentionCount,sourceTasks:sources},
  }));
  return [...retained,...cards];
}

/** Collapse persisted production nodes only within an explicit, scoped delivery identity. */
export function projectCalendarDeliverables(tasks: AgentCalendarTask[], independent = false): AgentCalendarTask[] {
  // Weekly goal cards are section summaries. Their persisted workflow nodes are
  // the actual independently actionable work and must remain separate calendar
  // cards (especially Monday's operating setup), rather than being represented
  // by one synthetic summary card.
  const directIds = new Set(tasks.filter(task => !task.calendarSummaryOnly).map(task => task.id));
  const expanded = tasks.flatMap(task => task.calendarSummaryOnly && task.internalNodes?.length
    ? task.internalNodes.filter(node => !directIds.has(node.id))
    : [task]).map(task => ({...task, agent: agentCalendarResponsibleAgent(task.executionStep, task.agent)}));
  if (independent) return [...new Map(expanded.flatMap(task => task.internalNodes?.length ? task.internalNodes : [task]).map(task => [task.id, {...task, calendarInternal:false, agent:agentCalendarResponsibleAgent(task.executionStep,task.agent)}])).values()];
  const groups = new Map<string, AgentCalendarTask[]>();
  for (const task of expanded) {
    if (!task.deliverableGroup || task.agent === 'human' || !productionSteps.has(task.executionStep || '')) continue;
    const group = groups.get(task.deliverableGroup) || [];
    group.push(task);
    groups.set(task.deliverableGroup, group);
  }
  const hidden = new Set<string>();
  const replacements = new Map<string, AgentCalendarTask>();
  for (const nodes of groups.values()) {
    const ancestors = new Map(nodes.map(node=>[node.id,node]));
    const visit=(node:AgentCalendarTask)=>{for(const id of node.dependsOn||[]){const upstream=expanded.find(t=>t.id===id);if(upstream?.calendarInternal&&!ancestors.has(id)){ancestors.set(id,upstream);visit(upstream);}}};
    nodes.forEach(visit);
    const ordered = [...ancestors.values()].sort((a,b)=>`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    // Retain the real quality task identity for navigation and delivery evidence.
    const anchor = ordered.filter(n=>n.executionStep==='quality_check').at(-1)
      || ordered.filter(n=>n.executionStep==='video_generation').at(-1);
    if (!anchor) continue;
    for (const node of nodes) if (node.id !== anchor.id) hidden.add(node.id);
    const blocked = nodes.find(n=>n.status==='failed'||n.status==='blocked');
    const active = nodes.some(n=>n.status==='active');
    const videoNode = ordered.find(n=>n.executionStep==='video_generation');
    const productionNode = ordered.filter(n=>n.productionExecutionTaskId&&n.productionTaskId&&n.executionStep==='quality_check').at(-1)
      || ordered.filter(n=>n.productionExecutionTaskId&&n.productionTaskId&&n.executionStep==='video_generation').at(-1)
      || ordered.find(n=>n.productionExecutionTaskId&&n.productionTaskId);
    replacements.set(anchor.id, {...anchor, agent:'content',
      title: videoNode?.title.startsWith('完成视频') ? videoNode.title : '完成视频成片',
      output: videoNode?.output || anchor.output,
      status: anchor.status==='completed' ? 'completed' : blocked?.status || (active?'active':anchor.status),
      reason: blocked?.reason || anchor.reason,
      minutes: nodes.some(n=>n.minutes===null)?null:nodes.reduce((sum,n)=>sum+(n.minutes||0),0),
      internalNodes: ordered,
      productionExecutionTaskId: productionNode?.productionExecutionTaskId,
      productionTaskId: productionNode?.productionTaskId,
    });
  }
  return expanded.filter(task=>!hidden.has(task.id)&&!task.calendarInternal).map(task=>replacements.get(task.id)||task);
}
