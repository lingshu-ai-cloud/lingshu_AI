import type { AssistantActionTarget, AssistantCardAction } from '../../shared/contracts/assistantActions.js';
import type { Starter198OrgRole, StarterWorkspaceCommandInput, StarterWorkspaceV1 } from '../../shared/contracts/starter198.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { createStarter198ApprovalDecisionPort } from '../starter198/approvalDecision.js';
import {
  runStarter198Command,
  Starter198CommandError,
  type Starter198CommandDependencies,
} from '../starter198/commands.js';
import { createStarter198OrchestratorQueue } from '../starter198/orchestratorQueue.js';
import { starter198OrgRole } from '../starter198/profile.js';
import { createStarter198QuoteDecisionPort } from '../starter198/quoteDecision.js';
import { starter198Repository, type Starter198Repository } from '../starter198/repository.js';
import { buildStarter198Workspace } from '../starter198/workspace.js';
import {
  AssistantActionConflictError,
  AssistantActionError,
  normalizeAssistantActionParameters,
  type AssistantActionContext,
  type AssistantBusinessCommand,
  type AssistantBusinessCommandBus,
  type AssistantBusinessResult,
} from './actionRouting.js';
import {
  createScheduleAdjustmentService,
  ScheduleAdjustmentError,
  type PreparedScheduleChange,
  type ScheduleAdjustmentService,
} from './scheduleAdjustment.js';
import {
  AssistantSearchUnavailableError,
  createAssistantSearchProvider,
  type AssistantSearchProvider,
} from './searchProvider.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export type StarterAssistantCommandBusDependencies = {
  repository?: Starter198Repository;
  commandDependencies?: Starter198CommandDependencies;
  resolveRole?: (context: AssistantActionContext) => Promise<Starter198OrgRole | null>;
  scheduleAdjustment?: ScheduleAdjustmentService;
  searchProvider?: AssistantSearchProvider;
};

const calendarHref = '/?page=traffic#publishing-calendar';

function scheduleCardItems(change: PreparedScheduleChange) {
  return change.items.map(item => ({
    id: item.id,
    title: item.title,
    ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
    accountLabel: item.accountLabel ? `${item.accountLabel} · ${change.platformLabel}` : change.platformLabel,
    transition: `${change.sourceLabel} → ${change.targetLabel}`,
    note: '无需重新制作',
  }));
}

function scheduleConfirmation(change: PreparedScheduleChange): AssistantBusinessResult {
  const accountLabels = [...new Set(change.items.map(item => item.accountLabel).filter(Boolean))];
  return {
    status: 'approval_required',
    title: '确认调整排期',
    summary: `找到 ${change.items.length} 条待发布视频，调整后仍保持原发布时间。`,
    details: [
      `${change.sourceLabel} → ${change.targetLabel}`,
      `账号：${accountLabels.length ? accountLabels.join('、') : '排期记录未标注账号'} · ${change.platformLabel}`,
      '无需重新制作',
    ],
    items: scheduleCardItems(change),
    version: change.expectedVersion,
    primaryAction: {
      id: `confirm-schedule:${change.id}`,
      label: '确认调整',
      actionId: 'confirm_schedule_change',
      target: { objectType: 'schedule_change', objectId: change.id, expectedVersion: change.expectedVersion },
    },
    secondaryActions: [{ id: `modify-schedule:${change.id}`, label: '修改时间', href: calendarHref }],
  };
}

function scheduleFailure(error: ScheduleAdjustmentError): AssistantBusinessResult {
  if (error.status === 409 || error.status === 404) throw new AssistantActionConflictError(error.publicMessage);
  return {
    status: error.status < 500 ? 'missing_required_input' : 'failed',
    title: error.status < 500 ? '需要重新核对排期' : '排期调整未完成',
    summary: error.publicMessage,
    workspace: ['assistant_schedule_update_partial', 'assistant_schedule_receipt_failed'].includes(error.code)
      ? { label: '查看日历', href: calendarHref }
      : undefined,
  };
}

function workspaceHref(page = 'digitalEmployees', targetId?: string): string {
  const query = new URLSearchParams({ page });
  if (targetId) query.set('focus', targetId);
  return `/?${query.toString()}`;
}

function requiredVersion(command: AssistantBusinessCommand): string {
  const version = text(command.target?.expectedVersion);
  if (!version) {
    throw new AssistantActionError(
      'assistant_action_expected_version_required',
      400,
      '请刷新工作区后再确认，当前操作缺少版本信息。',
    );
  }
  return version;
}

function decisionChoice(command: AssistantBusinessCommand): {
  decision: 'approved' | 'rejected';
  note: string;
  selection: { option: string; value: string; parameters: Record<string, unknown> };
} {
  const normalized = normalizeAssistantActionParameters(command.actionId, command.parameters);
  const option = text(normalized.option);
  const value = text(normalized.value);
  const parameters = (normalized.parameters && typeof normalized.parameters === 'object' && !Array.isArray(normalized.parameters))
    ? normalized.parameters as Record<string, unknown>
    : {};
  const decision = option === 'request_revision' ? 'rejected' : 'approved';
  return {
    decision,
    note: text(parameters.note) || (decision === 'approved' ? '用户通过灵小枢确认' : '用户要求修改'),
    selection: { option, value, parameters },
  };
}

export function toStarterCommand(command: AssistantBusinessCommand): StarterWorkspaceCommandInput {
  const targetId = text(command.target?.objectId);
  if (command.actionId === 'start_task') {
    const input = text(command.parameters.goal);
    if (!input) {
      throw new AssistantActionError('assistant_action_goal_required', 400, '请先告诉灵小枢这次要完成什么目标。');
    }
    return {
      command: 'submit_orchestrator_input',
      idempotencyKey: command.requestId,
      payload: { input },
    };
  }
  if (command.actionId === 'pause_task') {
    return {
      command: 'pause_run',
      idempotencyKey: command.requestId,
      targetId,
      expectedVersion: requiredVersion(command),
      payload: { reason: text(command.parameters.reason) || '用户通过灵小枢暂停' },
    };
  }
  if (command.actionId === 'resume_task') {
    return {
      command: 'resume_run',
      idempotencyKey: command.requestId,
      targetId,
      expectedVersion: requiredVersion(command),
      payload: {},
    };
  }
  if (['confirm_choice', 'accept_result', 'request_revision'].includes(command.actionId)) {
    const choice = decisionChoice(command);
    return {
      command: 'resolve_decision',
      idempotencyKey: command.requestId,
      targetId,
      expectedVersion: requiredVersion(command),
      payload: {
        decision: choice.decision,
        note: choice.note,
        selection: choice.selection,
      },
    };
  }
  throw new AssistantActionError('assistant_action_not_executable', 400, '这个操作暂时不能执行。');
}

function runControlAction(workspace: StarterWorkspaceV1): AssistantCardAction | undefined {
  const control = workspace.controls.find(item => (
    (item.command === 'pause_run' || item.command === 'resume_run')
    && item.expectedVersion
    && workspace.run.id
    && !item.disabledReason
  ));
  if (!control?.expectedVersion || !workspace.run.id) return undefined;
  const paused = control.command === 'resume_run';
  return {
    id: `${paused ? 'resume' : 'pause'}:${workspace.run.id}`,
    label: paused ? '继续任务' : '暂停任务',
    actionId: paused ? 'resume_task' : 'pause_task',
    target: {
      objectType: 'run', objectId: workspace.run.id, expectedVersion: control.expectedVersion,
    },
  };
}

function executableDecisions(workspace: StarterWorkspaceV1): StarterWorkspaceV1['decisions'] {
  return workspace.decisions.filter(item => {
    const subjectVersion = text(item.subjectVersion);
    return Boolean(subjectVersion) && item.actions.some(action => (
      action.command === 'resolve_decision'
      && !action.disabledReason
      && text(action.expectedVersion) === subjectVersion
    ));
  });
}

function decisionActions(workspace: StarterWorkspaceV1): {
  primaryAction?: AssistantCardAction;
  secondaryActions?: AssistantCardAction[];
} {
  const controlAction = runControlAction(workspace);
  const decision = executableDecisions(workspace)[0];
  if (!decision?.subjectVersion) {
    return controlAction ? { primaryAction: controlAction } : {};
  }
  const target = {
    objectType: 'approval' as const,
    objectId: decision.id,
    expectedVersion: decision.subjectVersion,
  };
  if (decision.type === 'quotation') {
    const secondaryActions: AssistantCardAction[] = [({
      id: `revise:${decision.id}`,
      label: '退回调整',
      actionId: 'request_revision',
      target,
      parameters: { option: 'request_revision', value: 'revision_requested', parameters: {} },
    } satisfies AssistantCardAction), ...(controlAction ? [controlAction] : [])].slice(0, 2);
    return {
      primaryAction: {
        id: `approve:${decision.id}`,
        label: '批准报价',
        actionId: 'confirm_choice',
        target,
        parameters: { option: 'approve', value: 'approved', parameters: {} },
      },
      secondaryActions,
    };
  }
  const secondaryActions: AssistantCardAction[] = [({
    id: `revise:${decision.id}`,
    label: '退回修改',
    actionId: 'request_revision',
    target,
    parameters: { option: 'request_revision', value: 'revision_requested', parameters: {} },
  } satisfies AssistantCardAction), ...(controlAction ? [controlAction] : [])].slice(0, 2);
  return {
    primaryAction: {
      id: `accept:${decision.id}`,
      label: '验收通过',
      actionId: 'accept_result',
      target,
      parameters: { option: 'accept_result', value: 'accepted', parameters: {} },
    },
    secondaryActions,
  };
}

function workspaceResultStatus(workspace: StarterWorkspaceV1): NonNullable<AssistantBusinessResult['status']> {
  if (['blocked', 'error', 'unknown'].includes(workspace.run.status)) return 'failed';
  if (executableDecisions(workspace).length > 0) return 'approval_required';
  if (['running', 'waiting_user', 'paused'].includes(workspace.run.status)) return 'accepted';
  return 'completed';
}

function workspaceStatusSummary(workspace: StarterWorkspaceV1): string {
  if (workspace.run.status === 'idle') return '当前没有运行中的任务';
  if (workspace.run.status === 'blocked') return '当前任务已阻塞，请进入工作区处理阻塞原因。';
  if (workspace.run.status === 'error') return '当前任务执行失败，请进入工作区查看错误并重试。';
  if (workspace.run.status === 'unknown') return '当前任务状态无法确认，请进入工作区核对后再继续。';
  return `当前任务状态：${workspace.run.status}`;
}

export function actionsForMutationTarget(
  actions: ReturnType<typeof decisionActions>,
  target: AssistantActionTarget | undefined,
): ReturnType<typeof decisionActions> {
  const expectedTargetId = text(target?.objectId);
  const expectedTargetType = target?.objectType;
  if (!expectedTargetId || !expectedTargetType) return actions;
  const matching = [actions.primaryAction, ...(actions.secondaryActions ?? [])]
    .filter((action): action is AssistantCardAction => (
      action?.target?.objectType === expectedTargetType
      && action.target.objectId === expectedTargetId
    ));
  if (!matching.length) return {};
  return {
    primaryAction: matching[0],
    ...(matching.length > 1 ? { secondaryActions: matching.slice(1, 3) } : {}),
  };
}

async function resolveDefaultRole(context: AssistantActionContext): Promise<Starter198OrgRole | null> {
  return starter198OrgRole(await requestOrganizationRoleStrict(context.authorization, context.userId));
}

function commandError(error: unknown): never {
  if (error instanceof AssistantActionError) throw error;
  if (error instanceof Starter198CommandError) {
    if (error.status === 409) throw new AssistantActionConflictError();
    const publicMessage = error.status === 403
      ? '当前账号没有执行这个操作的权限。'
      : error.status >= 500
        ? '业务服务暂时不可用，请稍后重试。'
        : '当前状态不允许执行这个操作。';
    throw new AssistantActionError(error.code, error.status, publicMessage);
  }
  throw error;
}

/**
 * The adapter owns no business mutation. It maps assistant intents onto the
 * existing versioned Starter command API, preserving role checks, tenant
 * scoping, idempotency and audit attribution.
 */
export function createStarter198AssistantCommandBus(
  dependencies: StarterAssistantCommandBusDependencies = {},
): AssistantBusinessCommandBus {
  const repository = dependencies.repository ?? starter198Repository;
  const resolveRole = dependencies.resolveRole ?? resolveDefaultRole;
  const commandDependencies: Starter198CommandDependencies = {
    orchestratorQueue: createStarter198OrchestratorQueue(),
    approvalDecision: createStarter198ApprovalDecisionPort(),
    quoteDecision: createStarter198QuoteDecisionPort(),
    ...dependencies.commandDependencies,
    repository,
  };
  const scheduleAdjustment = dependencies.scheduleAdjustment
    ?? (repository.dataStore ? createScheduleAdjustmentService(repository.dataStore) : null);
  // Construction is side-effect free. Search backends are read only when an
  // explicit search action reaches this branch; view_status never wakes them.
  const searchProvider = dependencies.searchProvider ?? createAssistantSearchProvider({
    dataStore: repository.dataStore,
  });

  return {
    async execute(command, context): Promise<AssistantBusinessResult> {
      const role = await resolveRole(context);
      if (!role) {
        throw new AssistantActionError('assistant_action_role_required', 403, '当前账号没有执行这个操作的权限。');
      }

      if (command.actionId === 'prepare_schedule_change') {
        if (!scheduleAdjustment) return { status: 'failed', summary: '排期服务暂时不可用，本次未修改任何视频排期。' };
        try {
          const change = await scheduleAdjustment.prepare({
            tenantId: context.tenantId,
            userId: context.userId,
            requestId: command.requestId,
            platform: text(command.parameters.platform),
            sourceWeekday: Number(command.parameters.sourceWeekday),
            targetWeekday: Number(command.parameters.targetWeekday),
            count: Number(command.parameters.count),
          });
          return scheduleConfirmation(change);
        } catch (error) {
          if (error instanceof ScheduleAdjustmentError) return scheduleFailure(error);
          return { status: 'failed', summary: '排期服务暂时不可用，本次未修改任何视频排期。' };
        }
      }

      if (command.actionId === 'confirm_schedule_change') {
        if (!scheduleAdjustment) return { status: 'failed', summary: '排期服务暂时不可用，本次调整未完成。' };
        try {
          const change = await scheduleAdjustment.confirm({
            tenantId: context.tenantId,
            userId: context.userId,
            changeId: text(command.target?.objectId),
            expectedVersion: requiredVersion(command),
          });
          return {
            status: 'completed',
            title: `${change.items.length} 条排期已更新`,
            summary: `已将 ${change.platformLabel} 待发布视频从${change.sourceLabel}调整到${change.targetLabel}，原发布时间保持不变。`,
            details: [`${change.sourceLabel} → ${change.targetLabel}`, '无需重新制作'],
            items: scheduleCardItems(change),
            version: change.expectedVersion,
            workspace: { label: '查看日历', href: calendarHref },
          };
        } catch (error) {
          if (error instanceof ScheduleAdjustmentError) return scheduleFailure(error);
          return { status: 'failed', summary: '排期服务暂时不可用，本次调整未完成。' };
        }
      }

      if (command.actionId === 'open_workspace') {
        const page = text(command.parameters.page) || context.page || 'digitalEmployees';
        const workspace = { label: '打开工作区', href: workspaceHref(page, command.target?.objectId) };
        return { title: '工作区已准备好', summary: '点击即可查看完整内容。', workspace };
      }

      if (command.actionId === 'search') {
        try {
          const result = await searchProvider.search({
            tenantId: context.tenantId,
            query: text(command.parameters.query),
            page: text(command.parameters.page) || context.page,
          });
          const label = result.domain === 'materials' ? '素材' : '视频';
          const visible = Math.min(result.total, result.items.length);
          return {
            status: 'completed',
            title: result.total ? `找到 ${result.total} 条${label}` : `没有找到匹配的${label}`,
            summary: result.total
              ? `以下是当前真实数据中最相关的 ${visible} 条结果。`
              : `当前${label}库中没有与“${text(command.parameters.query)}”匹配的记录。`,
            details: [
              `共 ${result.total} 条`,
              ...(result.sourceStatus === 'partial' ? ['部分素材来源暂时不可用，以上总数仅包含已读取数据'] : []),
            ],
            items: result.items,
            workspace: result.workspace,
          };
        } catch (error) {
          if (error instanceof AssistantSearchUnavailableError) {
            return { status: 'failed', title: '搜索暂时不可用', summary: error.publicMessage };
          }
          return {
            status: 'failed',
            title: '搜索暂时不可用',
            summary: '真实数据查询没有完成，本次未返回未经核实的结果。',
          };
        }
      }

      if (command.actionId === 'view_status') {
        try {
          const pendingScheduleChange = scheduleAdjustment ? await scheduleAdjustment.pendingForUser({
            tenantId: context.tenantId,
            userId: context.userId,
          }) : null;
          if (pendingScheduleChange) return scheduleConfirmation(pendingScheduleChange);
          const workspaceModel = await buildStarter198Workspace({
            tenantId: context.tenantId,
            role,
            repository,
            orchestratorAvailable: Boolean(commandDependencies.orchestratorQueue),
            decisionAvailable: Boolean(commandDependencies.approvalDecision),
            quoteDecisionAvailable: Boolean(commandDependencies.quoteDecision),
          });
          const inProgress = workspaceModel.today.inProgress.length;
          const decisions = executableDecisions(workspaceModel).length;
          const runLabel = workspaceStatusSummary(workspaceModel);
          const workspace = {
            label: '查看工作区',
            href: workspaceHref(context.page || 'digitalEmployees', workspaceModel.run.id ?? undefined),
          };
          const status = workspaceResultStatus(workspaceModel);
          const actions = status === 'failed' ? {} : decisionActions(workspaceModel);
          return {
            status,
            title: '当前工作状态',
            summary: runLabel,
            details: [`进行中 ${inProgress} 项`, `待确认 ${decisions} 项`],
            version: workspaceModel.generatedAt,
            workspace,
            ...actions,
          };
        } catch (error) {
          commandError(error);
        }
      }

      try {
        const result = await runStarter198Command({
          tenantId: context.tenantId,
          userId: context.userId,
          role,
          request: toStarterCommand(command),
          dependencies: commandDependencies,
        });
        let refreshed: StarterWorkspaceV1 | null = null;
        try {
          refreshed = await buildStarter198Workspace({
            tenantId: context.tenantId,
            role,
            repository,
            orchestratorAvailable: Boolean(commandDependencies.orchestratorQueue),
            decisionAvailable: Boolean(commandDependencies.approvalDecision),
            quoteDecisionAvailable: Boolean(commandDependencies.quoteDecision),
          });
        } catch {
          // The business command is already durable. A projection read failure
          // must not rewrite that known outcome as a failed mutation.
        }
        const actions = refreshed
          ? actionsForMutationTarget(decisionActions(refreshed), command.target)
          : {};
        const focusId = refreshed?.run.id ?? command.target?.objectId;
        const workspace = {
          label: command.actionId === 'start_task' ? '查看任务排期' : '查看任务',
          href: workspaceHref(context.page || 'digitalEmployees', focusId ?? undefined),
        };
        return {
          status: result.status === 202 ? 'accepted' : 'completed',
          title: result.status === 202 ? '任务已接收' : '操作已完成',
          summary: result.body.message || (result.status === 202 ? '灵小枢正在推进这项工作。' : '工作状态已更新。'),
          version: actions.primaryAction?.target?.expectedVersion ?? command.target?.expectedVersion,
          workspace,
          ...actions,
        };
      } catch (error) {
        commandError(error);
      }
    },
  };
}
