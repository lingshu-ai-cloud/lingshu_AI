import { Alert, Button, Empty, Skeleton, Statistic, Tag } from 'antd';
import { ArrowRight, CalendarPlus, Eye, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import { digitalEmployeeApi } from '../lib/digitalEmployeeApi';
import type { ContentQueueStatus, DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from '../lib/socialPerformance';
import { getScrollBehavior } from '../lib/usePrefersReducedMotion';
import { PAGE_REGISTRY } from '../pageRegistry';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { openContentGenerationQueue } from '../lib/contentGenerationQueue';

const statusLabel: Partial<Record<string, { text: string; color: string }>> = {
  running: { text: '执行中', color: 'processing' },
  active: { text: '执行中', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
  failed: { text: '执行失败', color: 'error' },
  paused: { text: '已暂停', color: 'warning' },
};

const number = (value: number) => value.toLocaleString('zh-CN');
const HOME_VIRAL_LIBRARY_ID = 'creator-home-library';

function openHomeViralLibrary() {
  window.dispatchEvent(new CustomEvent('lingshu:navigate', {
    detail: { page: 'strategy', homeTarget: HOME_VIRAL_LIBRARY_ID },
  }));
  window.setTimeout(() => {
    const target = document.getElementById(HOME_VIRAL_LIBRARY_ID);
    target?.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
    target?.focus({ preventScroll: true });
  }, 0);
}

function countStatuses(data: DigitalEmployeeOverview, statuses: ContentQueueStatus[]) {
  return (data.contentQueue?.items || []).filter(item => statuses.includes(item.status)).length;
}

function CreationPlan({ data, onCreate }: { data: DigitalEmployeeOverview; onCreate:()=>void }) {
  const queue = data.contentQueue?.items || [];
  const displayStatus = statusLabel[data.run?.status || data.goal?.status || ''] || { text: data.goal ? '待启动' : '待创建', color: data.goal ? 'warning' : 'default' };
  const metrics = [
    { label: '计划内容', value: `${queue.length} 条`, view: 'tasks', metric: 'all' },
    { label: '待制作', value: `${countStatuses(data, ['planned', 'queued'])} 条`, view: 'tasks', metric: 'planned' },
    { label: '制作中', value: `${countStatuses(data, ['producing'])} 条`, view: 'tasks', metric: 'producing' },
    { label: '待验收成片', value: `${countStatuses(data, ['waiting_review'])} 条`, view: 'tasks', metric: 'waiting_review' },
    { label: '已完成成片', value: `${countStatuses(data, ['completed'])} 条`, view: 'tasks', metric: 'completed' },
    { label: '已排期发布', value: `${queue.filter(item => Boolean(item.plannedPublishDate)).length} 条`, view: 'calendar', metric: 'scheduled' },
  ];
  const openMetric = (metric: typeof metrics[number]) => openContentGenerationQueue({ view: metric.view as 'tasks'|'calendar', metric: metric.metric as 'all'|'planned'|'producing'|'waiting_review'|'completed'|'scheduled' });


  return <section aria-labelledby="creation-plan-title" className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="creation-plan-title" className="ls-type-title-large text-text-primary">创作计划</h2>
          <Tag color={displayStatus.color}>{displayStatus.text}</Tag>
          {data.goal && <Tag>{data.goal.startsAt.slice(5)} — {data.goal.endsAt.slice(5)}</Tag>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2"><Button type="primary" icon={<CalendarPlus size={16}/>} onClick={onCreate}>新建单条内容任务</Button></div>
    </header>
    <div className="grid gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-3">
      {metrics.map(metric => <button type="button" key={metric.label} onClick={() => openMetric(metric)} aria-label={`查看${metric.label}，${metric.value}`} className="group min-w-0 rounded-lg px-1 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
        <Statistic title={metric.label} value={metric.value} styles={{ title: { color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 8 }, content: { color: 'var(--color-text-primary)', fontSize: 26, fontWeight: 600 } }}/>
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-text-muted group-hover:text-accent">查看详情 <ArrowRight size={12}/></span>
      </button>)}
    </div>
  </section>;
}

function TopPublishedVideos({ performance, loading, error }: { performance: ConnectedSocialPerformance | null; loading: boolean; error: string }) {
  const videos = useMemo(() => (performance?.contents || [])
    .filter(item => item.metrics.views !== null)
    .sort((left, right) => (right.metrics.views || 0) - (left.metrics.views || 0))
    .slice(0, 3), [performance]);

  return <section aria-labelledby="top-published-videos-title" className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
      <h2 id="top-published-videos-title" className="ls-type-title-medium text-text-primary">当前最火的 3 条视频</h2>
      <Eye size={18} className="text-accent" aria-hidden="true"/>
    </header>
    <div className="p-4">
      {loading && !performance ? <Skeleton active paragraph={{ rows: 6 }}/> : error && !videos.length ? <Alert type="warning" showIcon title={error}/> : videos.length ? <ol className="space-y-3">
        {videos.map((video, index) => <li key={video.id}>
          <a href={video.platformUrl || undefined} target={video.platformUrl ? '_blank' : undefined} rel={video.platformUrl ? 'noreferrer' : undefined} className="group grid min-w-0 grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border p-2.5 text-text-primary transition-colors hover:border-border-bright hover:bg-surface-2">
            <span className="relative block aspect-video overflow-hidden rounded-md bg-surface-2">
              {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover"/> : <span className="grid h-full place-items-center text-text-muted"><Play size={18}/></span>}
              <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-[11px] font-semibold text-white">{index + 1}</span>
            </span>
            <span className="min-w-0"><strong className="line-clamp-2 text-sm font-semibold leading-5">{video.title}</strong><span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary"><SocialPlatformIcon platform={video.platform} size={13}/><span className="truncate">{video.accountTitle}</span></span><span className="mt-1 block text-xs font-semibold text-accent">{number(video.metrics.views || 0)} 次播放</span></span>
            <ArrowRight size={15} className="text-text-muted transition-colors group-hover:text-accent" aria-hidden="true"/>
          </a>
        </li>)}
      </ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="已连接账号暂无可核验的历史发布数据"/>}
      {error && videos.length > 0 && <p className="mt-3 text-xs text-warning">部分账号未同步：{error}</p>}
    </div>
  </section>;
}

export default function ContentCreationOverviewPage() {
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [performanceError, setPerformanceError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const reset = () => { setOverview(null); setPerformance(null); setRevision(value => value + 1); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'overseas_token' || event.key === null) reset(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, reset);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOverviewError('');
    setPerformanceError('');
    void Promise.allSettled([digitalEmployeeApi.overview(), loadConnectedSocialPerformance(50)]).then(([overviewResult, performanceResult]) => {
      if (!active) return;
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
      else setOverviewError(overviewResult.reason instanceof Error ? overviewResult.reason.message : '创作计划读取失败');
      if (performanceResult.status === 'fulfilled') {
        setPerformance(performanceResult.value);
        if (performanceResult.value.unavailable.length) setPerformanceError(`${performanceResult.value.unavailable.length} 个账号的数据暂时不可用`);
      } else setPerformanceError(performanceResult.reason instanceof Error ? performanceResult.reason.message : '历史发布数据读取失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  return <main className="h-full min-h-0 overflow-y-auto bg-layout p-4 sm:p-5" data-lingshu-guide="content-creation-overview">
    <h1 className="sr-only">{PAGE_REGISTRY.socialInspiration.canonicalTitle}</h1>
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      {overviewError && <Alert type="warning" showIcon title={overviewError}/>}
      {loading && !overview ? <section className="rounded-lg border border-border bg-surface p-6"><Skeleton active paragraph={{ rows: 8 }}/></section> : overview ? <>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <CreationPlan data={overview} onCreate={openHomeViralLibrary}/>
          <TopPublishedVideos performance={performance} loading={loading} error={performanceError}/>
        </div>
      </> : null}
    </div>
  </main>;
}
