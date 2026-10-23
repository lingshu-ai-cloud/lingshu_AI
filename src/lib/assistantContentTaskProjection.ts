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

export function contentTaskCardToAssistantCard(card: ContentProductionTaskCard): AssistantTaskCardInput {
  const details = [
    ...card.blockingItems.map(item => `${item.label}：${item.value}`),
    ...card.knownItems.map(item => `已确定 · ${item.label}：${item.value}`),
    ...card.defaultedItems.map(item => `采用默认 · ${item.label}：${item.value}`),
    ...card.completedSummary,
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
