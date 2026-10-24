import { Alert, Button, Segmented, Spin } from 'antd';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Page } from '../pageRegistry';
import { useCreationMode, useCreationModeControl, type CreationMode } from '../lib/creationMode';
import { fetchViralFeed } from '../lib/viralVideoFeed';
import { digitalEmployeeApi } from '../lib/digitalEmployeeApi';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { TrendVideo } from '../lib/inspirationTypes';
import { LsMasonryGallery } from './ui/LsExperiencePrimitives';
import { VideoCard } from './InspirationVideoCards';
import InspirationWatchDialog from './inspiration/InspirationWatchDialog';
import EmployeeGoalPanel from './contentCreation/EmployeeGoalPanel';
import { WEEKLY_WORK_UPDATED_EVENT } from '../lib/weeklyWorkEvents';

const EmployeeExecutionView = lazy(() => import('./contentCreation/EmployeeExecutionView'));
const EmployeeDeliveries = lazy(() => import('./contentCreation/EmployeeDeliveries'));

export default function ContentCreationHome({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const mode = useCreationMode();
  const switchMode = useCreationModeControl();
  const [videos, setVideos] = useState<TrendVideo[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState('');
  const [videoRevision, setVideoRevision] = useState(0);
  const [preview, setPreview] = useState<TrendVideo | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [executionOpen, setExecutionOpen] = useState(false);
  const executionTriggerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const resetTenantData = () => { setVideos([]); setOverview(null); setOverviewError(''); setOverviewLoading(true); setExecutionOpen(false); setPreview(null); setVideoRevision(value => value + 1); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'overseas_token' || event.key === null) resetTenantData(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, resetTenantData);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, resetTenantData); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    if (mode !== 'free') return;
    const controller = new AbortController();
    setVideosLoading(true);
    setVideosError('');
    void fetchViralFeed(controller.signal)
      .then(setVideos)
      .catch(error => { if (!controller.signal.aborted) setVideosError(error instanceof Error ? error.message : '爆款视频加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setVideosLoading(false); });
    return () => controller.abort();
  }, [mode, videoRevision]);

  useEffect(() => {
    if (mode !== 'employee') return;
    let active = true;
    let requestVersion = 0;
    const authorization = authHeader().Authorization;
    const refresh = async () => {
      const version = ++requestVersion;
      setOverviewLoading(true);
      try {
        const data = await digitalEmployeeApi.overview();
        if (!active || version !== requestVersion || authorization !== authHeader().Authorization) return;
        setOverview(data);
        setOverviewError('');
      } catch (error) {
        if (active && version === requestVersion && authorization === authHeader().Authorization) setOverviewError(error instanceof Error ? error.message : '周任务状态读取失败');
      } finally {
        if (active && version === requestVersion && authorization === authHeader().Authorization) setOverviewLoading(false);
      }
    };
    void refresh();
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(whenVisible, 15_000);
    window.addEventListener(WEEKLY_WORK_UPDATED_EVENT, whenVisible);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(WEEKLY_WORK_UPDATED_EVENT, whenVisible);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [mode, videoRevision]);

  const refreshOverview = () => setVideoRevision(value => value + 1);
  const closeExecution = () => {
    setExecutionOpen(false);
    window.requestAnimationFrame(() => executionTriggerRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
  };

  const openPreview = (video: TrendVideo) => {
    previewTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreview(video);
  };
  const closePreview = () => {
    setPreview(null);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  };
  const openInspirationReference = (video: TrendVideo, startViralReplication = false) => {
    setPreview(null);
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
      page: 'socialInspiration',
      startViralReplication,
      inspirationReference: { referenceId: video.recordId || video.id.replace(/^crawl-/, ''), sourceUrl: video.sourceUrl, title: video.title, platform: video.platform, thumbnailUrl: video.thumbnail, duration: video.duration },
    } }));
  };
  const updateActiveSection = () => {
    const scroller = scrollRef.current;
    const gallery = libraryRef.current;
    if (!scroller || !gallery || mode !== 'free') return;
    const firstRowHeight = gallery.querySelector<HTMLElement>('[data-home-media]')?.offsetHeight || 360;
    const libraryActive = scroller.scrollTop + scroller.clientHeight * 0.36 >= gallery.offsetTop + firstRowHeight;
    window.dispatchEvent(new CustomEvent('lingshu:home-section-active', { detail: libraryActive ? 'socialInspiration' : 'strategy' }));
  };

  useEffect(() => () => { window.dispatchEvent(new CustomEvent('lingshu:home-section-active', { detail: 'strategy' })); }, []);

  const suggest = (prompt: string) => window.dispatchEvent(new CustomEvent('lingshu:assistant-home-prompt', { detail: prompt }));

  return <div ref={scrollRef} className={`creator-home creator-home--${mode} h-full overflow-y-auto`} onScroll={updateActiveSection}>
    <div className="creator-home__inner">
      <header className="creator-home__hero text-center">
        <h2>{mode === 'free' ? '你好，今天想要创作什么？' : '你的数字员工工作台'}</h2>
        <Segmented aria-label="内容创作模式" className="creator-mode-switch" size="large" value={mode}
          options={[{ label: '自由创作', value: 'free' }, { label: '数字员工', value: 'employee' }]}
          onChange={value => switchMode?.(value as CreationMode)} />
      </header>

      <div className="creator-home__canvas-stage" aria-hidden={mode !== 'employee'} inert={mode !== 'employee'}>
        <section className="creator-home__canvas" aria-label="数字员工周任务">
          {overviewError && <Alert type="warning" showIcon title="周任务状态暂未更新" description={overviewError} action={<Button size="small" onClick={refreshOverview}>重试</Button>} className="mb-3"/>}
          {overviewLoading && !overview ? <div role="status" className="flex min-h-48 items-center justify-center"><Spin description="正在读取本周内容计划…"/></div> : overviewError && !overview ? <p className="p-5 text-sm text-text-muted">暂时无法核验本周内容目标和成片，请重试。</p> : <>
            <div hidden={executionOpen}>
              <div ref={executionTriggerRef}><EmployeeGoalPanel data={overview} onOpenExecution={() => setExecutionOpen(true)} onPlan={() => suggest('请帮我制定本周内容目标和周计划')}/></div>
              {mode === 'employee' && overview && <Suspense fallback={<div role="status" className="p-5">正在读取成片…</div>}><EmployeeDeliveries data={overview}/></Suspense>}
            </div>
            {mode === 'employee' && executionOpen && overview && <Suspense fallback={<div role="status" className="p-5">正在加载执行现场…</div>}><EmployeeExecutionView key={`${overview.goal?.id}:${overview.plan?.id}:${overview.run?.id}`} data={overview} onBack={closeExecution} onRefresh={refreshOverview}/></Suspense>}
          </>}
        </section>
      </div>

      <section className="creator-home__conversation" aria-label="灵小枢对话" hidden={mode === 'employee' && executionOpen}>
        <div id="content-creation-assistant-anchor" className="creator-home__assistant-anchor"/>
      </section>

      {mode === 'free' && <div className="creator-home__suggestions" aria-label="创作建议">
        {['写一条爆款视频脚本', '帮我制作产品分镜', '提炼产品卖点', '规划本周内容', '查看素材怎么用'].map(prompt =>
          <button type="button" key={prompt} onClick={() => suggest(prompt)}>{prompt}<ArrowRight size={14} aria-hidden="true"/></button>)}
      </div>}

      {mode === 'free' && <section ref={libraryRef} id="creator-home-library" className="creator-home__library" aria-label="灵感爆款连续内容">
        <div className="creator-home__library-heading"><h2>爆款视频</h2>
          <Button onClick={() => onNavigate?.('socialInspiration')} icon={<ArrowRight size={15}/>}>完整灵感爆款</Button></div>
        {videosError && <Alert type="warning" showIcon title={videosError} action={<Button size="small" icon={<RefreshCw size={13}/>} onClick={() => setVideoRevision(value => value + 1)}>重试</Button>} className="mb-3"/>}
        {videosLoading && !videos.length ? <div className="flex min-h-40 items-center justify-center"><Spin description="正在读取爆款视频"/></div>
          : videos.length ? <LsMasonryGallery layout="masonry" columns={{ xs: 2, sm: 2, md: 3, lg: 4 }} items={videos.map((video, index) => ({ id: video.id, content:
            <div data-home-media><VideoCard video={video} index={index} isSelected={false} onWatch={() => openPreview(video)}
              onSelect={() => openPreview(video)} onCreate={() => openInspirationReference(video, true)} createLabel="爆款裂变"/></div> }))}/>
            : !videosLoading && !videosError && <p className="creator-home__empty">当前租户暂无可展示的爆款视频。</p>}
      </section>}
    </div>
    {preview && <InspirationWatchDialog key={preview.id} video={preview} videos={videos} onClose={closePreview}
      onOpenDetails={video => openInspirationReference(video)}/>}
  </div>;
}
