import { useRef } from 'react';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { useAssistantStore } from '../../stores/assistantStore';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

export function useAssistantScenePortal(portal: AssistantCreationPortal) {
  const identity = useRef(productionNavigationIdentity());
  const current = () => identity.current === productionNavigationIdentity();
  const update = (patch: Partial<AssistantCreationPortal>) => {
    if (!current()) return;
    const store = useAssistantStore.getState();
    store.setMessages('business', store.threads.business.messages.map(message => {
      if (message.creationPortal?.id !== portal.id) return message;
      const next = {...message.creationPortal,...patch};
      const expected = next.scenario === 'campaign' ? next.campaign?.items.length || 0 : 1;
      const complete = next.submissionLocked && expected > 0 && (next.createdTasks?.length || 0) === expected;
      return {...message, ...(complete ? {content:'恭喜，内容创作任务创建完成，点击下方卡片查看任务详情。'} : {}), creationPortal:next};
    }));
  };
  const navigate = (detail: Record<string, unknown>) => {
    if (current()) window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{...detail,navigationIdentity:identity.current}}));
  };
  return {current, update, navigate};
}
