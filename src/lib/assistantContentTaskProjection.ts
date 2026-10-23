import type { ContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard';
import type { AssistantTaskCardInput } from '../stores/assistantStore';

const stateMap: Record<ContentProductionTaskCard['overallState'], AssistantTaskCardInput['status']> = {
  needs_input: 'needs_input',
  needs_approval: 'approval',
  processing: 'running',
  paused: 'paused',
  failed: 'failed',
  completed: 'completed',
  cancelled: 'completed',
};

const actionLabels: Record<ContentProductionTaskCard['nextAction'], string> = {
  supply_input: '补充必要资料',
  review: '查看并验收',
  view: '查看任务详情',
  download: '查看交付结果',
  none: '查看任务记录',
};

function costDetail(card: ContentProductionTaskCard): string | null {
  const cost = card.cost;
  if (!cost) return null;
  if (cost.status === 'unknown') return '费用：暂时无法核实';
  if (cost.actualCny !== null) return `已结算费用：¥${cost.actualCny.toFixed(2)}`;
  if (cost.upperBoundCny !== null) return `费用上限：¥${cost.upperBoundCny.toFixed(2)}（待结算）`;
  if (cost.expectedCny !== null) return `预计费用：¥${cost.expectedCny.toFixed(2)}（待结算）`;
  if (cost.status === 'free') return '费用：¥0.00';
  return null;
}

export function unavailableContentTaskCard(card: ContentProductionTaskCard): ContentProductionTaskCard {
  return {
    ...card,
    readState: 'unavailable',
    currentNode: {
      id: 'status_unavailable',
      label: '状态连接中断',
      userFacingSummary: `暂时无法读取最新状态；当前展示的是 ${card.lastConfirmedAt} 的最后确认结果，正在自动恢复。`,
    },
  };
}

export function contentTaskCardToAssistantCard(card: ContentProductionTaskCard): AssistantTaskCardInput {
  const confirmedCost = costDetail(card);
  const details = [
    ...(card.readState === 'unavailable' ? [`状态读取失败；最后确认：${card.lastConfirmedAt}`] : []),
    ...card.blockingItems.map(item => `${item.label}：${item.value}`),
    ...card.knownItems.map(item => `已确定 · ${item.label}：${item.value}`),
    ...card.defaultedItems.map(item => `采用默认 · ${item.label}：${item.value}`),
    ...card.completedSummary,
    ...(confirmedCost ? [confirmedCost] : []),
    `最近确认：${card.lastConfirmedAt}`,
  ];
  const notificationReason = card.overallState === 'needs_input'
    ? 'missing_input'
    : card.overallState === 'needs_approval'
      ? 'approval_required'
      : card.overallState === 'failed'
        ? 'failed'
        : 'routine';
  const href = `/?page=smartAssets&view=create&socialContentTaskId=${encodeURIComponent(card.contentTaskId)}`;
  return {
    taskId: `social-content:${card.contentTaskId}`,
    title: card.title,
    conclusion: card.currentNode.userFacingSummary,
    details: details.slice(0, 3),
    status: stateMap[card.overallState],
    notificationReason,
    contentTask: card,
    primaryAction: {
      id: `open-content-task-${card.contentTaskId}`,
      label: actionLabels[card.nextAction],
      href,
    },
    updatedAt: Number.isFinite(Date.parse(card.lastConfirmedAt)) ? Date.parse(card.lastConfirmedAt) : Date.now(),
  };
}
