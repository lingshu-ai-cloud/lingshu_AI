import { App } from 'antd';
import { useEffect } from 'react';
import { ACTION_FEEDBACK_EVENT, type ActionFeedbackDetail } from '../../lib/actionFeedback';

/** Keep the existing event contract while sharing Ant's themed, accessible feedback. */
export default function ActionFeedbackHost() {
  const { message, notification } = App.useApp();
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ActionFeedbackDetail>).detail;
      if (!detail?.title) return;
      const type = detail.tone || 'success';
      const key = detail.id || `feedback:${Date.now()}`;
      const duration = Math.max(0, detail.durationMs ?? 4200) / 1000;
      if (detail.description) {
        notification.open({ key, type, title: detail.title, description: detail.description, duration, placement: 'topRight' });
      } else {
        void message.open({ key, type, content: detail.title, duration });
      }
    };
    window.addEventListener(ACTION_FEEDBACK_EVENT, handle);
    return () => window.removeEventListener(ACTION_FEEDBACK_EVENT, handle);
  }, [message, notification]);
  return null;
}
