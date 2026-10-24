import { assistantActionTarget, type AssistantNotificationReason, type AssistantTaskCard, type AssistantTaskCardInput } from '../../stores/assistantStore';
import type { AssistantActionId, AssistantActionRequest, AssistantActionResponse, AssistantCompactCard } from '../../../shared/contracts/assistantActions';

const FOCUSED_MUTATION_PATTERNS: Array<[AssistantActionId, RegExp]> = [
  ['start_task', /^(?:请|请帮我|帮我)?(?:现在|立即|马上)?(?:开始执行|开始|启动)(?:这个|该|当前)?(?:任务|工作|计划|执行)(?:一下)?[。！!]?$/],
  ['pause_task', /^(?:请|请帮我|帮我)?(?:我想|我希望)?(?:现在|立即|马上)?(?:暂停|先暂停|停止)(?:这个|该|当前)?(?:任务|工作|计划|执行|运行)(?:一下)?[。！!]?$/],
  ['resume_task', /^(?:请|请帮我|帮我)?(?:我想|我希望)?(?:现在|立即|马上)?(?:继续执行|继续|恢复)(?:这个|该|当前)?(?:任务|工作|计划|执行|运行)?[。！!]?$/],
  ['confirm_choice', /^(?:请)?(?:(?:确认|采用|选择)(?:这个|该|当前)?(?:选择|方案|选项)|(?:批准|确认)(?:这个|该|当前|这份)?报价)[。！!]?$/],
  ['accept_result', /^(?:请)?(?:验收通过|接受结果|确认结果)[。！!]?$/],
  ['request_revision', /^(?:请)?(?:退回修改|要求修改|修改(?:这个|该|当前)?(?:结果|方案)|重新做|再改)(?:一下)?[。！!]?$/],
];

export function focusedNaturalLanguageActionId(text: string): AssistantActionId | undefined {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const matches = FOCUSED_MUTATION_PATTERNS.filter(([, pattern]) => pattern.test(normalized));
  return matches.length === 1 ? matches[0][0] : undefined;
}

export function isWeeklyPlanKickoffRequest(text: string): boolean {
  const normalized = text.trim().replace(/[。！!]+$/u, '').replace(/\s+/gu, '');
  return /^(?:(?:请|请帮我|帮我|现在|立即|马上))*(?:开始|启动|制定|生成|创建)(?:(?:本周|这周|当前周))?(?:生产|制作|周计划|计划|周任务|任务)$/u.test(normalized);
}

export function focusedNaturalLanguageActionInput(
  card: AssistantTaskCard | null | undefined,
  actionId: AssistantActionId,
): Pick<AssistantActionRequest, 'target' | 'parameters'> | undefined {
  const target = assistantActionTarget(card, actionId);
  if (!card || !target?.objectId || !target.expectedVersion) return undefined;
  const matchingActions = [card.primaryAction, ...card.secondaryActions].filter(action => (
    action?.actionId === actionId
    && action.target?.objectType === target.objectType
    && action.target.objectId?.trim() === target.objectId
    && action.target.expectedVersion?.trim() === target.expectedVersion
  ));
  if (matchingActions.length !== 1) return undefined;
  const parameters = matchingActions[0]?.parameters;
  return { target, ...(parameters ? { parameters } : {}) };
}

export function actionResponseCardId(
  request: AssistantActionRequest,
  response: AssistantActionResponse,
  existingCards: Record<string, AssistantTaskCard>,
): string {
  const responseActions = [response.card.primaryAction, ...(response.card.secondaryActions ?? [])];
  const requestObjectId = request.target?.objectId?.trim();
  const requestObjectType = request.target?.objectType;
  const responseTargets = responseActions
    .map(action => action?.target)
    .filter((target): target is NonNullable<typeof target> => Boolean(target?.objectId?.trim()));
  const responseObjectIds = [...new Set(responseTargets.map(target => target.objectId!.trim()))];
  const responseDisagreesWithRequest = Boolean(requestObjectId)
    && responseTargets.some(target => (
      target.objectId?.trim() !== requestObjectId
      || (requestObjectType && target.objectType !== requestObjectType)
    ));
  // Never attach a cross-object response to either the request card or an
  // existing card for the unexpected response target. Treat it as a new
  // response until the server and caller agree on one business object.
  if (responseDisagreesWithRequest) return response.requestId || request.requestId;
  const objectId = requestObjectId || (responseObjectIds.length === 1 ? responseObjectIds[0] : undefined);
  if (!objectId) return response.requestId || request.requestId;
  if (existingCards[objectId]) return objectId;
  const matchingCardIds = Object.entries(existingCards)
    .filter(([, card]) => [card.primaryAction, ...card.secondaryActions]
      .some(action => (
        action?.target?.objectId?.trim() === objectId
        && (!requestObjectType || action.target.objectType === requestObjectType)
      )))
    .map(([cardId]) => cardId);
  return matchingCardIds.length === 1
    ? matchingCardIds[0]
    : response.requestId || request.requestId;
}

function responseHasCrossObjectAction(
  request: AssistantActionRequest,
  response: AssistantActionResponse,
): boolean {
  const requestObjectId = request.target?.objectId?.trim();
  const requestObjectType = request.target?.objectType;
  if (!requestObjectId || !requestObjectType) return false;
  return [response.card.primaryAction, ...(response.card.secondaryActions ?? [])]
    .some(action => Boolean(
      action?.target?.objectId?.trim()
      && (
        action.target.objectId.trim() !== requestObjectId
        || action.target.objectType !== requestObjectType
      )
    ));
}

export function responseWithoutCrossObjectActions(
  request: AssistantActionRequest,
  response: AssistantActionResponse,
): AssistantActionResponse {
  if (!responseHasCrossObjectAction(request, response)) return response;
  const requestObjectId = request.target?.objectId?.trim();
  const requestObjectType = request.target?.objectType;
  const safeAction = (action: AssistantCompactCard['primaryAction']) => (
    !action?.target?.objectId?.trim()
    || (
      action.target.objectId.trim() === requestObjectId
      && action.target.objectType === requestObjectType
    )
  );
  return {
    ...response,
    card: {
      ...response.card,
      primaryAction: safeAction(response.card.primaryAction) ? response.card.primaryAction : undefined,
      secondaryActions: (response.card.secondaryActions ?? []).filter(safeAction),
    },
  };
}

export function notificationReasonFromResponse(response: AssistantActionResponse): AssistantNotificationReason {
  if (response.status === 'missing_required_input') return 'missing_input';
  if (response.status === 'approval_required') return 'approval_required';
  if (response.status === 'failed' || response.status === 'stale_action') return 'failed';
  return 'routine';
}

function taskStatusFromResponse(response: AssistantActionResponse): AssistantTaskCard['status'] {
  if (response.status === 'missing_required_input') return 'needs_input';
  if (response.status === 'approval_required') return 'approval';
  if (response.status === 'failed' || response.status === 'stale_action') return 'failed';
  const signedRunControl = [response.card.primaryAction, ...(response.card.secondaryActions ?? [])]
    .find(action => action?.actionId === 'pause_task' || action?.actionId === 'resume_task');
  if (signedRunControl?.actionId === 'resume_task') return 'paused';
  if (signedRunControl?.actionId === 'pause_task') return 'running';
  if (response.actionId === 'pause_task' && (response.status === 'accepted' || response.status === 'completed')) return 'paused';
  if (response.actionId === 'resume_task' && (response.status === 'accepted' || response.status === 'completed')) return 'running';
  if (response.status === 'accepted' || response.status === 'delegated') return 'running';
  return 'completed';
}

export function actionCardToTaskCard(
  card: AssistantCompactCard,
  response: AssistantActionResponse,
  stableTaskId: string,
): AssistantTaskCardInput {
  return {
    taskId: stableTaskId,
    title: card.title,
    conclusion: card.summary,
    details: card.details,
    items: card.items,
    status: taskStatusFromResponse(response),
    notificationReason: notificationReasonFromResponse(response),
    primaryAction: card.primaryAction,
    secondaryActions: card.secondaryActions,
    workspace: response.workspace,
  };
}
