export const ACTION_FEEDBACK_EVENT = 'lingshu:action-feedback';

export type ActionFeedbackTone = 'success' | 'info' | 'warning' | 'error';

export interface ActionFeedbackDetail {
  id?: string;
  title: string;
  description?: string;
  tone?: ActionFeedbackTone;
  durationMs?: number;
}

export function showActionFeedback(detail: ActionFeedbackDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ActionFeedbackDetail>(ACTION_FEEDBACK_EVENT, {
    detail: {
      ...detail,
      id: detail.id || `feedback:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      tone: detail.tone || 'success',
      durationMs: detail.durationMs ?? 4_200,
    },
  }));
}

export function showActionSuccess(title: string, description?: string) {
  showActionFeedback({ title, description, tone: 'success' });
}
