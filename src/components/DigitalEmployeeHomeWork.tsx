import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Skeleton, Tag } from 'antd';
import { Headphones, Megaphone, Sparkles } from 'lucide-react';
import type { Page } from '../pageRegistry';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { SocialContentTaskSummary, SocialContentTaskPage } from '../../shared/contracts/socialContentWorkflow';
import { AUTH_TOKEN_CHANGED_EVENT, authHeader } from '../lib/auth';
import { productionNavigationIdentity } from '../lib/productionNavigation';
import { socialContentApi } from '../lib/socialContentApi';
import { SOCIAL_CONTENT_TASK_REFRESH_EVENT } from '../lib/socialContentTaskRefresh';
import { creationTaskRows, type CreationTaskProduct, type CreationTaskRow } from '../lib/creationTaskWorkspace';
import { mergeSocialContentTaskSummaries } from '../lib/socialContentTaskPagination';
import { studioApi } from '../lib/studioApi';
import { useAdPlanTasks } from '../lib/useAdPlanNavigation';
import { useCustomers } from '../hooks/useCustomers';
import { useAdPlanOperatingData } from './useAdPlanOperatingData';
import { projectContentWork, projectAdWork, projectCustomerWork, type BusinessWorkItem, type BusinessWorkKind } from '../lib/businessWorkProjection';
import { dispatchDigitalEmployeeDeepLink } from '../lib/digitalEmployeeNavigation';
import CreationTaskCover from './socialContent/CreationTaskCover';
import CreationTaskDetailDrawer, { creationLocalTime } from './socialContent/CreationTaskDetailDrawer';
import AdPlanMetricsCell from './AdPlanMetricsCell';
import CreateContentPlanModal from './socialContent/CreateContentPlanModal';
import LsIllustratedEmpty from './ui/LsIllustratedEmpty';

const columns = [
  { kind: 'content', label: '内容创作', page: 'socialInspiration', Icon: Sparkles },
  { kind: 'traffic', label: '智能投流', page: 'adsPlans', Icon: Megaphone },
  { kind: 'customer', label: '智能客服', page: 'conversion', Icon: Headphones },
] satisfies Array<{ kind: BusinessWorkKind; label: string; page: Page; Icon: typeof Sparkles }>;
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '';

/** Remount domain readers on identity change; late responses cannot cross tenants. */
export default function DigitalEmployeeHomeWork(props: { data: DigitalEmployeeOverview | null; onNavigate?: (page: Page) => void }) {
  const [identity, setIdentity] = useState(productionNavigationIdentity);
  useEffect(() => {
    const reset = () => setIdentity(productionNavigationIdentity());
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.addEventListener('storage', reset);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.removeEventListener('storage', reset); };
  }, []);
  return <BusinessWork key={identity} {...props} identity={identity}/>;
}
function BusinessWork({ data, onNavigate, identity }: { data: DigitalEmployeeOverview | null; onNavigate?: (page: Page) => void; identity: string }) {
  const [revision, setRevision] = useState(0), [mine, setMine] = useState(false);
  const [content, setContent] = useState<SocialContentTaskSummary[] | null>(null), [products, setProducts] = useState<CreationTaskProduct[]>([]);
  const [unavailable, setUnavailable] = useState<NonNullable<SocialContentTaskPage['unavailableItems']>>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [productError, setProductError] = useState('');
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const plans = useAdPlanTasks(authHeader().Authorization || '');
  const customerList = useCustomers(revision, false);
  const refresh = () => { setRevision(value => value + 1); plans.retry(); };
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible' && !loading && !plans.loading) refresh(); };
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [loading, plans.loading]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setProductError('');
    const valid = () => active && identity === productionNavigationIdentity();
    const read = async () => {
      const first = await socialContentApi.listTasks(1, 100); let items = first.items;
      const unreadable = [...(first.unavailableItems || [])];
      for (let page = 2; page <= first.totalPages; page++) {
        if (!valid()) return;
        const next = await socialContentApi.listTasks(page, 100);
        items = mergeSocialContentTaskSummaries(items, next.items);
        unreadable.push(...(next.unavailableItems || []));
      }
      if (valid()) { setContent(items); setUnavailable(unreadable); }
    };
    void read().catch(cause => { if (valid()) setError(cause instanceof Error ? cause.message : '创作任务读取失败'); }).finally(() => { if (valid()) setLoading(false); });
    void studioApi.materialProducts().then(result => { if (valid()) setProducts(result.items); }).catch(() => { if (valid()) setProductError('产品照片暂不可读取'); });
    const changed = () => setRevision(value => value + 1);
    window.addEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, changed);
    return () => { active = false; window.removeEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT, changed); };
  }, [identity, revision]);
  const rows = useMemo(() => creationTaskRows(content || [], (data?.contentQueue?.items || []).filter(item =>
    item.origin === 'weekly_plan' || content?.some(task => task.taskId === item.socialContentTaskId)), products, unavailable), [content, products, data, unavailable]);
  const contentItems = projectContentWork(rows), customers = projectCustomerWork(customerList.customers);
  // Use the plan page's exact readback/metrics components, limiting provider reads to visible candidates.
  const initialPlans = useMemo(() => projectAdWork(plans.items || [], {}).slice(0, 3).flatMap(item => item.kind === 'traffic' ? [item.task] : []), [plans.items]);
  const operating = useAdPlanOperatingData(initialPlans, revision, false);
  const all: Record<BusinessWorkKind, BusinessWorkItem[]> = { content: contentItems, traffic: projectAdWork(plans.items || [], operating.items), customer: customers };
  const errors = { content: [error, productError].filter(Boolean).join('；'), traffic: plans.error, customer: customerList.error };
  const busy = { content: loading, traffic: plans.loading, customer: customerList.loading };
  const available = { content: content !== null, traffic: plans.items !== null, customer: !customerList.loading && !customerList.error };
  const open = (item: BusinessWorkItem) => {
    if (identity !== productionNavigationIdentity()) return;
    if (item.kind === 'content') { setSelectedContent(item.row.key); return; }
    if (item.kind === 'customer') {
      dispatchDigitalEmployeeDeepLink({ page: 'conversion', runId: '', taskId: '', businessRef: { entityId: item.customer.id, taskKey: 'customer_conversation', businessDomain: 'customer' } }); return;
    }
    onNavigate?.('adsPlans');
    const url = new URL(window.location.href); url.searchParams.set('adsTaskId', item.task.id);
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  };
  const selected: CreationTaskRow | null = rows.find(row => row.key === selectedContent) || null;
  return <section className="creator-home__canvas business-work" aria-label="数字员工正在进行的工作">
    <header className="business-work__header"><div><h2>正在推进的工作</h2><p>按业务对象展示，需要处理的优先</p></div><div className="business-work__controls"><Segmented aria-label="进行中工作筛选" value={mine ? 'mine' : 'all'} options={[{ label: '全部进行中', value: 'all' }, { label: '只看待我处理', value: 'mine' }]} onChange={value => setMine(value === 'mine')}/><Button onClick={refresh} loading={loading || plans.loading}>刷新</Button></div></header>
    <div className="business-work__grid">{columns.map(({ kind, label, page, Icon }) => {
      const items = all[kind].filter(item => !mine || item.needsAction);
      return <section className="business-work__column" aria-label={`${label}进行中工作`} key={kind}>
        <header className="business-work__column-title"><h3><Icon size={17} aria-hidden="true"/>{label}</h3><span>{available[kind] || all[kind].length ? `${items.length} 项 · ${all[kind].filter(item => item.needsAction).length} 项待处理` : '尚未读取'}</span></header>
        {errors[kind] && <Alert type="warning" title={errors[kind]} action={<Button size="small" onClick={refresh}>重试</Button>}/>}
        {busy[kind] && !all[kind].length ? <Skeleton active paragraph={{ rows: 4 }}/> : items.length ? <div className="business-work__list">{items.slice(0, 3).map(item => <article key={item.id} className="business-work__card">
          <div className="business-work__identity">{item.kind === 'content' && <span className="business-work__cover"><CreationTaskCover row={item.row}/></span>}<div><Tag color={item.needsAction ? 'warning' : undefined}>{item.status}</Tag><h4 title={item.title}>{item.title}</h4></div></div>
          <p className="business-work__context">{item.context}</p><p className="business-work__next">{item.next}</p>
          {item.dueAt && time(item.dueAt) && <p className="business-work__context">{item.kind === 'content' ? '计划发布' : '交接期限'}：{creationLocalTime(item.dueAt)}</p>}
          {item.kind === 'traffic' && <><p className="business-work__context">计划日预算 {item.task.currency} {item.task.configuration.dailyBudget ?? '—'}</p><AdPlanMetricsCell task={item.task} data={operating.items[item.task.id]} onRetry={() => operating.retryMetrics(item.task.id)} disabled={operating.loading}/></>}
          <footer><Button type="link" onClick={() => open(item)}>{item.action}</Button>{time(item.updatedAt) && <small>记录更新 {time(item.updatedAt)}</small>}</footer>
        </article>)}</div> : available[kind] && !errors[kind] ? <LsIllustratedEmpty icon={Icon} title={mine ? '暂无需要你处理的记录' : '暂无进行中的业务记录'} detail={`${label}的真实任务出现后，会在这里显示当前状态与下一步。`}/> : null}
        <Button type="text" className="business-work__all" onClick={() => onNavigate?.(page)}>查看全部{label}</Button>
      </section>;
    })}</div>
    {data && <CreationTaskDetailDrawer row={selected} overview={data} onClose={() => setSelectedContent(null)} onUpdated={refresh} onRecover={() => { setSelectedContent(null); setRecoveryOpen(true); }}/>}
    <CreateContentPlanModal open={recoveryOpen} onCancel={() => setRecoveryOpen(false)} onCreated={() => { setRecoveryOpen(false); refresh(); }}/>
  </section>;
}
