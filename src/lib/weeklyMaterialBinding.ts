import type { SocialWeeklyPublicationTask, WeeklyExecutionTask, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram';
import type { MaterialConsumer, WeeklyMaterialRequest } from '../../server/socialPrograms/weeklyMaterialRequests';
import { socialProgramApi } from './socialProgramApi';
import { weeklyMaterialRequestsApi } from './weeklyMaterialRequestsApi';

export type WeeklyHumanMaterialBinding = { requirementId: string; requestId: string };
type MaterialChoice={publicationTaskId:string;taskId:string|null;requirementId:string|null;description:string;classification:'human_irreplaceable'|'generatable_non_evidentiary'|'unknown';reason:string;sourceLabel:string};
export function weeklyMaterialRequirementChoices(pkg:WeeklyOperatingPackage,tasks:WeeklyExecutionTask[]):MaterialChoice[] {
  const items=pkg.agentPlanning?.dispatch?.scheduleItems ?? [];
  return items.flatMap<MaterialChoice>(item=> {
    const contract=item.materialEvidenceRequirements;
    if(!contract || contract.scope.packageId!==pkg.packageId || contract.scope.packageVersion!==pkg.version || contract.scope.slotId!==item.slotId) return [{publicationTaskId:item.publicationTaskId,taskId:null,requirementId:null,description:'当前版本缺少真实逐项素材分析，请重新分析并派单。',classification:'unknown' as const,reason:'分析不存在或属于旧版本',sourceLabel:'无当前版本来源'}];
    const consumers=tasks.filter(task=>task.programId===pkg.programId&&task.packageId===pkg.packageId&&task.packageVersion===pkg.version&&task.publicationTaskId===item.publicationTaskId&&task.schedule.stepKind==='material_readiness');
    return contract.items.map(requirement=>({...requirement,publicationTaskId:item.publicationTaskId,taskId:consumers.length===1?consumers[0].taskId:null,sourceLabel:contract.handoffRef?`对标分析 ${contract.handoffRef.inspirationId} · v${contract.handoffRef.version} · ${requirement.sourceField==='requiredEvidence'?'必需证据':'素材建议'} 第 ${requirement.sourceIndex+1} 项`:'缺少可核验的来源分析'}));
  });
}
export function selectedWeeklyMaterialConsumers(pkg:WeeklyOperatingPackage,tasks:WeeklyExecutionTask[],requirementIds:string[]):MaterialConsumer[] {
  if(!requirementIds.length || new Set(requirementIds).size!==requirementIds.length)throw Error('请明确选择本版本真实素材需求。');
  const choices=weeklyMaterialRequirementChoices(pkg,tasks),grouped=new Map<string,string[]>();
  for(const id of requirementIds) {
    const found=choices.filter(choice=>choice.requirementId===id);
    if(!found.length || found.some(choice=>choice.classification!=='human_irreplaceable'||!choice.taskId) || new Set(found.map(choice=>choice.description)).size!==1)throw Error('素材需求不是当前版本可绑定的真人需求；未知需求需重新分析，不能猜测需求身份。');
    for(const choice of found)grouped.set(choice.taskId!,[...(grouped.get(choice.taskId!)??[]),`${id}：${choice.description}`]);
  }
  return [...grouped].map(([taskId,lines])=>({taskId,packageId:pkg.packageId,packageVersion:pkg.version,requirement:lines.join('\n')}));
}

interface BindingPorts {
  listRequests(programId: string): Promise<WeeklyMaterialRequest[]>;
  listTasks(programId: string, packageId: string, version: number): Promise<WeeklyExecutionTask[]>;
  revisePackage(pkg: WeeklyOperatingPackage, publications: SocialWeeklyPublicationTask[]): Promise<WeeklyOperatingPackage>;
  appendConsumers(programId: string, requestId: string, consumers: MaterialConsumer[]): Promise<WeeklyMaterialRequest>;
}
const ports: BindingPorts = {
  listRequests: weeklyMaterialRequestsApi.list,
  listTasks: socialProgramApi.listExecutionTasks,
  revisePackage: (pkg, publicationTasks) => socialProgramApi.reviseOperatingPackage(pkg.programId, pkg.packageId, { expectedVersion: pkg.version, publicationTasks, changeReason: '明确必需人工素材及各发布的真实消费者' }),
  appendConsumers: (programId, requestId, addConsumers) => weeklyMaterialRequestsApi.revise(programId, requestId, { reason: '将同一共享素材显式关联到新冻结排期的真实生产任务', addConsumers }),
};

/** A failed append is repaired on the already-created version, without another package revision or activation. */
export async function bindWeeklyMaterialRequest(input: {
  pkg: WeeklyOperatingPackage; tasks: WeeklyExecutionTask[]; request: WeeklyMaterialRequest;
  bindings?:WeeklyHumanMaterialBinding[];
  onRevision(next: WeeklyOperatingPackage): void; ports?: BindingPorts;
}): Promise<void> {
  const api = input.ports ?? ports; const pkg = input.pkg;
  if(!input.bindings?.length || input.bindings.some(binding=>binding.requestId!==input.request.requestId))throw Error('请从真实素材分析明确选择需求后再关联；普通素材任务不能绕过未知需求。');
  const selected=selectedWeeklyMaterialConsumers(pkg,input.tasks,input.bindings.map(binding=>binding.requirementId));
  if (input.request.programId !== pkg.programId || input.request.status === 'cancelled') throw Error('素材任务不属于当前经营项目或已取消。');
  const known = await api.listRequests(pkg.programId); const byId = new Map(known.map(request => [request.requestId, request]));
  if (!byId.has(input.request.requestId)) throw Error('共享素材任务尚未在真实服务中读取，请刷新。');
  const cache = new Map<string, WeeklyExecutionTask[]>(); cache.set(`${pkg.packageId}:${pkg.version}`, input.tasks);
  async function consumerTask(consumer: MaterialConsumer) {
    const key = `${consumer.packageId}:${consumer.packageVersion}`;
    if (!cache.has(key)) cache.set(key, await api.listTasks(pkg.programId, consumer.packageId, consumer.packageVersion));
    const found = cache.get(key)!.filter(task => task.taskId === consumer.taskId && task.programId === pkg.programId && task.packageId === consumer.packageId && task.packageVersion === consumer.packageVersion);
    if (found.length !== 1 || !found[0].publicationTaskId) throw Error('素材消费者身份无法完整核对，保留排期阻塞。');
    return found[0];
  }
  const fresh = byId.get(input.request.requestId)!; const targetPublications = new Set<string>();
  for(const consumer of selected) {
    const task=await consumerTask(consumer);
    const lines=consumer.requirement.split('\n');
    if(!lines.every(line=>fresh.consumers.some(actual=>actual.packageId===pkg.packageId&&actual.requirement.split('\n').includes(line))))throw Error('该共享任务尚未包含所选真实需求及描述，请先明确追加消费者要求。');
    targetPublications.add(task.publicationTaskId!);
  }
  const publicationTasks = pkg.socialContentPackage.publicationTasks.map(item => targetPublications.has(item.publicationTaskId) && !['published', 'cancelled'].includes(item.status)
    ? { ...item, materialRequirement: { required: true as const, requestIds: [...new Set([...(item.materialRequirement?.requestIds ?? []), fresh.requestId])],bindings:[...(item.materialRequirement?.bindings??[]).filter(binding=>!input.bindings!.some(selected=>selected.requirementId===binding.requirementId)),...input.bindings!.filter(binding=>selected.some(consumer=>input.tasks.find(task=>task.taskId===consumer.taskId)?.publicationTaskId===item.publicationTaskId&&consumer.requirement.split('\n').some(line=>line.startsWith(`${binding.requirementId}：`))))] } } : item);
  if (!publicationTasks.some(item => item.materialRequirement?.requestIds.includes(fresh.requestId))) throw Error('当前发布排期没有该素材的真实消费者，不能猜测关联。');
  const requirementByConsumer = new Map<string, string>();
  for (const item of publicationTasks.filter(item => !['published', 'cancelled'].includes(item.status))) {
    for (const requestId of item.materialRequirement?.requestIds ?? []) {
      const request = byId.get(requestId); if (!request || request.status === 'cancelled') throw Error('已有必需素材任务不存在或已取消，先修复再修订。');
      const bindings=item.materialRequirement?.bindings?.filter(binding=>binding.requestId===requestId)??[];
      if(!bindings.length)throw Error('已有素材缺少逐项需求映射，需明确重绑，不能沿用旧需求身份。');
      const requirements = new Set<string>();
      const choices=weeklyMaterialRequirementChoices(pkg,input.tasks).filter(choice=>choice.publicationTaskId===item.publicationTaskId);
      for(const binding of bindings) {
        const choice=choices.find(choice=>choice.requirementId===binding.requirementId&&choice.classification==='human_irreplaceable');
        if(!choice)throw Error('素材来源分析已变更或未知，需重新分析并明确重绑。');
        const line=`${binding.requirementId}：${choice.description}`;
        if(!request.consumers.some(consumer=>consumer.packageId===pkg.packageId&&consumer.requirement.split('\n').includes(line)))throw Error('共享素材未明确记录所映射需求的真实描述。');
        requirements.add(line);
      }
      if (!requirements.size) throw Error('已有素材缺少该视频的明确镜头要求，不能自动生成消费者。');
      requirementByConsumer.set(`${requestId}:${item.publicationTaskId}`, [...requirements].join('\n'));
    }
  }
  const changed = JSON.stringify(publicationTasks) !== JSON.stringify(pkg.socialContentPackage.publicationTasks);
  const next = changed ? await api.revisePackage(pkg, publicationTasks) : pkg;
  if (changed) input.onRevision(next); // The revision exists even if the following association fails.
  const nextTasks = await api.listTasks(next.programId, next.packageId, next.version);
  const nextChoices=weeklyMaterialRequirementChoices(next,nextTasks);
  const additions = new Map<string, MaterialConsumer[]>();
  for (const item of next.socialContentPackage.publicationTasks.filter(item => !['published', 'cancelled'].includes(item.status))) {
    if (!item.materialRequirement?.requestIds.length) continue;
    const candidates = nextTasks.filter(task => task.programId === next.programId && task.packageId === next.packageId && task.packageVersion === next.version && task.publicationTaskId === item.publicationTaskId && task.schedule.stepKind === 'material_readiness');
    if (candidates.length !== 1) throw Error('新版本素材准备任务不存在或不唯一；周包已保存，等待修复关联。');
    for (const requestId of item.materialRequirement.requestIds) {
      for(const binding of item.materialRequirement.bindings?.filter(binding=>binding.requestId===requestId)??[])if(!nextChoices.some(choice=>choice.publicationTaskId===item.publicationTaskId&&choice.requirementId===binding.requirementId&&choice.classification==='human_irreplaceable'))throw Error('新版本已保存，但真实需求分析尚未就绪或来源已改变；请重新分析并明确重绑，未解除生产阻塞。');
      const request = byId.get(requestId)!; const task = candidates[0];
      if (request.consumers.some(consumer => consumer.taskId === task.taskId && consumer.packageId === next.packageId && consumer.packageVersion === next.version)) continue;
      const requirement = requirementByConsumer.get(`${requestId}:${item.publicationTaskId}`); if (!requirement) throw Error('新版本镜头要求没有可核验来源。');
      additions.set(requestId, [...(additions.get(requestId) ?? []), { taskId: task.taskId, packageId: next.packageId, packageVersion: next.version, requirement }]);
    }
  }
  for (const [requestId, consumers] of additions) {
    try { await api.appendConsumers(next.programId, requestId, consumers); }
    catch (error) {
      const latest = (await api.listRequests(next.programId)).find(request => request.requestId === requestId);
      if (!latest || !consumers.every(consumer => latest.consumers.some(actual => actual.taskId === consumer.taskId && actual.packageId === consumer.packageId && actual.packageVersion === consumer.packageVersion && actual.requirement === consumer.requirement))) throw error;
    }
  }
}
