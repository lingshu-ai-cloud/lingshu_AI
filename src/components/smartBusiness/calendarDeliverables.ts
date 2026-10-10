import type {AgentCalendarTask} from './AgentWeeklyCalendar';

const productionSteps = new Set(['material_preparation','material_readiness','script','storyboard','asset_generation','video_generation','quality_check','rework']);

/** Collapse persisted production nodes only within an explicit, scoped delivery identity. */
export function projectCalendarDeliverables(tasks: AgentCalendarTask[]): AgentCalendarTask[] {
  const groups = new Map<string, AgentCalendarTask[]>();
  for (const task of tasks) {
    if (!task.deliverableGroup || task.agent === 'human' || !productionSteps.has(task.executionStep || '')) continue;
    const group = groups.get(task.deliverableGroup) || [];
    group.push(task);
    groups.set(task.deliverableGroup, group);
  }
  const hidden = new Set<string>();
  const replacements = new Map<string, AgentCalendarTask>();
  for (const nodes of groups.values()) {
    const ancestors = new Map(nodes.map(node=>[node.id,node]));
    const visit=(node:AgentCalendarTask)=>{for(const id of node.dependsOn||[]){const upstream=tasks.find(t=>t.id===id);if(upstream?.calendarInternal&&!ancestors.has(id)){ancestors.set(id,upstream);visit(upstream);}}};
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
  return tasks.filter(task=>!hidden.has(task.id)&&!task.calendarInternal).map(task=>replacements.get(task.id)||task);
}
