import type { CreateSocialContentTaskInput, SocialContentTaskSummary } from '../../shared/contracts/socialContentTaskContract';
import type { ContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard';
import type { AgentThreadState, OrbitAgentId } from '../stores/assistantStore';
import { authHeader } from './auth';

export type AtomicAssistantContentTaskResponse = {
  thread: AgentThreadState;
  task: SocialContentTaskSummary;
  receipt: { taskId: string; status: string; card: ContentProductionTaskCard };
};

export class AssistantContentTaskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly current?: Partial<AgentThreadState>,
    readonly contentTaskId?: string,
  ) {
    super(message);
    this.name = 'AssistantContentTaskApiError';
  }
}

function normalizedIntentHash(objective: string): string {
  let hash = 0x811c9dc5;
  for (const character of objective.trim().replace(/\s+/gu, ' ')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function assistantContentTaskIntentFingerprint(objective: string): string {
  return `assistant-content-intent:${normalizedIntentHash(objective)}`;
}

export function assistantContentTaskIdempotencyKey(threadVersion: number, objective: string): string {
  return `assistant-content:${threadVersion}:${normalizedIntentHash(objective)}`;
}

export async function createAtomicAssistantContentTask(input: {
  agentId: string;
  expectedThreadVersion: number;
  idempotencyKey: string;
  message: string;
  task: CreateSocialContentTaskInput;
}): Promise<AtomicAssistantContentTaskResponse> {
  const response = await fetch(`/api/overseas/assistant-threads/${encodeURIComponent(input.agentId)}/content-tasks`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new AssistantContentTaskApiError(
    String(body.message || '单条内容任务暂时无法建立。'), response.status,
    String(body.error || 'assistant_content_task_unavailable'),
    body.current && typeof body.current === 'object' ? body.current as Partial<AgentThreadState> : undefined,
    typeof body.contentTaskId === 'string' && body.contentTaskId.trim() ? body.contentTaskId.trim() : undefined,
  );
  const result = body as unknown as AtomicAssistantContentTaskResponse;
  if (!result.thread || !result.task?.taskId || result.receipt?.taskId !== result.task.taskId
    || result.receipt.card?.contentTaskId !== result.task.taskId
    || result.receipt.card?.cardVersion !== result.task.version) {
    throw new AssistantContentTaskApiError('任务回执无法核实，请刷新会话查看真实状态。', 502, 'assistant_content_task_receipt_invalid');
  }
  return result;
}
