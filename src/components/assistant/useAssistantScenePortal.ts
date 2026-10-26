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
      const expected = next.scenario === 'campaign' ? next.campaignDraft ? 1 : next.campaign?.items.length || 0 : 1;
      const complete = next.submissionLocked && expected > 0 && (next.createdTasks?.length || 0) === expected;
      return {...message, ...(complete ? {content:next.createdTasks?.every(row=>row.executionState==='queued'||row.executionState==='running')?'创作任务已进入执行队列，点击下方卡片查看进展。':'内容任务已保存，执行状态见下方卡片。'} : {}), creationPortal:next};
    }));
  };
  const advance = (patch: Partial<AssistantCreationPortal>, answer: string, question: string) => {
    if (!current()) return;
    const store = useAssistantStore.getState();
    const messages = store.threads.business.messages;
    const source = messages.find(message => message.creationPortal?.id === portal.id)?.creationPortal;
    if (!source) return;
    store.setMessages('business', [
      ...messages.map(message => message.creationPortal?.id === portal.id ? { ...message, creationPortal: undefined } : message),
      { role: 'user' as const, content: answer },
      { role: 'assistant' as const, content: question, creationPortal: { ...source, ...patch } },
    ]);
  };
  const navigate = (detail: Record<string, unknown>) => {
    if (current()) window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{...detail,navigationIdentity:identity.current}}));
  };
  return {current, update, advance, navigate};
}
