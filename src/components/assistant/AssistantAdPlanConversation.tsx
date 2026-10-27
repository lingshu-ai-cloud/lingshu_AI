import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import type { BusinessScenePrompt } from '../../../shared/contracts/assistantBusinessScene';
import { platformAdsApi, type PlatformAdTask } from '../../lib/platformAds';
import { emptyAdPlanConfiguration } from '../../lib/platformAdsDomain';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { useAssistantStore } from '../../stores/assistantStore';
import { PRIMARY_ASSISTANT_THREAD } from './globalAssistantRuntime';
import AdPlanConversationCreate, { type AdConversationForm } from '../AdPlanConversationCreate';
import AssistantNavigationPortalCard from './AssistantNavigationPortalCard';
import { AdAccountDirectoryProvider } from '../AdAccountDirectory';

export default function AssistantAdPlanConversation({ request }: { request: BusinessScenePrompt }) {
  const [form, setForm] = useState<AdConversationForm>(() => ({ name:'',video:'',goal:'提升有效视频观看',market:'',budget:'',currency:'USD',channels:['Facebook','Instagram'],configuration:{...emptyAdPlanConfiguration} }));
  const [created, setCreated] = useState<PlatformAdTask>(), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const identity = useRef(productionNavigationIdentity());
  const conversation = useRef(useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].conversationKey);
  const current = () => identity.current === productionNavigationIdentity() && conversation.current === useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].conversationKey;
  useEffect(() => {
    if (!request.createdTaskId || created?.id === request.createdTaskId) return;
    let active = true; setError('');
    void platformAdsApi.getTask(request.createdTaskId).then(task => {
      if (!active || !current()) return;
      if (task?.id !== request.createdTaskId) throw Error('原计划暂不可访问');
      setCreated(task);
    }).catch(reason => { if (active && current()) setError(reason.message || '原计划暂不可读取'); });
    return () => { active = false; };
  }, [request.createdTaskId, revision]);
  const done = (task: PlatformAdTask) => {
    if (!current() || !task.id) return;
    setCreated(task);
    const store = useAssistantStore.getState(), thread = store.threads[PRIMARY_ASSISTANT_THREAD];
    store.setMessages(PRIMARY_ASSISTANT_THREAD, thread.messages.map(message => message.businessScenePrompt === request
      ? { ...message, content:'恭喜计划创建成功。', businessScenePrompt:{...request,createdTaskId:task.id} }
      : message));
  };
  if (request.createdTaskId || created) return <section className="mt-3" aria-label="已创建投流计划">
    {error ? <Alert type="warning" title={error} action={<Button onClick={() => setRevision(v => v + 1)}>重新读取</Button>}/> : !created ? <Spin size="small"/> :
      <AssistantNavigationPortalCard portal={{page:'adsPlans',title:'智能投流',description:`${created.name} · 计划已保存`}}/>}
  </section>;
  return <section className="mt-3" aria-label="在对话中创建投流计划"><AdAccountDirectoryProvider onOpenCreative={() => {}}><AdPlanConversationCreate saveOnly value={form} onChange={setForm} onSaved={() => {}} onBusy={() => {}} onManual={() => {}} onDone={done}/></AdAccountDirectoryProvider></section>;
}
