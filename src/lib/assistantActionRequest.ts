import type { AssistantActionId, AssistantActionRequest, AssistantActionResponse } from '../../shared/contracts/assistantActions';
import type { OrbitAgentId } from '../stores/assistantStore';
import { authHeader } from './auth';
import { withAssistantIdleTimeout } from './assistantRequestLifecycle';

/** The action route is authoritative; transport failures must never fall through to chat. */
export async function executeAssistantAction(
  agentId: OrbitAgentId,
  request: AssistantActionRequest,
  options?: { deterministicActionId?: AssistantActionId; timeoutMs?: number },
): Promise<AssistantActionResponse> {
  const actionFailure = (
    message: string,
    errorCode = 'assistant_action_unavailable',
    httpStatus?: number,
  ): AssistantActionResponse => {
    const missingInput = httpStatus === 422 || /(?:^|_)(?:goal|required|missing)(?:_|$)/.test(errorCode);
    const staleAction = httpStatus === 409 || /(?:stale|conflict)/.test(errorCode);
    const resultUnknown = errorCode === 'assistant_action_result_unknown';
    const status: AssistantActionResponse['status'] = missingInput
      ? 'missing_required_input'
      : staleAction ? 'stale_action' : 'failed';
    return {
      status,
      actionId: request.actionId ?? options?.deterministicActionId ?? 'delegate_to_agent',
      requestId: request.requestId,
      card: {
        kind: missingInput ? 'decision' : 'operation_result',
        title: resultUnknown ? '操作结果待确认' : missingInput ? '还需要补充信息' : staleAction ? '页面信息已更新' : '操作没有完成',
        summary: message,
        details: [resultUnknown ? '请先查看周任务或原任务卡的最新状态，确认结果后再决定下一步。' : '原任务和已填写内容均已保留，可以稍后重试。'],
      },
      notification: { reason: missingInput ? 'missing_required_input' : 'failure', message },
      errorCode,
    };
  };
  const controller = new AbortController();
  try {
    const response = await withAssistantIdleTimeout(fetch(`/api/overseas/assistant-threads/${agentId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(request),
      signal: controller.signal,
    }), controller, options?.timeoutMs ?? 20_000);
    const payload = await withAssistantIdleTimeout(response.json(), controller, options?.timeoutMs ?? 20_000)
      .catch(error => controller.signal.aborted ? Promise.reject(error) : null) as (AssistantActionResponse & { error?: string; message?: string }) | null;
    if (payload?.requestId && payload.card && payload.status) return payload;
    if (!response.ok) {
      return actionFailure(
        payload?.message || '助手操作暂时不可用。',
        payload?.error,
        response.status,
      );
    }
    return actionFailure('操作接口未返回可确认的结果。', 'assistant_action_invalid_response');
  } catch (error) {
    // Never make a failed deterministic route look like a successful
    // generic conversation. Only an explicit delegated/not_handled
    // response is allowed to fall through to the normal chat endpoint.
    return actionFailure(controller.signal.aborted
      ? '操作结果尚未确认，请先查看原任务状态，不要重复提交。'
      : error instanceof Error ? error.message : '助手操作暂时不可用。',
      controller.signal.aborted ? 'assistant_action_result_unknown' : 'assistant_action_unavailable');
  } finally { controller.abort(); }
}
