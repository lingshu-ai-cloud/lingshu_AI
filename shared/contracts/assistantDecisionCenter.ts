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

export type AssistantDecisionActionResponse = AssistantDecisionFeed & {
  ok: true;
  outcome: 'completed' | 'already_completed' | 'navigation_required';
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
