import type { ProductionCostSummaryV1, ProductionReadModelV1 } from './productionReadModel.js';
import type { SocialContentTaskDetail, SocialContentTaskSummary } from './socialContentTaskContract.js';

export type ContentTaskUserState =
  | 'needs_input'
  | 'needs_approval'
  | 'processing'
  | 'paused'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type ContentTaskCardItem = {
  key: string;
  label: string;
  value: string;
};

export type ContentTaskCardProgress =
  | { mode: 'none' }
  | { mode: 'units'; completed: number; total: number };

/**
 * Customer-safe, endpoint-neutral projection of one authoritative ContentTask.
 * Web and miniapp may lay this out differently, but must not reinterpret task
 * state from chat copy or local timers.
 */
export type ContentProductionTaskCard = {
  schemaVersion: 'content-production-task-card.v1';
  id: string;
  contentTaskId: string;
  cardVersion: string;
  recoveryCursor: {
    kind: 'task_version' | 'task_projection';
    value: string;
    runId: string | null;
  };
  title: string;
  outputType: 'image' | 'video' | 'content';
  overallState: ContentTaskUserState;
  currentNode: { id: string; label: string; userFacingSummary: string };
  knownItems: ContentTaskCardItem[];
  defaultedItems: ContentTaskCardItem[];
  blockingItems: ContentTaskCardItem[];
  progress: ContentTaskCardProgress;
  /** Server-confirmed run cost. Null means no authoritative quote or receipt is available. */
  cost: ProductionCostSummaryV1 | null;
  completedSummary: string[];
  nextAction: 'supply_input' | 'review' | 'view' | 'download' | 'none';
  lastConfirmedAt: string;
};

const text = (value: unknown): string => String(value ?? '').trim();

const missingLabels: Record<string, string> = {
  product: '确认本次内容对应的企业产品',
  product_id: '选择企业知识库中的产品',
  objective: '补充本次内容目标',
  platform: '选择发布平台',
  platforms: '选择发布平台',
  format: '选择内容形式',
  formats: '选择内容形式',
  material: '补充可用产品素材',
  materials: '补充可用产品素材',
  presenter: '选择已授权的数字人',
  voice: '选择已授权的声音',
  budget: '确认本次生产预算',
  reference: '补充可访问的参考内容',
};

function missingLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return missingLabels[normalized]
    || Object.entries(missingLabels).find(([key]) => normalized.includes(key))?.[1]
    || value.trim();
}

function outputType(task: SocialContentTaskSummary): ContentProductionTaskCard['outputType'] {
  const formats = task.brief.formats.map(item => item.toLowerCase()).join(' ');
  if (/(image|poster|graphic|图文|海报|图片)/u.test(formats)) return 'image';
  if (/(video|reel|short|视频|口播|分镜)/u.test(formats)) return 'video';
  return 'content';
}

function production(task: SocialContentTaskSummary | SocialContentTaskDetail): ProductionReadModelV1 | null {
  return 'production' in task && task.production?.authority === 'canonical_task' ? task.production : null;
}

function state(task: SocialContentTaskSummary | SocialContentTaskDetail): ContentTaskUserState {
  if (task.status === 'cancelled' || task.status === 'cancelling') return 'cancelled';
  if (task.status === 'delivered' || task.status === 'reviewed') return 'completed';
  if (task.status === 'plan_review' || task.status === 'asset_review') return 'needs_approval';
  const runtime = production(task)?.aggregate;
  if (runtime?.status === 'needs_input') return 'needs_input';
  if (runtime?.status === 'paused') return 'paused';
  if (runtime?.status === 'failed' || runtime?.status === 'blocked') return 'failed';
  if (task.status === 'paused') return 'paused';
  if (task.status === 'attention') return 'failed';
  if (!task.readiness.complete || task.status === 'needs_input') return 'needs_input';
  return 'processing';
}

function productionNode(runtime: ProductionReadModelV1['aggregate']) {
  if (runtime.status === 'needs_input') return { id: 'production_input', label: '核对生产条件', userFacingSummary: '生产链路已核实仍缺少必要输入，只暂停受影响节点。' };
  if (runtime.status === 'paused') return { id: 'production_paused', label: '生产已暂停', userFacingSummary: '已保留当前输入、费用回执和产物，可按服务端恢复条件继续。' };
  if (runtime.status === 'failed' || runtime.status === 'blocked') return { id: 'production_blocked', label: '生产需要处理', userFacingSummary: '生产未完成，请按真实阻断项定点恢复，不要重复提交付费动作。' };
  if (runtime.status === 'review_ready') return { id: 'production_review', label: '验收内容候选', userFacingSummary: '已有真实候选产物，等待验收或提出修改。' };
  if (runtime.status === 'quality_review') return { id: 'production_qa', label: '质量检查', userFacingSummary: '真实产物正在通过质量门，尚未进入可验收状态。' };
  if (runtime.status === 'rendering') return { id: 'production_render', label: '剪辑合成', userFacingSummary: '正在按冻结输入合成产物，进度以服务端回执为准。' };
  if (runtime.status === 'running') return { id: 'production_run', label: '内容制作', userFacingSummary: '正在按冻结输入推进生产，进度以服务端回执为准。' };
  if (runtime.status === 'ready') return { id: 'production_ready', label: '生产条件已就绪', userFacingSummary: '生产条件已核实；开始生成仍需通过预算与执行授权。' };
  if (runtime.status === 'completed') return { id: 'production_completed', label: '生产已完成', userFacingSummary: '生产节点已完成；批准、交付和发布仍按各自状态判断。' };
  return { id: 'production_planning', label: '规划生产方案', userFacingSummary: '正在根据已确认事实整理生产方案，尚未宣称开始生成。' };
}

function node(task: SocialContentTaskSummary | SocialContentTaskDetail, overallState: ContentTaskUserState) {
  const runtime = production(task);
  if (overallState === 'needs_input') return runtime
    ? productionNode(runtime.aggregate)
    : { id: 'preflight', label: '核对生产条件', userFacingSummary: '任务已建立，补齐必要信息后继续。' };
  if (task.status === 'plan_review') return { id: 'plan_review', label: '确认生产方案', userFacingSummary: '任务信息已保存，等待确认生产方案。' };
  if (task.status === 'asset_review') return { id: 'asset_review', label: '验收内容候选', userFacingSummary: '已有真实候选产物，等待验收或提出修改。' };
  if (task.status === 'packaging') return { id: 'packaging', label: '整理交付', userFacingSummary: '已批准的产物正在整理交付。' };
  if (task.status === 'delivered' || task.status === 'reviewed') return { id: 'delivery', label: '交付完成', userFacingSummary: '任务已交付；下载不代表已发布。' };
  if (task.status === 'awaiting_publish') return { id: 'awaiting_publish', label: '等待发布决定', userFacingSummary: '成品已就绪，发布仍需单独授权。' };
  if (task.status === 'awaiting_metrics') return { id: 'awaiting_metrics', label: '等待效果回执', userFacingSummary: '已记录发布结果，正在等待可核实的效果数据。' };
  if (overallState === 'paused') return { id: 'paused', label: '任务已暂停', userFacingSummary: '已保留当前输入和产物，满足恢复条件后可继续。' };
  if (overallState === 'failed') return runtime
    ? productionNode(runtime.aggregate)
    : { id: 'attention', label: '需要处理异常', userFacingSummary: '任务未完成，请查看实际阻断并定点恢复。' };
  if (overallState === 'cancelled') return { id: 'cancelled', label: '任务已取消', userFacingSummary: '任务已停止，已有产物和结算以实际回执为准。' };
  if (task.status === 'draft') return { id: 'draft', label: '任务已建立', userFacingSummary: '任务已保存，尚未宣称开始生产。' };
  if (runtime) return productionNode(runtime.aggregate);
  return { id: 'production', label: '内容生产中', userFacingSummary: '正在按已确认输入推进，进度以服务端回执为准。' };
}

function latestConfirmedAt(taskUpdatedAt: string, runtime: ProductionReadModelV1 | null): string {
  if (!runtime || !Number.isFinite(Date.parse(runtime.updatedAt))) return taskUpdatedAt;
  if (!Number.isFinite(Date.parse(taskUpdatedAt))) return runtime.updatedAt;
  return Date.parse(runtime.updatedAt) > Date.parse(taskUpdatedAt) ? runtime.updatedAt : taskUpdatedAt;
}

export function projectContentProductionTaskCard(task: SocialContentTaskSummary | SocialContentTaskDetail): ContentProductionTaskCard {
  const overallState = state(task);
  const runtime = production(task);
  const requested = task.brief.requestedOutputCount && task.brief.requestedOutputCount > 0
    ? task.brief.requestedOutputCount
    : null;
  const completed = Math.min(requested ?? 0, Math.max(task.approvedArtifactCount, task.deliveryPackageCount));
  const knownItems: ContentTaskCardItem[] = [
    task.brief.productRef ? { key: 'product', label: '产品', value: task.brief.productRef } : null,
    task.brief.platforms.length ? { key: 'platforms', label: '平台', value: task.brief.platforms.join('、') } : null,
    task.brief.formats.length ? { key: 'formats', label: '形式', value: task.brief.formats.join('、') } : null,
    task.brief.languages.length ? { key: 'languages', label: '语言', value: task.brief.languages.join('、') } : null,
  ].filter((item): item is ContentTaskCardItem => Boolean(item));
  const defaultedItems: ContentTaskCardItem[] = [
    task.mode === 'instant' && !task.brief.requestedOutputCount
      ? { key: 'output-count', label: '数量', value: '单条内容' }
      : null,
    task.brief.planningMode === 'auto_adjust'
      ? { key: 'planning-mode', label: '排程', value: '按实际生产条件自动调整' }
      : null,
  ].filter((item): item is ContentTaskCardItem => Boolean(item));
  const runtimeInputIds = new Set(runtime?.aggregate.inputs.items.map(item => item.id) ?? []);
  const blockingItems = runtime
    ? [
      ...runtime.aggregate.inputs.items.filter(item => item.required && item.status !== 'provided' && item.status !== 'not_applicable').map(item => ({
        key: `input-${item.id}`, label: '待补充', value: item.label || item.reason || '必要生产输入',
      })),
      ...runtime.aggregate.blockers.filter(item => !item.inputId || !runtimeInputIds.has(item.inputId)).map(item => ({
        key: `blocker-${item.code}`, label: item.recoverable ? '需处理' : '硬阻断', value: item.message,
      })),
    ]
    : task.readiness.missing.map((item, index) => ({
      key: `missing-${index}`,
      label: '待补充',
      value: missingLabel(item),
    }));
  const nextAction: ContentProductionTaskCard['nextAction'] = overallState === 'needs_input'
    ? 'supply_input'
    : overallState === 'needs_approval'
      ? 'review'
      : overallState === 'completed'
        ? 'download'
        : ['processing', 'paused', 'failed'].includes(overallState)
          ? 'view'
          : 'none';
  const completedSummary = [
    task.sourceCount > 0 ? `已绑定 ${task.sourceCount} 项参考或素材` : '',
    task.artifactCount > 0 ? `已有 ${task.artifactCount} 个真实产物版本` : '',
    task.approvedArtifactCount > 0 ? `已批准 ${task.approvedArtifactCount} 个产物` : '',
  ].filter(Boolean);
  const runtimeCounts = runtime?.aggregate.counts;
  const lastConfirmedAt = latestConfirmedAt(task.updatedAt, runtime);
  return {
    schemaVersion: 'content-production-task-card.v1',
    id: `content-task-card:${task.taskId}`,
    contentTaskId: task.taskId,
    cardVersion: task.version,
    recoveryCursor: {
      kind: runtime ? 'task_projection' : 'task_version',
      value: runtime ? `${task.taskId}@${task.version}#${runtime.updatedAt}` : `${task.taskId}@${task.version}`,
      runId: task.runId,
    },
    title: text(task.brief.title) || '单条内容任务',
    outputType: outputType(task),
    overallState,
    currentNode: node(task, overallState),
    knownItems,
    defaultedItems,
    blockingItems,
    progress: runtimeCounts?.total
      ? { mode: 'units', completed: runtimeCounts.completed, total: runtimeCounts.total }
      : requested ? { mode: 'units', completed, total: requested } : { mode: 'none' },
    cost: runtime?.aggregate.cost ?? null,
    completedSummary,
    nextAction,
    lastConfirmedAt,
  };
}
