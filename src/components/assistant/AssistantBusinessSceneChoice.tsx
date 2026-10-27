import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Select, Spin } from 'antd';
import dayjs from 'dayjs';
import { defaultBusinessPeriod, type BusinessSceneOptions, type BusinessScenePrompt } from '../../../shared/contracts/assistantBusinessScene';
import { assistantHomePromptById } from '../../lib/assistantHomeQuickPrompts';
import { authHeader } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import AssistantAdPlanConversation from './AssistantAdPlanConversation';
import AssistantDailyFollowups from './AssistantDailyFollowups';

export default function AssistantBusinessSceneChoice({ request }: { request: BusinessScenePrompt }) {
  const [options, setOptions] = useState<BusinessSceneOptions>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const [period, setPeriod] = useState(() => defaultBusinessPeriod(request.sceneId));
  const identity = useRef(productionNavigationIdentity());
  useEffect(() => {
    if (['AD-02', 'CS-01'].includes(request.sceneId)) return;
    const controller = new AbortController();
    setError('');
    void fetch(`/api/overseas/strategy/business-scene-options?sceneId=${request.sceneId}`, { headers: authHeader(), signal: controller.signal, cache: 'no-store' })
      .then(async response => { const value = await response.json(); if (!response.ok) throw Error(value.message || '对象读取失败'); return value as BusinessSceneOptions; })
      .then(value => { if (!controller.signal.aborted && identity.current === productionNavigationIdentity()) {
        setOptions(value); const items = request.sceneId.startsWith('CS-') ? value.customers : value.ads;
        setSelected(items.some(item => item.id === request.preferredId) ? request.preferredId : undefined);
      } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [request.sceneId, request.preferredId, revision]);
  if (request.sceneId === 'AD-02') return <AssistantAdPlanConversation request={request}/>;
  if (request.sceneId === 'CS-01') return <AssistantDailyFollowups/>;
  const customers = request.sceneId.startsWith('CS-');
  const items = customers ? options?.customers : options?.ads;
  const confirm = () => {
    if (!selected || submitted || identity.current !== productionNavigationIdentity() || !items?.some(item => item.id === selected)) return;
    setSubmitted(true);
    window.dispatchEvent(new CustomEvent('lingshu-assistant-open', { detail: { preserveDraft: true,
      text: `${assistantHomePromptById(request.sceneId)?.prompt}\n关注对象：${items.find(item => item.id === selected)?.label}`,
      businessScene: { sceneId: request.sceneId, ...period, ...(customers ? { customerId: selected } : { adTaskId: selected }) },
    } }));
  };
  return <section className="mt-3 space-y-3" aria-label={customers ? '在对话中选择客户' : '在对话中选择投放计划'}>
    {error ? <Alert type="warning" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重新读取</Button>}/> : !options ? <Spin size="small"/> : !items?.length ?
      <p>{customers ? '当前没有可读取的客户会话。接入客户后，我就能帮你分析。' : '还没有投流计划，可以先点击“创建一条新投流计划”。'}</p> : <>
        <Select className="w-full max-w-md" aria-label={customers ? '关注客户' : '关注投放计划'} showSearch optionFilterProp="label" placeholder={customers ? '选择一位客户' : '选择一条计划'} value={selected} disabled={submitted}
          options={items.map(item => ({ value: item.id, label: item.label }))} onChange={setSelected}/>
        {request.sceneId === 'AD-01' && <div><p className="mb-1 text-sm text-text-secondary">分析时间范围（北京时间，最多93天）</p><DatePicker.RangePicker disabledDate={(date, info) => !!info.from && Math.abs(date.diff(info.from, 'day')) > 92} allowClear={false} disabled={submitted} value={[dayjs(period.from), dayjs(period.to)]} onChange={dates => { if (dates?.[0] && dates[1] && dates[1].diff(dates[0], 'day') <= 92) setPeriod({ from: dates[0].format('YYYY-MM-DD'), to: dates[1].format('YYYY-MM-DD') }); }}/></div>}
        <div><Button type="primary" disabled={!selected || submitted} onClick={confirm}>{submitted ? '已选择' : request.preferredId && selected === request.preferredId ? customers ? '继续查看这位客户' : '继续查看这条计划' : '就看这个'}</Button></div>
      </>}
  </section>;
}
