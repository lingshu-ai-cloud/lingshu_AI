import type {
  AssistantActionRequest,
  AssistantActionResponse,
} from '../../shared/contracts/assistantActions';
import { authHeader, getToken } from './auth';

export type QuickExecutionKind =
  | 'analysis'
  | 'draft'
  | 'production_task'
  | 'schedule_change'
  | 'quota_change'
  | 'publish'
  | 'customer_contact'
  | 'paid_action';

export type QuickExecutionDefinition = {
  id: string;
  label: string;
  kind: QuickExecutionKind;
  /** A concrete business goal consumed by the existing Agent orchestrator. */
  goal: string;
  /** The page whose live context is attached to the command. */
  page: string;
};

export type QuickExecutionPlan =
  | {
    status: 'confirmation_required';
    requiredConfirmations: 1 | 2;
    confirmationsRemaining: 1 | 2;
    prompt: string;
  }
  | {
    status: 'ready';
    requiredConfirmations: 0 | 1 | 2;
    request: AssistantActionRequest;
  };

export type QuickExecutionNavigation = {
  page: string;
  focus?: string;
  href: string;
};

const SAFE_ID = /^[a-z0-9:_-]{1,100}$/i;
const SAFE_PAGE = /^[a-z][a-z0-9_-]{0,79}$/i;

export class QuickExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'QuickExecutionError';
  }
}

export function quickExecutionConfirmationCount(kind: QuickExecutionKind): 0 | 1 | 2 {
  if (kind === 'analysis' || kind === 'draft') return 0;
  if (kind === 'publish' || kind === 'customer_contact' || kind === 'paid_action') return 2;
  return 1;
}

function validateDefinition(definition: QuickExecutionDefinition): void {
  if (!SAFE_ID.test(definition.id)) {
    throw new QuickExecutionError('quick_execution_id_invalid', '快捷执行编号无效。');
  }
  if (!definition.label.trim() || definition.label.length > 120) {
    throw new QuickExecutionError('quick_execution_label_invalid', '快捷执行名称无效。');
  }
  if (!definition.goal.trim() || definition.goal.length > 4_000) {
    throw new QuickExecutionError('quick_execution_goal_invalid', '快捷执行目标无效。');
  }
  if (!SAFE_PAGE.test(definition.page)) {
    throw new QuickExecutionError('quick_execution_page_invalid', '快捷执行页面无效。');
  }
}

function newRequestId(definitionId: string): string {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `quick-${definitionId}-${suffix}`.slice(0, 200);
}

/**
 * Applies the product confirmation policy before a command can reach the
 * existing Agent pipeline. This is a UI admission boundary; every downstream
 * business approval, quota check and outbound guard remains authoritative.
 */
export function planQuickExecution(
  definition: QuickExecutionDefinition,
  confirmations = 0,
  requestId = newRequestId(definition.id),
): QuickExecutionPlan {
  validateDefinition(definition);
  if (!Number.isSafeInteger(confirmations) || confirmations < 0 || confirmations > 2) {
    throw new QuickExecutionError('quick_execution_confirmation_invalid', '快捷执行确认状态无效。');
  }
  const requiredConfirmations = quickExecutionConfirmationCount(definition.kind);
  if (confirmations < requiredConfirmations) {
    const confirmationRequired = requiredConfirmations as 1 | 2;
    const confirmationsRemaining = (requiredConfirmations - confirmations) as 1 | 2;
    const prompt = requiredConfirmations === 2 && confirmations === 0
      ? '该操作会产生外部影响，请先核对执行对象和范围。'
      : requiredConfirmations === 2
        ? '请再次确认：执行后可能发布内容、联系客户或产生费用。'
        : '请确认任务目标、排期和预计资源后再启动。';
    return { status: 'confirmation_required', requiredConfirmations: confirmationRequired, confirmationsRemaining, prompt };
  }
  return {
    status: 'ready',
    requiredConfirmations,
    request: {
      source: 'button',
      actionId: 'start_task',
      requestId,
      page: definition.page,
      parameters: { goal: definition.goal.trim() },
    },
  };
}

function isActionResponse(value: unknown, request: AssistantActionRequest): value is AssistantActionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<AssistantActionResponse>;
  return response.requestId === request.requestId
    && response.actionId === request.actionId
    && typeof response.status === 'string'
    && Boolean(response.card && typeof response.card.title === 'string' && typeof response.card.summary === 'string');
}

/**
 * Submits only a ready plan to the existing assistant action API. That API is
 * the adapter to the real Agent orchestrator and owns task/calendar mutation,
 * task-card projection, permissions, idempotency and audit attribution.
 */
export async function executeQuickExecution(
  agentId: string,
  plan: QuickExecutionPlan,
  fetchImpl: typeof fetch = fetch,
): Promise<AssistantActionResponse> {
  if (plan.status !== 'ready') {
    throw new QuickExecutionError('quick_execution_confirmation_required', plan.prompt);
  }
  if (!SAFE_ID.test(agentId)) {
    throw new QuickExecutionError('quick_execution_agent_invalid', '快捷执行智能体编号无效。');
  }
  const token = getToken();
  if (!token) throw new QuickExecutionError('quick_execution_auth_required', '请登录后执行任务。');
  const response = await fetchImpl(`/api/overseas/assistant-threads/${encodeURIComponent(agentId)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(plan.request),
    cache: 'no-store',
    redirect: 'error',
  });
  const body: unknown = await response.json().catch(() => null);
  if (getToken() !== token) {
    throw new QuickExecutionError('quick_execution_identity_changed', '登录身份已变化，请重新确认任务。');
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && !Array.isArray(body)
      ? String((body as Record<string, unknown>).message || '快捷执行未启动。')
      : '快捷执行未启动。';
    throw new QuickExecutionError('quick_execution_request_failed', message);
  }
  if (!isActionResponse(body, plan.request)) {
    throw new QuickExecutionError('quick_execution_receipt_invalid', '任务回执与本次快捷执行不一致。');
  }
  return body;
}

/** Never invent a production destination; use only the server-issued link. */
export function quickExecutionNavigation(response: AssistantActionResponse): QuickExecutionNavigation | null {
  const href = response.workspace?.href;
  if (!href || !/^\/(?!\/)/.test(href)) return null;
  const url = new URL(href, 'http://lingshu.local');
  const page = url.searchParams.get('page');
  if (!page || !SAFE_PAGE.test(page)) return null;
  const focus = url.searchParams.get('focus') || undefined;
  if (focus && !SAFE_ID.test(focus)) return null;
  return { page, ...(focus ? { focus } : {}), href };
}

export function openQuickExecutionWorkspace(response: AssistantActionResponse): boolean {
  if (typeof window === 'undefined') return false;
  const navigation = quickExecutionNavigation(response);
  if (!navigation) return false;
  window.dispatchEvent(new CustomEvent('lingshu:navigate', {
    detail: { page: navigation.page, ...(navigation.focus ? { focus: navigation.focus } : {}) },
  }));
  return true;
}
