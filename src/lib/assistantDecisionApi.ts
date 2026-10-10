import type {
  AssistantDecisionAction,
  AssistantDecisionActionId,
  AssistantDecisionActionResponse,
  AssistantDecisionCard,
  AssistantDecisionCommand,
  AssistantDecisionDeepLink,
  AssistantDecisionFact,
  AssistantDecisionFeed,
  AssistantDecisionKind,
  AssistantDecisionPage,
} from '../../shared/contracts/assistantDecisionCenter';
import { normalizeAssistantDecisionPage } from '../../shared/contracts/assistantDecisionCenter';
import { authHeader } from './auth';

const BASE = '/api/overseas/digital-employees/assistant/decision-center';

export type {
  AssistantDecisionAction,
  AssistantDecisionActionId,
  AssistantDecisionActionResponse,
  AssistantDecisionCard,
  AssistantDecisionCommand,
  AssistantDecisionDeepLink,
  AssistantDecisionFact,
  AssistantDecisionFeed,
  AssistantDecisionKind,
  AssistantDecisionPage,
};

export class AssistantDecisionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = '',
  ) {
    super(message);
    this.name = 'AssistantDecisionApiError';
  }
}

const decisionKinds = new Set<AssistantDecisionKind>([
  'plan_start',
  'plan_adjustment',
  'external_approval',
  'content_approval',
  'input_required',
  'next_step',
]);
const actionIds = new Set<AssistantDecisionActionId>([
  'approve_and_start',
  'adjust_plan',
  'approve',
  'reject',
  'take_over',
  'open_workspace',
]);
const subjectTypes = new Set<AssistantDecisionCard['subject']['type']>([
  'weekly_plan',
  'approval_request',
  'workflow_task',
]);

function text(value: unknown, max = 300): string {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeFact(value: unknown): AssistantDecisionFact | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const label = text(source.label, 40);
  const factValue = text(source.value, 160);
  if (!label || !factValue) return null;
  const tone = ['default', 'info', 'warning', 'danger'].includes(String(source.tone))
    ? source.tone as AssistantDecisionFact['tone']
    : undefined;
  return { label, value: factValue, ...(tone ? { tone } : {}) };
}

function normalizeAction(value: unknown): AssistantDecisionAction | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = source.id as AssistantDecisionActionId;
  const label = text(source.label, 40);
  if (!actionIds.has(id) || !label) return null;
  const mode = source.mode === 'navigate' ? 'navigate' : 'command';
  const emphasis = ['primary', 'default', 'danger'].includes(String(source.emphasis))
    ? source.emphasis as AssistantDecisionAction['emphasis']
    : 'default';
  return { id, label, mode, emphasis, ...(source.requiresNote === true ? { requiresNote: true } : {}) };
}

function normalizeDeepLink(value: unknown): AssistantDecisionDeepLink | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const page = text(source.page, 80);
  if (!page) return undefined;
  const view = source.view === 'create' || source.view === 'publish' ? source.view : undefined;
  const studioPanel = source.studioPanel === 'projects' ? 'projects' : undefined;
  const runId = text(source.runId, 160) || undefined;
  const taskId = text(source.taskId, 160) || undefined;
  const rawBusinessRef = source.businessRef && typeof source.businessRef === 'object' && !Array.isArray(source.businessRef)
    ? source.businessRef as Record<string, unknown>
    : null;
  const businessRef = rawBusinessRef ? Object.fromEntries([
    ['goalId', text(rawBusinessRef.goalId, 200)],
    ['planId', text(rawBusinessRef.planId, 200)],
    ['taskKey', text(rawBusinessRef.taskKey, 120)],
    ['entityId', text(rawBusinessRef.entityId, 200)],
    ['deliveryId', text(rawBusinessRef.deliveryId, 200)],
    ['businessDomain', text(rawBusinessRef.businessDomain, 120)],
    ['capabilityKey', text(rawBusinessRef.capabilityKey, 120)],
    ['statusSource', text(rawBusinessRef.statusSource, 120)],
    ['contentId', text(rawBusinessRef.contentId, 200)],
    ['referenceId', text(rawBusinessRef.referenceId, 200)],
    ['taskVersion', Number.isFinite(Number(rawBusinessRef.taskVersion)) ? Number(rawBusinessRef.taskVersion) : ''],
    ['correctionVersion', Number.isFinite(Number(rawBusinessRef.correctionVersion)) ? Number(rawBusinessRef.correctionVersion) : ''],
  ].filter(([, item]) => item !== '')) : undefined;
  return {
    page,
    ...(view ? { view } : {}),
    ...(studioPanel ? { studioPanel } : {}),
    ...(runId ? { runId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(businessRef ? { businessRef } : {}),
  };
}

function normalizeCard(value: unknown): AssistantDecisionCard | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const subjectSource = source.subject && typeof source.subject === 'object'
    ? source.subject as Record<string, unknown>
    : {};
  const id = text(source.id, 200);
  const kind = source.kind as AssistantDecisionKind;
  const title = text(source.title, 160);
  const summary = text(source.summary, 500);
  const subjectType = subjectSource.type as AssistantDecisionCard['subject']['type'];
  const subjectId = text(subjectSource.id, 200);
  const version = text(subjectSource.version, 300);
  if (!id || !decisionKinds.has(kind) || !title || !summary || !subjectTypes.has(subjectType) || !subjectId || !version) return null;
  const facts = (Array.isArray(source.facts) ? source.facts : [])
    .map(normalizeFact)
    .filter((item): item is AssistantDecisionFact => Boolean(item))
    .slice(0, 6);
  const actions = (Array.isArray(source.actions) ? source.actions : [])
    .map(normalizeAction)
    .filter((item): item is AssistantDecisionAction => Boolean(item))
    .slice(0, 4);
  if (!actions.length) return null;
  const deepLink = normalizeDeepLink(source.deepLink);
  return {
    id,
    kind,
    priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 0,
    status: 'pending',
    title,
    summary,
    facts,
    subject: { type: subjectType, id: subjectId, version },
    actions,
    ...(deepLink ? { deepLink } : {}),
    createdAt: text(source.createdAt, 80) || new Date(0).toISOString(),
  };
}

/**
 * Treat every response as untrusted transport data. Only the compact decision
 * contract is retained; event streams, execution logs and arbitrary metadata
 * are intentionally discarded before anything reaches the assistant UI.
 */
export function normalizeAssistantDecisionFeed(value: unknown): AssistantDecisionFeed {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const items = (Array.isArray(source.items) ? source.items : [])
    .map(normalizeCard)
    .filter((item): item is AssistantDecisionCard => Boolean(item))
    .sort((left, right) => right.priority - left.priority || right.createdAt.localeCompare(left.createdAt))
    .slice(0, 3);
  const reportedTotal = Number(source.total);
  return {
    items,
    total: Number.isFinite(reportedTotal) ? Math.max(items.length, Math.floor(reportedTotal)) : items.length,
    generatedAt: text(source.generatedAt, 80) || new Date().toISOString(),
    page: normalizeAssistantDecisionPage(source.page),
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener('abort', cancel, { once: true });
  if (init?.signal?.aborted) cancel();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...authHeader(),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
    const body = await response.json().catch((reason: unknown) => {
      if (controller.signal.aborted) throw reason;
      throw new AssistantDecisionApiError('待办接口未返回有效数据，请重新加载', 502, 'invalid_decision_response');
    }) as Record<string, unknown>;
    if (!response.ok) {
      const stale = response.status === 409;
      throw new AssistantDecisionApiError(
        stale ? '这项待办已更新，已为你刷新最新内容' : text(body.message || body.error, 240) || '待办请求失败，请重试',
        response.status,
        text(body.error, 120),
      );
    }
    return body as T;
  } catch (reason) {
    if (timedOut) throw new AssistantDecisionApiError('请求超时，请重新加载待办确认最新状态', 408, 'decision_timeout');
    throw reason;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', cancel);
  }
}

export async function fetchAssistantDecisionFeed(input: {
  page: string;
  goalId?: string;
  signal?: AbortSignal;
}): Promise<AssistantDecisionFeed> {
  const params = new URLSearchParams({ page: normalizeAssistantDecisionPage(input.page) });
  if (input.goalId?.trim()) params.set('goalId', input.goalId.trim());
  const body = await request<unknown>(`${BASE}?${params.toString()}`, { signal: input.signal });
  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).items)) {
    throw new AssistantDecisionApiError('待办接口未返回有效数据，请重新加载', 502, 'invalid_decision_response');
  }
  return normalizeAssistantDecisionFeed(body);
}

export async function executeAssistantDecision(input: {
  cardId: string;
  actionId: AssistantDecisionActionId;
  expectedVersion: string;
  page: string;
  goalId?: string;
  note?: string;
  signal?: AbortSignal;
}): Promise<AssistantDecisionActionResponse> {
  const command: AssistantDecisionCommand = {
    actionId: input.actionId,
    expectedVersion: input.expectedVersion,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  const params = new URLSearchParams({ page: normalizeAssistantDecisionPage(input.page) });
  if (input.goalId?.trim()) params.set('goalId', input.goalId.trim());
  const body = await request<AssistantDecisionActionResponse>(
    `${BASE}/${encodeURIComponent(input.cardId)}/actions?${params.toString()}`,
    { method: 'POST', body: JSON.stringify(command), signal: input.signal },
  );
  if (body?.ok !== true || !Array.isArray(body.items)
    || !['completed', 'already_completed', 'navigation_required'].includes(String(body.outcome))) {
    throw new AssistantDecisionApiError('操作结果尚未确认，请重新加载待办核对', 502, 'invalid_decision_response');
  }
  const feed = normalizeAssistantDecisionFeed(body);
  return {
    ...feed,
    ok: true,
    outcome: body.outcome,
  };
}

export const assistantDecisionApi = {
  feed: fetchAssistantDecisionFeed,
  execute: executeAssistantDecision,
};
