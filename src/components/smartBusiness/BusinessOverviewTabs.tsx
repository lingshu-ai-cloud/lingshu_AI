import { Button, Collapse, Tabs } from 'antd';
import { ArrowRight, CalendarDays, CircleDollarSign, MessageSquareText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AUTH_TOKEN_CHANGED_EVENT, authApi, authHeader } from '../../lib/auth';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { PUBLISH_QUEUE_UPDATED_EVENT, readStoredPublishQueue, type PublishQueueItem } from '../../lib/publishQueueState';
import type { Page } from '../../pageRegistry';
import NextRoundRecommendationsSection from '../NextRoundRecommendationsSection';
import BatchPublishDraftDialog from '../publishing/BatchPublishDraftDialog';
import { CalendarPlanner } from '../publishing/CalendarPlanner';
import InquiryDataBoard from '../InquiryDataBoard';
import BusinessAdsOverview from './BusinessAdsOverview';

export default function BusinessOverviewTabs({ data, onNavigate }: { data: DigitalEmployeeOverview; onNavigate?: (page: Page) => void }) {
  const [storageScope, setStorageScope] = useState('');
  const [queueItems, setQueueItems] = useState<PublishQueueItem[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const overviewData = data;
  const [identity, setIdentity] = useState(() => authHeader().Authorization || '');
  const [queueRevision, setQueueRevision] = useState(0);
  useEffect(() => {
    const reset = () => { setQueueItems([]); setStorageScope(''); setBatchOpen(false); setIdentity(authHeader().Authorization || ''); };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === 'overseas_token') reset(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.addEventListener('storage', storage);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.removeEventListener('storage', storage); };
  }, []);

  const loadQueue = useCallback((scope: string) => setQueueItems(readStoredPublishQueue(scope)), []);
  useEffect(() => {
    let active = true;
    void authApi.me().then(session => {
      if (!active || !session) return;
      const scope = session.tenant?.id || session.user.tenantId;
      setStorageScope(scope);
      loadQueue(scope);
    }).catch(() => {});
    return () => { active = false; };
  }, [loadQueue, identity]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ storageScope?: string }>).detail;
      if (!storageScope || String(detail?.storageScope || '') !== storageScope) return;
      loadQueue(storageScope);
      setQueueRevision(value => value + 1);
    };
    window.addEventListener(PUBLISH_QUEUE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PUBLISH_QUEUE_UPDATED_EVENT, refresh);
  }, [loadQueue, storageScope]);
  const pendingItems = useMemo(() => queueItems
    .filter(item => Boolean(item.videoPath) && ['ready', 'partial', 'failed'].includes(item.status))
    .map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      sourceProjectId: item.sourceProjectId,
      sourcePlatform: item.sourcePlatform,
      platforms: Object.keys(item.platformCopy),
      deliveryMode: item.deliveryMode,
      scheduledAt: item.scheduledAt,
      status: item.status,
    })), [queueItems]);

  return <section aria-label="经营总览业务页签" className="mt-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
    <Tabs key={identity} aria-label="经营总览页内视图" destroyOnHidden items={[
      { key: 'calendar', label: <span className="inline-flex items-center gap-2"><CalendarDays size={15}/>发布日历</span>, children: <div className="space-y-6 pt-2">
        <section aria-label="内容生成队列入口" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 p-4">
          <div><h3 className="font-semibold text-text-primary">内容生成队列</h3><p className="mt-1 text-sm text-text-secondary">周任务和临时单条任务统一在同一队列中查看与管理。</p></div>
          <Button type="primary" icon={<CalendarDays size={15}/>} onClick={() => openContentGenerationQueue({ view: 'calendar' })}>打开内容生成队列</Button>
        </section>
        <Collapse ghost items={[{ key: 'receipts', label: '平台发布排期与回执', children: <CalendarPlanner allowDemo={false} refreshKey={queueRevision} pendingItems={pendingItems} onOpenPending={() => onNavigate?.('traffic')} onCreatePending={storageScope ? () => setBatchOpen(true) : undefined} onOpenPost={() => onNavigate?.('traffic')}/> }]}/>
        <NextRoundRecommendationsSection summary={overviewData.review?.status === 'generated' ? overviewData.review.summary : undefined} industryTrends={overviewData.industryTrends} onOpen={page => onNavigate?.(page as Page)}/>
      </div> },
      { key: 'ads', label: <span className="inline-flex items-center gap-2"><CircleDollarSign size={15}/>投流速览</span>, children: <div className="pt-2"><BusinessAdsOverview onNavigate={onNavigate}/></div> },
      { key: 'inquiries', label: <span className="inline-flex items-center gap-2"><MessageSquareText size={15}/>询盘诊断</span>, children: <div className="space-y-3 pt-2">
        <InquiryDataBoard includeMockCustomers={false}/>
        <Button onClick={() => onNavigate?.('conversion')} icon={<ArrowRight size={14}/>}>进入智能客服查看客户</Button>
      </div> },
    ]}/>
    <BatchPublishDraftDialog open={batchOpen} storageScope={storageScope} onCancel={() => setBatchOpen(false)} onSaved={() => { loadQueue(storageScope); setBatchOpen(false); }}/>
  </section>;
}
