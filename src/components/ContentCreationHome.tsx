import { Alert, Button, Segmented, Spin } from 'antd';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Page } from '../pageRegistry';
import { useCreationMode, useCreationModeControl, type CreationMode } from '../lib/creationMode';
import { fetchViralFeed } from '../lib/viralVideoFeed';
import { digitalEmployeeApi } from '../lib/digitalEmployeeApi';
import { AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { TrendVideo } from '../lib/inspirationTypes';
import { LsMasonryGallery } from './ui/LsExperiencePrimitives';
import { VideoCard } from './InspirationVideoCards';
import InspirationWatchDialog from './inspiration/InspirationWatchDialog';
import DigitalEmployeeHomeWork from './DigitalEmployeeHomeWork';
import type { AssistantReferenceMedia } from '../App';
import { getScrollBehavior } from '../lib/usePrefersReducedMotion';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const resetTenantData = () => { setVideos([]); setOverview(null); setPreview(null); setVideoRevision(value => value + 1); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'overseas_token' || event.key === null) resetTenantData(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, resetTenantData);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, resetTenantData); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setVideosLoading(true);
    setVideosError('');
    void fetchViralFeed(controller.signal)
      .then(setVideos)
      .catch(error => { if (!controller.signal.aborted) setVideosError(error instanceof Error ? error.message : '爆款视频加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setVideosLoading(false); });
    return () => controller.abort();
  }, [videoRevision]);

  useEffect(() => {
    if (mode !== 'employee') return;
    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    void digitalEmployeeApi.overview()
      .then(data => { if (active) setOverview(data); })
      .catch(error => { if (active) setOverviewError(error instanceof Error ? error.message : '周任务状态读取失败'); })
      .finally(() => { if (active) setOverviewLoading(false); });
    return () => { active = false; };
  }, [mode, videoRevision]);

  const openPreview = (video: TrendVideo) => {
    previewTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreview(video);
  };
  const closePreview = () => {
    setPreview(null);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  };
  const openInspirationReference = (video: TrendVideo) => {
    setPreview(null);
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
      page: 'socialInspiration',
      inspirationReference: { referenceId: video.recordId || video.id.replace(/^crawl-/, ''), sourceUrl: video.sourceUrl, title: video.title, platform: video.platform, thumbnailUrl: video.thumbnail, duration: video.duration },
    } }));
  };
  const startAssistantReplication = (video: TrendVideo) => {
    setPreview(null);
    const referenceId = video.recordId || video.id.replace(/^crawl-/, '');
    const referenceMedia: AssistantReferenceMedia = {
      kind: 'video', title: video.title, platform: video.platform, referenceId,
      thumbnailUrl: video.thumbnail || undefined, mediaUrl: video.videoUrl || undefined,
      sourceUrl: video.sourceUrl || undefined, duration: video.duration,
    };
    const facts = [
      `参考视频：${video.title}`,
      `平台：${video.platform}`,
      `引用编号：${referenceId}`,
      video.sourceUrl ? `来源链接：${video.sourceUrl}` : '',
    ].filter(Boolean).join('\n');
    window.dispatchEvent(new CustomEvent('lingshu-assistant-open', { detail: {
      text: `我想复刻这条爆款视频。请先基于原视频和我确认产品、目标、平台，以及需要保留和替换的内容，再进入制作。\n${facts}`,
      assistantText: '已收到这条爆款视频。我会先和你确认生产所需信息，不会在你确认前启动制作或调用视频生成供应商。',
      referenceMedia,
      context: {
        agent: 'traffic', label: '爆款复刻',
        summary: `当前在内容创作首页，用户选择了精确爆款视频“${video.title}”进行对话式辅助生产。`,
        suggestions: ['选择要复刻的企业产品', '确认发布平台与目标', '说明保留和替换的内容'],
      },
    } }));
    window.requestAnimationFrame(() => document.getElementById('content-creation-assistant-anchor')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }));
  };
  const updateActiveSection = () => {
    const scroller = scrollRef.current;
    const gallery = libraryRef.current;
    if (!scroller || !gallery) return;
    const firstRowHeight = gallery.querySelector<HTMLElement>('[data-home-media]')?.offsetHeight || 360;
    const libraryActive = scroller.scrollTop + scroller.clientHeight * 0.36 >= gallery.offsetTop + firstRowHeight;
    window.dispatchEvent(new CustomEvent('lingshu:home-section-active', { detail: libraryActive ? 'socialInspiration' : 'strategy' }));
  };

  useEffect(() => () => { window.dispatchEvent(new CustomEvent('lingshu:home-section-active', { detail: 'strategy' })); }, []);

  const suggest = (prompt: string) => window.dispatchEvent(new CustomEvent('lingshu:assistant-home-prompt', { detail: prompt }));

  return <div ref={scrollRef} className={`creator-home creator-home--${mode} h-full overflow-y-auto`} onScroll={updateActiveSection}>
    <div className="creator-home__inner">
      <header className="creator-home__hero text-center">
        <h2>{mode === 'free' ? '你好，今天想要创作什么？' : '今天想让数字员工完成什么？'}</h2>
        <Segmented aria-label="内容创作模式" className="creator-mode-switch" size="large" value={mode}
          options={[{ label: '自由创作', value: 'free' }, { label: '数字员工', value: 'employee' }]}
          onChange={value => switchMode?.(value as CreationMode)} />
      </header>

      <div className="creator-home__canvas-stage" aria-hidden={mode !== 'employee'}>
        <div className="creator-home__canvas" aria-label="数字员工进行中工作">
          {overviewError && <Alert type="warning" showIcon title={overviewError} className="mb-3"/>}
          {overviewLoading && !overview ? <div className="flex min-h-40 items-center justify-center"><Spin description="正在读取数字员工工作"/></div>
            : <DigitalEmployeeHomeWork data={overview} onNavigate={onNavigate}/>}</div>
      </div>

      <section className="creator-home__conversation" aria-label="灵小枢对话">
        <div id="content-creation-assistant-anchor" className="creator-home__assistant-anchor"/>
      </section>

      {mode === 'free' && <div className="creator-home__suggestions" aria-label="创作建议">
        {['写一条爆款视频脚本', '帮我制作产品分镜', '提炼产品卖点', '规划本周内容', '查看素材怎么用'].map(prompt =>
          <button type="button" key={prompt} onClick={() => suggest(prompt)}>{prompt}<ArrowRight size={14} aria-hidden="true"/></button>)}
      </div>}

      <section ref={libraryRef} id="creator-home-library" className="creator-home__library" aria-label="爆款库连续内容">
        <div className="creator-home__library-heading"><h2>爆款视频</h2>
          <Button onClick={() => onNavigate?.('socialInspiration')} icon={<ArrowRight size={15}/>}>完整爆款库</Button></div>
        {videosError && <Alert type="warning" showIcon title={videosError} action={<Button size="small" icon={<RefreshCw size={13}/>} onClick={() => setVideoRevision(value => value + 1)}>重试</Button>} className="mb-3"/>}
        {videosLoading && !videos.length ? <div className="flex min-h-40 items-center justify-center"><Spin description="正在读取爆款视频"/></div>
          : videos.length ? <LsMasonryGallery layout="masonry" columns={{ xs: 2, sm: 2, md: 3, lg: 4 }} items={videos.map(video => ({ id: video.id, content:
            <div data-home-media><VideoCard video={video} onWatch={() => openPreview(video)}
              onSelect={() => openPreview(video)} onCreate={() => startAssistantReplication(video)} createLabel="爆款复刻"/></div> }))}/>
            : !videosLoading && !videosError && <p className="creator-home__empty">当前租户暂无可展示的爆款视频。</p>}
      </section>
    </div>
    {preview && <InspirationWatchDialog key={preview.id} video={preview} videos={videos} onClose={closePreview}
      onOpenDetails={openInspirationReference}/>}
  </div>;
}
