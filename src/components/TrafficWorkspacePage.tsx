import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, Film, Send, Wand2 } from 'lucide-react';
import SocialAccountStrategies from './socialProgram/SocialAccountStrategies';
import SocialContentOrderOperations from './socialContent/SocialContentOrderOperations';
import { PAGE_REGISTRY } from '../pageRegistry';
import { resolveInitialTrafficViewMode, resolveNavigationEventViewMode, resolveSignalViewMode, resolveWorkflowNavigationPage, type TrafficViewMode } from './trafficViewMode';
import { useSocialContentNavigation } from './socialContent/useSocialContentNavigation';
import { SOCIAL_CONTENT_NAVIGATION_EVENT, attachSocialContentNavigationState, hasWeeklyContentNavigationTarget, openSocialImageReplication, readWeeklyContentNavigationTarget } from '../lib/socialContentContext';
import { resumeOrCreateInspirationTask } from '../lib/socialInspirationTask';
import { publishStorageKey, readStoredPublishDraft, type PublishDraft } from '../lib/publishQueueState';
import { PageLoading, WorkspaceErrorBoundary } from './AppPageBoundary';
import type { Props, DigitalEmployeeWorkflowContext } from './TrafficPage';
import type { Page } from '../App';

const InspirationDashboard = lazy(() => import('./InspirationDashboard'));
const AiCreateStudio = lazy(() => import('./AiCreateStudio'));
const WeeklyContentProductionView = lazy(() => import('./socialContent/WeeklyContentProductionView'));
const WeeklyPublishingWorkspace = lazy(() => import('./socialContent/WeeklyPublishingWorkspace'));
const AccountActivity = lazy(() => import('./AccountActivity'));

type ViewMode = TrafficViewMode;
type PublishPanelProps = {
  onNavigate?: (page: Page) => void;
  draft?: PublishDraft | null;
  onReturnToPreview?: (projectId?: string) => void;
  workflowContext?: DigitalEmployeeWorkflowContext;
  storageScope?: string;
};
type TrafficWorkspaceProps = Props & {
  PublishPanel: ComponentType<PublishPanelProps>;
  consumeWorkflowContext: () => DigitalEmployeeWorkflowContext | null;
  contentCreationAspectRatio: (aspectRatio?: number, width?: number, height?: number) => '9:16' | '1:1' | '16:9' | undefined;
};

const TRAFFIC_MODE_META: Record<ViewMode, {
  icon: typeof Film;
  label: string;
  guide: string;
}> = {
  materials: { icon: Film, label: '灵感', guide: 'social-inspiration' },
  create: { icon: Wand2, label: '创作', guide: 'ai-create' },
  publish: { icon: Send, label: '发布', guide: 'publishing-workbench' },
  accounts: { icon: BarChart3, label: '账号', guide: 'social-performance' },
};

const TRAFFIC_MODE_ORDER: ViewMode[] = ['materials', 'create', 'publish', 'accounts'];

export default function TrafficWorkspacePage({
  sourcePage,
  onNavigate,
  restore,
  kickoff,
  onScriptPanelOpen,
  onScriptPanelClose,
  initialView,
  showModeTabs = true,
  visibleModes,
  pageTitle = PAGE_REGISTRY.traffic.canonicalTitle,
  openProjectsSignal = 0,
  storageScope,
  workflowContextSignal,
  socialContentTaskId,
  studioCreateRequest,
  onOpenCreationHome,
  onLaunchContentStudio,
  onReturnToContentPlanning,
  PublishPanel, consumeWorkflowContext, contentCreationAspectRatio,
}: TrafficWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (initialView) return initialView;
    try {
      const initialView = localStorage.getItem('lingshu:traffic:initial-view');
      const persistedView = localStorage.getItem('lingshu:traffic:view-mode');
      localStorage.removeItem('lingshu:traffic:initial-view');
      return resolveInitialTrafficViewMode(initialView, persistedView);
    } catch { /* ignore */ }
    return 'materials';
  });
  const [studioMounted, setStudioMounted] = useState(() => initialView === 'create');
  const readWeeklyTargetState = () => ({
    present: typeof window !== 'undefined' && hasWeeklyContentNavigationTarget(window.history.state),
    target: typeof window === 'undefined' ? null : readWeeklyContentNavigationTarget(window.history.state),
  });
  const [weeklyTargetState,setWeeklyTargetState]=useState(readWeeklyTargetState);
  const weeklyTarget=weeklyTargetState.target?.contentTaskId===socialContentTaskId?weeklyTargetState.target:null;
  useEffect(()=>{
    let disposed=false;
    const read=()=>{if(!disposed)setWeeklyTargetState(readWeeklyTargetState());};
    // App writes the handoff during its navigation listener; read after all listeners finish.
    const navigated=()=>queueMicrotask(read);
    read();
    window.addEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT,read);
    window.addEventListener('popstate',read);
    window.addEventListener('lingshu:navigate',navigated);
    return()=>{disposed=true;window.removeEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT,read);window.removeEventListener('popstate',read);window.removeEventListener('lingshu:navigate',navigated);};
  },[socialContentTaskId,studioCreateRequest]);
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);
  const [inspirationLaunchError, setInspirationLaunchError] = useState('');
  const [workflowContext, setWorkflowContext] = useState<DigitalEmployeeWorkflowContext | null>(consumeWorkflowContext);
  const studioRootRef = useRef<HTMLDivElement | null>(null);
  const modeItems = TRAFFIC_MODE_ORDER
    .filter(mode => !visibleModes || visibleModes.includes(mode))
    .map(mode => ({ mode, ...TRAFFIC_MODE_META[mode] }));
  const navigateWithinSocialTask = useSocialContentNavigation(onNavigate, socialContentTaskId);

  useEffect(() => {
    setWorkflowContext(workflowContextSignal || null);
  }, [workflowContextSignal]);

  useEffect(() => {
    try { localStorage.setItem('lingshu:traffic:view-mode', viewMode); } catch { /* ignore */ }
    if (viewMode === 'create') setStudioMounted(true);
    if (initialView === 'create' || initialView === 'publish') {
      window.dispatchEvent(new CustomEvent('lingshu:content-view-changed', {
        detail: { entry: viewMode === 'publish' ? 'publish' : 'create' },
      }));
    }
  }, [viewMode]);

  useEffect(() => {
    if (initialView) setViewMode(initialView);
  }, [initialView]);

  useEffect(() => {
    if (restore || kickoff) setViewMode(current => resolveSignalViewMode(current, true));
  }, [restore?.key, kickoff?.key]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: Page; view?: ViewMode; studioPanel?: 'projects'; runId?: string; taskId?: string; workflowRunId?: string; workflowTaskId?: string; businessRef?: { taskKey?: string; entityId?: string } }>).detail;
      if (detail?.page === 'traffic' && detail.view) {
        setViewMode(current => resolveNavigationEventViewMode(current, detail.view!));
      }
      if (detail?.page === 'smartAssets' && (detail.view === 'create' || detail.view === 'publish')) {
        const runId = String(detail.workflowRunId || detail.runId || '').trim();
        const taskId = String(detail.workflowTaskId || detail.taskId || '').trim();
        if (runId && taskId) {
          setWorkflowContext({ runId, taskId, taskKey: String(detail.businessRef?.taskKey || ''), entityId: detail.businessRef?.entityId });
          try { sessionStorage.removeItem('digitalEmployee.businessDeepLink'); } catch { /* optional handoff cache */ }
        } else {
          setWorkflowContext(null);
        }
        if (detail.studioPanel !== 'projects') {
          studioRootRef.current
            ?.querySelector<HTMLButtonElement>('button[aria-label="关闭我的创作"]')
            ?.click();
        }
        setViewMode(detail.view);
      }
    };
    window.addEventListener('lingshu:navigate', handler);
    return () => window.removeEventListener('lingshu:navigate', handler);
  }, []);

  useEffect(() => {
    const contextByMode: Record<ViewMode, { summary: string; suggestions: string[] }> = {
      materials: {
        summary: '当前在灵感中心，适合拆解爆款内容、筛选素材方向、规划发布节奏。',
        suggestions: ['拆解当前素材方向', '规划本周发布节奏', '找出适合目标市场的内容角度', '把素材转成创作任务'],
      },
      create: {
        summary: '当前在内容创作的创作阶段，适合生成图文海报、短视频脚本、标题、口播钩子和发布文案。',
        suggestions: ['生成一套主推品素材', '把卖点改成外语口播', '设计 Facebook 图文文案', '优化视频开头 3 秒钩子'],
      },
      publish: {
        summary: '当前在内容创作的发布阶段，适合检查授权账号、确认统一发布文案与 Tag、首评和 WhatsApp 追踪链接。',
        suggestions: ['检查统一发布文案与 Tag', '检查首评内容', '确认追踪链接', '排到建议时段发布'],
      },
      accounts: {
        summary: '当前在账号管理，适合查看账号表现，以及识别评论中的高意向商机。',
        suggestions: ['查看待回复高意向评论', '判断评论采购意图', '生成真人化回复', '复盘账号表现'],
      },
    };
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'traffic',
        sourcePage,
        label: showModeTabs ? `${pageTitle} · ${TRAFFIC_MODE_META[viewMode].label}阶段` : pageTitle,
        ...contextByMode[viewMode],
      },
    }));
  }, [pageTitle, showModeTabs, sourcePage, viewMode]);

  const handleEnterWorkflow = async (payload: unknown) => {
    try {
      localStorage.setItem('ow_video_kickoff', JSON.stringify(payload));
      localStorage.removeItem('ow_studio_open_project');
      const destination = new URL(window.location.href);
      destination.searchParams.delete('project');
      window.history.replaceState(window.history.state, '', destination);
    } catch { /* ignore */ }
    const kickoff = payload as {
      source?: string;
      productInfo?: string;
      generatedVideo?: {
        title?: string;
        url?: string;
        poster?: string;
        material?: {
          name?: string;
          type?: 'video' | 'image' | 'audio';
          url?: string;
          poster?: string;
          productId?: string;
          productName?: string;
          aspectRatio?: number;
          width?: number;
          height?: number;
        };
      };
      video?: {
        id?: string;
        recordId?: string;
        title?: string;
        platform?: string;
        thumbnail?: string;
        sourceUrl?: string;
        videoUrl?: string;
        contentFormat?: string;
        crawledAt?: string;
        aspectRatio?: number;
        width?: number;
        height?: number;
      };
    };
    if (kickoff.source === 'material_library'
      && kickoff.video?.contentFormat === 'image'
      && !kickoff.generatedVideo?.material) {
      window.dispatchEvent(new CustomEvent('lingshu:navigate', {
        detail: {
          page: 'smartAssets',
          view: 'create',
          studioEntry: true,
          directStudio: true,
        },
      }));
      return;
    }
    if (kickoff.source === 'material_library' && kickoff.generatedVideo?.material) {
      const material = kickoff.generatedVideo.material;
      const materialUrl = String(material.url || kickoff.generatedVideo.url || '').trim();
      const previewUrl = String(material.poster || kickoff.generatedVideo.poster || '').trim();
      window.dispatchEvent(new CustomEvent('lingshu:navigate', {
        detail: {
          page: 'smartAssets',
          view: 'create',
          contentCreationRequest: {
            requestId: Date.now(),
            themeId: 'product_value',
            mode: 'instant',
            creationPath: 'material_processing',
            materialInput: 'ready',
            managedMode: 'one_click_managed',
            prefill: {
              title: `${material.name || kickoff.generatedVideo.title || '素材'} · 自由创作`,
              topic: material.name || kickoff.generatedVideo.title || '',
              productId: material.productId,
              productName: material.productName,
              referenceLinks: materialUrl ? [materialUrl] : [],
            },
            sourceContext: {
              originLabel: '来自我的素材',
              referenceTitle: material.name || kickoff.generatedVideo.title || '已选素材',
              referenceThumbnail: previewUrl || undefined,
              referenceMediaUrl: materialUrl || undefined,
              referenceContentType: material.type === 'video' ? 'video' : 'image',
              aspectRatio: contentCreationAspectRatio(material.aspectRatio, material.width, material.height),
            },
          },
        },
      }));
      return;
    }
    if (kickoff.source === 'inspiration_image_post' && kickoff.video?.contentFormat === 'image') { openSocialImageReplication(kickoff.video as Parameters<typeof openSocialImageReplication>[0]); return; }
    if (kickoff.source === 'inspiration_analysis' && kickoff.video?.contentFormat !== 'image') {
      const playbackUrl = String(kickoff.video?.videoUrl || '').trim();
      const referenceUrl = String(kickoff.video?.sourceUrl || playbackUrl).trim();
      // The studio consumes the full verified reference payload on entry.
      // Keep it alongside the navigation prefill so the storyboard is not
      // reduced to a bare URL when the planning dialog is skipped.
      try { localStorage.setItem('ow_video_kickoff', JSON.stringify(payload)); } catch { /* ignore */ }
      setInspirationLaunchError('');
      try {
        const result = await resumeOrCreateInspirationTask({
          id: String(kickoff.video?.recordId || kickoff.video?.id || referenceUrl),
          title: kickoff.video?.title || '灵感视频',
          sourceUrl: String(kickoff.video?.sourceUrl
            || (kickoff.video?.recordId ? `local://${kickoff.video.recordId}` : playbackUrl)).trim(),
          crawledAt: kickoff.video?.crawledAt,
        });
        const taskId = result.task.taskId;
        window.dispatchEvent(new CustomEvent('lingshu:navigate', {
          detail: {
            page: 'smartAssets',
            view: 'create',
            directStudio: true,
            socialContentTaskId: taskId,
            socialContentPage: 'smartAssets',
            contentCreationRequest: {
              requestId: Date.now(),
              themeId: 'product_value',
              mode: 'instant',
              creationPath: 'viral_replication',
              materialInput: referenceUrl ? 'limited' : 'none',
              managedMode: 'one_click_managed',
              continueTaskId: taskId,
              prefill: {
                title: `${kickoff.video?.title || '灵感视频'} · 爆款复刻`,
                topic: kickoff.video?.title || '',
                productName: String(kickoff.productInfo || '').trim().slice(0, 160),
                referenceLinks: referenceUrl ? [referenceUrl] : [],
                platforms: kickoff.video?.platform ? [kickoff.video.platform] : undefined,
              },
              sourceContext: {
                originLabel: '来自灵感中心',
                referenceTitle: kickoff.video?.title || '已选参考视频',
                referenceThumbnail: kickoff.video?.thumbnail,
                referenceMediaUrl: playbackUrl || undefined,
                referenceContentType: 'video',
                aspectRatio: contentCreationAspectRatio(kickoff.video?.aspectRatio, kickoff.video?.width, kickoff.video?.height),
              },
            },
          },
        }));
      } catch (error) {
        setInspirationLaunchError(error instanceof Error ? error.message : '复刻任务暂时无法创建，请重试。');
      }
      return;
    }
    try { localStorage.setItem('ow_video_kickoff', JSON.stringify(payload)); } catch { /* ignore */ }
    const targetPage = resolveWorkflowNavigationPage(initialView, showModeTabs);
    if (targetPage) {
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: targetPage, view: 'create', studioEntry: true } }));
      return;
    }
    setViewMode('create');
  };

  const handleGoPublish = (draft: PublishDraft) => {
    setPublishDraft(draft);
    try { localStorage.setItem(publishStorageKey('ow_publish_draft', storageScope), JSON.stringify(draft)); } catch { /* ignore */ }
    setViewMode('publish');
  };

  const handleReturnToPreview = (projectId?: string) => {
    try {
      localStorage.setItem('ow_publish_return_to_preview', JSON.stringify({
        at: Date.now(),
        projectId: projectId || publishDraft?.sourceProjectId || readStoredPublishDraft(storageScope)?.sourceProjectId || '',
      }));
    } catch { /* ignore */ }
    setViewMode('create');
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {inspirationLaunchError && <div role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800">{inspirationLaunchError}</div>}
      {showModeTabs && <div className="flex-shrink-0 bg-white px-3 sm:px-6">
        <div
          role="tablist"
          aria-label={`${pageTitle}流程`}
          className="mx-auto flex w-full max-w-2xl items-stretch justify-center gap-7 overflow-x-auto border-b border-border"
          style={{ gridTemplateColumns: `repeat(${modeItems.length}, minmax(0, 1fr))` }}
        >
          {modeItems.map(({ mode, icon: Icon, label, guide }) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                id={`traffic-tab-${mode}`}
                aria-selected={active}
                aria-controls={`traffic-panel-${mode}`}
                aria-current={active ? 'step' : undefined}
                data-lingshu-guide={guide}
                onClick={() => setViewMode(mode)}
                className={`flex h-12 min-w-fit items-center justify-center gap-1.5 border-b-2 px-1 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                  active ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon aria-hidden="true" size={16} className={active ? 'text-accent' : 'text-text-muted'} />
                <span className="min-w-0 truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>}

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <WorkspaceErrorBoundary resetKey={viewMode} label={TRAFFIC_MODE_META[viewMode].label}>
          <Suspense fallback={<PageLoading />}>
            {(studioMounted || viewMode === 'create') && (
              <div ref={studioRootRef} id="traffic-panel-create" role={showModeTabs ? 'tabpanel' : undefined} aria-labelledby={showModeTabs ? 'traffic-tab-create' : undefined} className={viewMode === 'create' ? 'h-full min-h-0 overflow-hidden' : 'hidden'} aria-hidden={viewMode !== 'create'}>
                {weeklyTargetState.present ? <div className="h-full overflow-y-auto p-4">{weeklyTarget ? <><WeeklyContentProductionView key={JSON.stringify(weeklyTarget)} target={weeklyTarget}/><SocialContentOrderOperations key={weeklyTarget.contentTaskId} taskId={weeklyTarget.contentTaskId}/><button type="button" className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={()=>attachSocialContentNavigationState(weeklyTarget.contentTaskId,'smartAssets')}>打开该内容任务的当前制作工作区</button></> : <p role="alert">周任务生产目标与当前内容任务不一致，请返回原任务重新打开。</p>}</div> : <AiCreateStudio key={socialContentTaskId || studioCreateRequest?.requestId || 'general-studio'} onNavigate={navigateWithinSocialTask} onOpenCreationHome={onOpenCreationHome} onLaunchContentStudio={onLaunchContentStudio} onReturnToContentPlanning={onReturnToContentPlanning} onGoPublish={handleGoPublish} openProjectsSignal={openProjectsSignal} workflowContext={(workflowContextSignal !== undefined ? workflowContextSignal : workflowContext) || undefined} publishStorageScope={storageScope} socialContentTaskId={socialContentTaskId} studioCreateRequest={studioCreateRequest} />}
              </div>
            )}
            <AnimatePresence mode="wait">
              {viewMode === 'materials' ? (
                <motion.div key="materials" id="traffic-panel-materials" role={showModeTabs ? 'tabpanel' : undefined} aria-labelledby={showModeTabs ? 'traffic-tab-materials' : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
                  <InspirationDashboard
                    onScriptPanelOpen={onScriptPanelOpen}
                    onScriptPanelClose={onScriptPanelClose}
                    onNavigate={navigateWithinSocialTask}
                    onEnterWorkflow={handleEnterWorkflow}
                  />
                </motion.div>
              ) : viewMode === 'create' ? null : viewMode === 'publish' ? (
                <motion.div key="publish" id="traffic-panel-publish" role={showModeTabs ? 'tabpanel' : undefined} aria-labelledby={showModeTabs ? 'traffic-tab-publish' : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
                  {weeklyTargetState.present ? weeklyTarget ? <WeeklyPublishingWorkspace key={JSON.stringify(weeklyTarget)} target={weeklyTarget}/> : <p role="alert">周任务发布目标与当前内容任务不一致，请返回原任务重新打开。</p> : <PublishPanel onNavigate={onNavigate} draft={publishDraft} onReturnToPreview={handleReturnToPreview} workflowContext={workflowContext || undefined} storageScope={storageScope} />}
                </motion.div>
              ) : (
                <motion.div key="accounts" id="traffic-panel-accounts" role={showModeTabs ? 'tabpanel' : undefined} aria-labelledby={showModeTabs ? 'traffic-tab-accounts' : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
                  <AccountActivity />
                  <SocialAccountStrategies onNavigate={page => onNavigate?.(page)} />
                </motion.div>
              )}
            </AnimatePresence>
          </Suspense>
        </WorkspaceErrorBoundary>
      </main>
    </div>
  );
}
