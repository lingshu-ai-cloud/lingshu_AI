import type { StarterAgentRole, StarterRunStatus } from './starterWorkspace';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { socialContentStatusLabel } from './socialContentModel';

export const SOCIAL_TASK_CONTEXT_PAGES = [
  'socialInspiration',
  'smartAssets',
  'scriptLibrary',
  'traffic',
  'socialMonitoring',
  'accountManagement',
  'enterprise',
] as const;

export type SocialTaskContextPage = typeof SOCIAL_TASK_CONTEXT_PAGES[number];
export type SocialTaskView = 'create' | 'publish';

type SocialTaskItem = {
  what: string;
  ownerAgent: StarterAgentRole;
};

type SocialTaskAgent = {
  role: StarterAgentRole;
  stage: string;
  status: StarterRunStatus;
};

export type SocialTaskWorkspaceSnapshot = {
  run: {
    id: string | null;
    status: StarterRunStatus;
    cycleLabel: string | null;
  };
  today: {
    completed: SocialTaskItem[];
    inProgress: SocialTaskItem[];
    nextSteps: SocialTaskItem[];
  };
  agents: SocialTaskAgent[];
};

export type SocialTaskNavigationContext = {
  runId: string;
  taskId: string;
  taskKey: string;
};

export type SocialTaskPresentation = {
  taskName: string;
  pageStage: string;
  ownerName: '灵小枢' | '灵小图' | '灵小量';
  statusLabel: string;
};

type PagePresentation = {
  pageStage: string;
  ownerName: SocialTaskPresentation['ownerName'];
  ownerRole: StarterAgentRole;
};

const SOCIAL_PAGE_SET = new Set<string>(SOCIAL_TASK_CONTEXT_PAGES);
const SOCIAL_ROLES = new Set<StarterAgentRole>(['content', 'traffic']);
const INACTIVE_AGENT_STATUSES = new Set<StarterRunStatus>(['idle', 'unknown']);

const TASK_KEY_LABELS: Record<string, string> = {
  starter_context_snapshot: '资料准备',
  content_production: '社媒内容制作',
  content_quality_gate: '内容确认',
  starter_content_release_approval: '内容确认',
  starter_publication_package: '交付包整理',
  starter_publication_evidence: '发布数据回收',
};

const RUN_STATUS_LABELS: Record<StarterRunStatus, string> = {
  idle: '尚未开始',
  running: '进行中',
  waiting_user: '待你处理',
  blocked: '暂时停留',
  error: '需要处理',
  completed: '已完成',
  paused: '已暂停',
  unknown: '状态更新中',
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pagePresentation(page: SocialTaskContextPage, view?: SocialTaskView): PagePresentation {
  switch (page) {
    case 'enterprise':
      return { pageStage: '企业知识', ownerName: '灵小枢', ownerRole: 'orchestrator' };
    case 'socialInspiration':
      return { pageStage: '灵感与素材', ownerName: '灵小图', ownerRole: 'content' };
    case 'scriptLibrary':
      return { pageStage: '脚本库', ownerName: '灵小图', ownerRole: 'content' };
    case 'smartAssets':
      return { pageStage: view === 'publish' ? '内容发布' : '内容创作', ownerName: '灵小图', ownerRole: 'content' };
    case 'traffic':
      return { pageStage: '发布与渠道', ownerName: '灵小量', ownerRole: 'traffic' };
    case 'socialMonitoring':
      return { pageStage: '内容监控', ownerName: '灵小量', ownerRole: 'traffic' };
    case 'accountManagement':
      return { pageStage: '账号管理', ownerName: '灵小量', ownerRole: 'traffic' };
  }
}

export function isSocialTaskContextPage(page: string): page is SocialTaskContextPage {
  return SOCIAL_PAGE_SET.has(page);
}

function navigationCandidate(
  page: SocialTaskContextPage,
  value: unknown,
): SocialTaskNavigationContext | null {
  const candidate = record(value);
  if (text(candidate.page) !== page) return null;
  const businessRef = record(candidate.businessRef);
  const runId = text(candidate.workflowRunId) || text(candidate.runId);
  const taskId = text(candidate.workflowTaskId) || text(candidate.taskId);
  if (!runId || !taskId) return null;
  return { runId, taskId, taskKey: text(businessRef.taskKey) };
}

/** Reads an exact task handoff without persisting it or exposing its ids in the UI. */
export function parseSocialTaskNavigationContext(
  page: SocialTaskContextPage,
  historyState: unknown,
  productionTarget: unknown,
): SocialTaskNavigationContext | null {
  const targetLink = record(record(productionTarget).link);
  const fromTarget = navigationCandidate(page, targetLink);
  if (fromTarget) return fromTarget;
  return navigationCandidate(page, record(historyState).productionDetail);
}

function currentSocialItem(workspace: SocialTaskWorkspaceSnapshot, ownerRole: StarterAgentRole): SocialTaskItem | null {
  const groups = [workspace.today.inProgress, workspace.today.nextSteps, workspace.today.completed];
  for (const items of groups) {
    const sameOwner = SOCIAL_ROLES.has(ownerRole)
      ? items.find(item => item.ownerAgent === ownerRole)
      : undefined;
    if (sameOwner) return sameOwner;
    const socialItem = items.find(item => SOCIAL_ROLES.has(item.ownerAgent));
    if (socialItem) return socialItem;
  }
  return null;
}

function hasCurrentSocialWork(workspace: SocialTaskWorkspaceSnapshot): boolean {
  const items = [
    ...workspace.today.inProgress,
    ...workspace.today.nextSteps,
    ...workspace.today.completed,
  ];
  if (items.some(item => SOCIAL_ROLES.has(item.ownerAgent))) return true;
  return workspace.agents.some(agent => (
    SOCIAL_ROLES.has(agent.role)
    && (!INACTIVE_AGENT_STATUSES.has(agent.status) || (agent.stage.trim() && agent.stage !== '尚未开始'))
  ));
}

export function resolveSocialTaskPresentation(input: {
  page: SocialTaskContextPage;
  view?: SocialTaskView;
  socialTask?: Pick<SocialContentTaskDetail, 'brief' | 'status'> | null;
  workspace: SocialTaskWorkspaceSnapshot | null;
  navigation: SocialTaskNavigationContext | null;
}): SocialTaskPresentation | null {
  const meta = pagePresentation(input.page, input.view);
  if (input.socialTask) {
    return {
      taskName: input.socialTask.brief.title,
      pageStage: meta.pageStage,
      ownerName: meta.ownerName,
      statusLabel: socialContentStatusLabel(input.socialTask.status),
    };
  }
  const workspaceMatchesNavigation = Boolean(
    input.workspace?.run.id
    && input.navigation?.runId
    && input.workspace.run.id === input.navigation.runId,
  );
  const canUseWorkspace = Boolean(
    input.workspace?.run.id
    && hasCurrentSocialWork(input.workspace)
    && (!input.navigation || workspaceMatchesNavigation),
  );

  if (canUseWorkspace && input.workspace) {
    const item = currentSocialItem(input.workspace, meta.ownerRole);
    return {
      taskName: input.workspace.run.cycleLabel || item?.what || '社媒内容任务',
      pageStage: meta.pageStage,
      ownerName: meta.ownerName,
      statusLabel: RUN_STATUS_LABELS[input.workspace.run.status],
    };
  }

  if (!input.navigation) return null;
  return {
    taskName: TASK_KEY_LABELS[input.navigation.taskKey] || '社媒内容任务',
    pageStage: meta.pageStage,
    ownerName: meta.ownerName,
    statusLabel: '任务详情',
  };
}
