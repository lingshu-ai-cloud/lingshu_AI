export const ASSISTANT_DECISION_PAGE_IDS = [
  'home',
  'digitalEmployees',
  'socialInspiration',
  'scriptLibrary',
  'smartAssets',
  'publishing',
  'conversion',
  'enterprise',
  'accountManagement',
  'plugins',
  'scheduled',
] as const;

export type AssistantDecisionPage = typeof ASSISTANT_DECISION_PAGE_IDS[number];

export type AssistantDecisionKind =
  | 'plan_start'
  | 'plan_adjustment'
  | 'external_approval'
  | 'content_approval'
  | 'input_required'
  | 'next_step';

export type AssistantDecisionActionId =
  | 'approve_and_start'
  | 'adjust_plan'
  | 'approve'
  | 'reject'
  | 'take_over'
  | 'open_workspace';

export type AssistantDecisionSubjectType =
  | 'weekly_plan'
  | 'approval_request'
  | 'workflow_task';

export type AssistantDecisionAction = {
  id: AssistantDecisionActionId;
  label: string;
  mode: 'command' | 'navigate';
  emphasis: 'primary' | 'default' | 'danger';
  requiresNote?: boolean;
};

export type AssistantDecisionFact = {
  label: string;
  value: string;
  tone?: 'default' | 'info' | 'warning' | 'danger';
};

export type AssistantDecisionDeepLink = {
  page: string;
  view?: 'create' | 'publish';
  studioPanel?: 'projects';
  runId?: string;
  taskId?: string;
  businessRef?: Record<string, unknown>;
};

export type AssistantDecisionCard = {
  id: string;
  kind: AssistantDecisionKind;
  priority: number;
  status: 'pending';
  title: string;
  summary: string;
  facts: AssistantDecisionFact[];
  subject: {
    type: AssistantDecisionSubjectType;
    id: string;
    /** Opaque optimistic-concurrency token. Clients must echo it unchanged. */
    version: string;
  };
  actions: AssistantDecisionAction[];
  deepLink?: AssistantDecisionDeepLink;
  createdAt: string;
};

export type AssistantDecisionFeed = {
  items: AssistantDecisionCard[];
  total: number;
  generatedAt: string;
  page: AssistantDecisionPage;
};

export type AssistantDecisionCommand = {
  actionId: AssistantDecisionActionId;
  expectedVersion: string;
  note?: string;
  /** Optional retry key. The server also derives a stable key when omitted. */
  idempotencyKey?: string;
};

/** Compact receipt of a persisted workflow; preparation is not a running workflow. */
export type AssistantDecisionExecutionReceipt = {
  goalId: string;
  runId: string;
  status: string;
  taskCount: number;
  startedAt: string;
};

export function normalizeAssistantDecisionExecutionReceipt(value: unknown): AssistantDecisionExecutionReceipt | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const statuses = ['initializing', 'planning', 'queued', 'running', 'waiting_external', 'waiting_approval', 'waiting_human', 'paused', 'succeeded', 'failed', 'cancelled'];
  if (typeof source.goalId !== 'string' || !source.goalId.trim()
    || typeof source.runId !== 'string' || !source.runId.trim()
    || typeof source.status !== 'string' || !statuses.includes(source.status)
    || typeof source.taskCount !== 'number' || !Number.isSafeInteger(source.taskCount) || source.taskCount < 1
    || typeof source.startedAt !== 'string' || !Number.isFinite(Date.parse(source.startedAt))) return undefined;
  return {
    goalId: source.goalId.trim(), runId: source.runId.trim(), status: source.status,
    taskCount: source.taskCount, startedAt: source.startedAt,
  };
}

export type AssistantDecisionActionResponse = AssistantDecisionFeed & {
  ok: true;
  outcome: 'completed' | 'already_completed' | 'navigation_required';
  execution?: AssistantDecisionExecutionReceipt;
};

export function normalizeAssistantDecisionPage(value: unknown): AssistantDecisionPage {
  const raw = String(value || '').trim();
  const aliases: Record<string, AssistantDecisionPage> = {
    strategy: 'home',
    socialWorkspace: 'digitalEmployees',
    socialSetup: 'digitalEmployees',
    socialPlanning: 'digitalEmployees',
    socialAccounts: 'accountManagement',
    traffic: 'publishing',
    socialMonitoring: 'publishing',
    retention: 'conversion',
    wecomCustomerService: 'conversion',
    orders: 'conversion',
    channels: 'plugins',
    youtube: 'plugins',
  };
  if (aliases[raw]) return aliases[raw];
  const page = raw as AssistantDecisionPage;
  return (ASSISTANT_DECISION_PAGE_IDS as readonly string[]).includes(page) ? page : 'home';
}
