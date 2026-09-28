import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import SocialAccountStrategies from './socialProgram/SocialAccountStrategies';
import type { SocialContentCreateRequest } from './socialContent/SocialContentWorkspace';
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  CheckCircle2,
  Film,
  Loader2,
  Copy,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { CalendarPost } from './publishing/CalendarPlanner';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';
import { authHeader } from '../lib/auth';
import {
  PUBLISH_STATUS_META,
  PUBLISH_QUEUE_STORAGE_KEY,
  browserVideoUrl,
  classifyDirectPublishResponse,
  createPublishItem,
  createPublishItems,
  dateTimeLocalValue,
  directPublishOutcome,
  mergePublishItems,
  nextScheduleValue,
  pendingDirectPublishAccountIds,
  publishItemId,
  publishSourceRequestFields,
  publishStorageKey,
  readStoredPublishDraft,
  readStoredPublishQueue,
  studioGenerationIsVerified,
  titleFromVideoPath,
  type CopyAuditRecord,
  type DeliveryMode,
  type DirectPublishResponse,
  type PlatformCopy,
  type PublishDraft,
  type PublishItemStatus,
  type PublishPlatform,
  type PublishQueueItem,
} from '../lib/publishQueueState';
export {
  PUBLISH_STATUS_META,
  classifyDirectPublishResponse,
  normalizeStoredPublishDraft,
  normalizeStoredPublishQueueItem,
  publishSourceRequestFields,
  publishStorageKey,
  studioGenerationIsVerified,
} from '../lib/publishQueueState';
import { useModalFocus } from '../hooks/useModalFocus';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { resolveInitialTrafficViewMode, resolveNavigationEventViewMode, resolveSignalViewMode, resolveWorkflowNavigationPage, type TrafficViewMode } from './trafficViewMode';
import { useSocialContentNavigation } from './socialContent/useSocialContentNavigation';
import { PAGE_REGISTRY } from '../pageRegistry';
import ContentLibrary from './ContentLibrary';
import { PageLoading, WorkspaceErrorBoundary } from './AppPageBoundary';

// 每个工作区都很重，按当前视图拆包，避免进入“内容创作”时同时解析灵感中心、
// 账号动态和发布日历。外层 App 的 Suspense 会提供统一加载态。
const InspirationDashboard = lazy(() => import('./InspirationDashboard'));
const AiCreateStudio = lazy(() => import('./AiCreateStudio'));
const AccountActivity = lazy(() => import('./AccountActivity'));
const CalendarPlanner = lazy(() => import('./publishing/CalendarPlanner').then(module => ({ default: module.CalendarPlanner })));

type ViewMode = TrafficViewMode;

export type DigitalEmployeeWorkflowContext = {
  runId: string;
  taskId: string;
  taskKey: string;
  entityId?: string;
  preview?: boolean;
};

const DIGITAL_EMPLOYEE_CONTEXT_TTL = 15 * 60 * 1000;

export function parseDigitalEmployeeWorkflowContext(
  raw: string,
  now = Date.now(),
): DigitalEmployeeWorkflowContext | null {
  try {
    const parsed = JSON.parse(raw) as {
      page?: string;
      runId?: string;
      taskId?: string;
      workflowRunId?: string;
      workflowTaskId?: string;
      issuedAt?: number;
      businessRef?: { taskKey?: string; preview?: boolean; entityId?: string };
    };
    const runId = String(parsed.workflowRunId || parsed.runId || '').trim();
    const taskId = String(parsed.workflowTaskId || parsed.taskId || '').trim();
    const preview = parsed.businessRef?.preview === true;
    if (
      parsed.page !== 'smartAssets' ||
      (!preview && (!runId || !taskId)) ||
      (preview && !String(parsed.businessRef?.taskKey || '').trim()) ||
      !Number.isFinite(parsed.issuedAt) ||
      now - Number(parsed.issuedAt) > DIGITAL_EMPLOYEE_CONTEXT_TTL
    ) return null;
    return {
      runId,
      taskId,
      taskKey: String(parsed.businessRef?.taskKey || ''),
      ...(parsed.businessRef?.entityId ? { entityId: parsed.businessRef.entityId } : {}),
      ...(preview ? { preview: true } : {}),
    };
  } catch {
    return null;
  }
}

export function consumeDigitalEmployeeWorkflowContext(): DigitalEmployeeWorkflowContext | null {
  try {
    const raw = sessionStorage.getItem('digitalEmployee.businessDeepLink');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { page?: string };
    if (parsed.page !== 'smartAssets') return null;
    sessionStorage.removeItem('digitalEmployee.businessDeepLink');
    return parseDigitalEmployeeWorkflowContext(raw);
  } catch {
    return null;
  }
}

type PublishAccount = {
  id: string;
  platform: PublishPlatform;
  title: string;
  handle?: string;
  status: 'connected' | 'error' | 'expired';
  avatarUrl?: string;
};

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  onNavigate?: (p: Page) => void;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onSessionRefresh?: () => void;
  initialView?: ViewMode;
  showModeTabs?: boolean;
  visibleModes?: ViewMode[];
  pageTitle?: string;
  openProjectsSignal?: number;
  /** Isolates browser-only draft/queue state between tenants on a shared browser. */
  storageScope?: string;
  workflowContextSignal?: DigitalEmployeeWorkflowContext | null;
  socialContentTaskId?: string | null;
  studioCreateRequest?: SocialContentCreateRequest | null;
}

const PLATFORM_META: Record<PublishPlatform, { label: string; color: string; format: string }> = {
  youtube: { label: 'YouTube', color: '#ff0000', format: 'Shorts / Video' },
  tiktok: { label: 'TikTok', color: '#111827', format: '9:16 短视频' },
  instagram: { label: 'Instagram', color: '#c13584', format: 'Reels' },
  facebook: { label: 'Facebook', color: '#1877f2', format: 'Reels / Page Video' },
};

const ALL_PUBLISH_PLATFORMS = Object.keys(PLATFORM_META) as PublishPlatform[];

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || '请求失败'), { statusCode: response.status });
  return data;
}

function platformBody(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (!copy) return fallback;
  if (platform === 'youtube') return copy.description || fallback;
  if (platform === 'facebook') return copy.text || fallback;
  return copy.caption || fallback;
}

function platformTitle(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (platform === 'youtube') return copy?.title || fallback;
  return fallback;
}

export default function TrafficPage({
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
}: Props) {
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
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);
  const [workflowContext, setWorkflowContext] = useState<DigitalEmployeeWorkflowContext | null>(consumeDigitalEmployeeWorkflowContext);
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
        summary: '当前在内容创作的发布阶段，适合检查授权账号、生成分平台文案包、确认首评和 WhatsApp 追踪链接。',
        suggestions: ['生成四个平台的差异化文案', '检查首评内容', '确认追踪链接', '排到建议时段发布'],
      },
      accounts: {
        summary: '当前在账号管理，适合查看账号表现，以及识别评论中的高意向商机。',
        suggestions: ['查看待回复高意向评论', '判断评论采购意图', '生成真人化回复', '复盘账号表现'],
      },
    };
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'traffic',
        label: showModeTabs ? `${pageTitle} · ${TRAFFIC_MODE_META[viewMode].label}阶段` : pageTitle,
        ...contextByMode[viewMode],
      },
    }));
  }, [pageTitle, showModeTabs, viewMode]);

  const handleEnterWorkflow = (payload: unknown) => {
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
        };
      };
      video?: {
        id?: string;
        title?: string;
        platform?: string;
        thumbnail?: string;
        sourceUrl?: string;
        videoUrl?: string;
        contentFormat?: string;
      };
    };
    if (kickoff.source === 'material_library' && kickoff.generatedVideo?.material) {
      const material = kickoff.generatedVideo.material;
      const materialUrl = String(material.url || kickoff.generatedVideo.url || '').trim();
      const previewUrl = String(material.poster || kickoff.generatedVideo.poster || materialUrl).trim();
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
              referenceContentType: material.poster || kickoff.generatedVideo.poster ? 'image' : material.type === 'video' ? 'video' : 'image',
            },
          },
        },
      }));
      return;
    }
    if (kickoff.source === 'inspiration_analysis' && kickoff.video?.contentFormat !== 'image') {
      const referenceUrl = kickoff.video?.sourceUrl || kickoff.video?.videoUrl || '';
      // The studio consumes the full verified reference payload on entry.
      // Keep it alongside the navigation prefill so the storyboard is not
      // reduced to a bare URL when the planning dialog is skipped.
      try { localStorage.setItem('ow_video_kickoff', JSON.stringify(payload)); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('lingshu:navigate', {
        detail: {
          page: 'smartAssets',
          view: 'create',
          contentCreationRequest: {
            requestId: Date.now(),
            themeId: 'product_value',
            mode: 'instant',
            creationPath: 'viral_replication',
            materialInput: referenceUrl ? 'limited' : 'none',
            managedMode: 'one_click_managed',
            prefill: {
              title: `${kickoff.video?.title || '灵感视频'} · 爆款裂变`,
              topic: kickoff.video?.title || '',
              productName: String(kickoff.productInfo || '').trim().slice(0, 160),
              referenceLinks: referenceUrl ? [referenceUrl] : [],
              platforms: kickoff.video?.platform ? [kickoff.video.platform] : undefined,
            },
            sourceContext: {
              originLabel: '来自灵感中心',
              referenceTitle: kickoff.video?.title || '已选参考视频',
              referenceThumbnail: kickoff.video?.thumbnail,
            },
          },
        },
      }));
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
              <div ref={studioRootRef} id="traffic-panel-create" role={showModeTabs ? 'tabpanel' : undefined} aria-labelledby={showModeTabs ? 'traffic-tab-create' : undefined} className={viewMode === 'create' ? 'h-full' : 'hidden'} aria-hidden={viewMode !== 'create'}>
                <AiCreateStudio key={socialContentTaskId || studioCreateRequest?.requestId || 'general-studio'} onNavigate={navigateWithinSocialTask} onGoPublish={handleGoPublish} openProjectsSignal={openProjectsSignal} workflowContext={(workflowContextSignal !== undefined ? workflowContextSignal : workflowContext) || undefined} publishStorageScope={storageScope} socialContentTaskId={socialContentTaskId} studioCreateRequest={studioCreateRequest} />
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
                  <SocialPublishPanel onNavigate={onNavigate} draft={publishDraft} onReturnToPreview={handleReturnToPreview} workflowContext={workflowContext || undefined} storageScope={storageScope} />
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

export function isPublishingCalendarNode(taskKey?: string): boolean {
  return taskKey === 'publishing_calendar' || taskKey === 'platform_publish';
}

function SocialPublishPanel({ onNavigate, draft, onReturnToPreview, workflowContext, storageScope }: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null; onReturnToPreview?: (projectId?: string) => void; workflowContext?: DigitalEmployeeWorkflowContext; storageScope?: string }) {
  const [workspaceTab, setWorkspaceTab] = useState<'schedule' | 'publish'>(() => isPublishingCalendarNode(workflowContext?.taskKey) ? 'schedule' : draft || readStoredPublishDraft(storageScope) ? 'publish' : 'schedule');
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [items, setItems] = useState<PublishQueueItem[]>(() => {
    // A direct Digital Employee handoff must not adopt an arbitrary draft left
    // in localStorage by an earlier manual session.
    const incomingDraft = draft || (workflowContext ? null : readStoredPublishDraft(storageScope));
    const incoming = createPublishItems(incomingDraft, [], workflowContext);
    const stored = readStoredPublishQueue(storageScope);
    // Inspecting schedules or receipts must not create a new publishing draft.
    if (isPublishingCalendarNode(workflowContext?.taskKey)) return stored;
    if (incomingDraft && incoming.length) return mergePublishItems(stored, incoming);
    if (workflowContext) return [createPublishItem(null, [], workflowContext), ...stored];
    return stored.length ? stored : [createPublishItem(null)];
  });
  const [activeItemId, setActiveItemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingVideos, setUploadingVideos] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false);
  const [systemLibraryOpen, setSystemLibraryOpen] = useState(false);
  const [adaptingTarget, setAdaptingTarget] = useState<'all' | PublishPlatform | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [contentEditorMode, setContentEditorMode] = useState<'common' | 'platform'>('common');
  const [pendingTargetAccountIds, setPendingTargetAccountIds] = useState<string[]>([]);
  const accountTargetsSeededRef = useRef(false);
  const pendingAccountTargetsSeededRef = useRef(false);
  const appliedDraftRef = useRef(JSON.stringify(draft || readStoredPublishDraft(storageScope) || {}));
  const materializedVideoPathsRef = useRef(new Set<string>());
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const publishSettingsRef = useRef<HTMLElement | null>(null);
  const publishConfirmationRef = useModalFocus<HTMLDivElement>({
    open: publishConfirmationOpen,
    onClose: () => setPublishConfirmationOpen(false),
  });
  const systemLibraryDialogRef = useModalFocus<HTMLDivElement>({
    open: systemLibraryOpen,
    onClose: () => setSystemLibraryOpen(false),
  });
  const handledWorkflowContextRef = useRef(
    workflowContext ? `${workflowContext.runId}:${workflowContext.taskId}` : '',
  );

  useEffect(() => {
    const key = workflowContext
      ? `${workflowContext.runId}:${workflowContext.taskId}`
      : '';
    if (!key || handledWorkflowContextRef.current === key) return;
    handledWorkflowContextRef.current = key;
    if (isPublishingCalendarNode(workflowContext?.taskKey)) {
      setWorkspaceTab('schedule');
      return;
    }
    const attributedItem = createPublishItem(null, [], workflowContext);
    setItems((current) => {
      const existing = current.find(
        (item) => item.workflowRunId === workflowContext!.runId
          && item.workflowTaskId === workflowContext!.taskId,
      );
      setActiveItemId(existing?.id || attributedItem.id);
      return existing ? current : [attributedItem, ...current];
    });
    setWorkspaceTab('publish');
    setNotice('已从数字员工执行中心进入；新内容将单独归属当前任务，原有队列不受影响。');
  }, [workflowContext]);

  const connectedAccounts = accounts.filter(account => account.status === 'connected' && account.platform !== 'tiktok');
  const activeItem = items.find(item => item.id === activeItemId) || items[0] || null;
  const activePreviewUrl = activeItem?.previewUrl || browserVideoUrl(activeItem?.videoPath);
  const activeCalendarPost = Boolean(activeItem?.calendarPostIds?.length);
  const pendingCalendarItems = items
    .filter(item => (
      ['ready', 'partial', 'failed'].includes(item.status) &&
      Boolean(item.videoPath.trim() || item.title.trim() || item.sourceProjectId || item.sourcePlatform)
    ))
    .map(item => ({
      id: item.id,
      title: item.title || titleFromVideoPath(item.videoPath),
      description: item.description,
      sourceProjectId: item.sourceProjectId,
      sourcePlatform: item.sourcePlatform,
      platforms: Array.from(new Set(
        connectedAccounts
          .filter(account => item.targetAccountIds.includes(account.id))
          .map(account => account.platform),
      )),
      deliveryMode: item.deliveryMode,
      scheduledAt: item.scheduledAt,
      status: item.status,
    }));
  const selectedTargetAccountIds = activeItem?.targetAccountIds ?? pendingTargetAccountIds;
  const selectedConnectedAccounts = connectedAccounts.filter(account => selectedTargetAccountIds.includes(account.id));
  const selectedPlatforms = Array.from(new Set(selectedConnectedAccounts.map(account => account.platform)));
  const visiblePlatforms = selectedPlatforms.length ? selectedPlatforms : ALL_PUBLISH_PLATFORMS;
  const connectedAccountIds = new Set(connectedAccounts.map(account => account.id));
  const totalAssignments = items.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );
  const publishableItems = items.filter(item => (
    item.selected &&
    item.deliveryMode !== 'flexible' &&
    (item.deliveryMode === 'now' || Boolean(item.scheduledAt)) &&
    item.videoPath.trim() &&
    item.title.trim() &&
    (!item.sourceProjectId || studioGenerationIsVerified(item)) &&
    item.targetAccountIds.some(id => connectedAccountIds.has(id)) &&
    ['ready', 'partial', 'failed'].includes(item.status)
  ));
  const immediateItems = publishableItems.filter(item => item.deliveryMode === 'now');
  const scheduledItems = publishableItems.filter(item => item.deliveryMode === 'schedule' && Boolean(item.scheduledAt));
  const flexibleItems = items.filter(item => item.selected && item.deliveryMode === 'flexible' && ['ready', 'partial', 'failed'].includes(item.status));
  const publishableAssignments = publishableItems.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );

  const updateItem = (id: string, patch: Partial<PublishQueueItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (item.status === 'provider_processing' && patch.status === 'draft') return item;
      const copyChanged = ['title', 'description', 'platformCopy', 'firstComment'].some(key => key in patch);
      return {
        ...item,
        ...(patch.status === 'draft' ? { deliveryResults: {}, completedTargets: 0 } : {}),
        ...(copyChanged ? { copyAudit: undefined } : {}),
        ...patch,
      };
    }));
  };

  useEffect(() => {
    try { localStorage.setItem(publishStorageKey(PUBLISH_QUEUE_STORAGE_KEY, storageScope), JSON.stringify(items)); } catch { /* storage unavailable */ }
  }, [items, storageScope]);

  const selectedQueueItems = items.filter(item => item.selected);
  const selectableQueueItems = items.filter(item => item.videoPath.trim());
  const allQueueItemsSelected = selectableQueueItems.length > 0 && selectableQueueItems.every(item => item.selected);
  const toggleAllQueueItems = () => {
    const selected = !allQueueItemsSelected;
    setItems(previous => previous.map(item => ({ ...item, selected: Boolean(item.videoPath.trim()) && selected })));
  };

  const setDeliveryMode = (mode: DeliveryMode) => {
    if (!activeItem) return;
    if (activeCalendarPost) {
      setNotice('日历里的内容会保留当前排期；如需改日期，可回到日历拖动未锁定的内容。');
      return;
    }
    updateItem(activeItem.id, {
      deliveryMode: mode,
      scheduledAt: mode === 'schedule' ? (activeItem.scheduledAt || nextScheduleValue()) : '',
      status: 'draft',
      error: undefined,
    });
  };

  const scheduleForCalendarDate = (date: Date) => {
    let scheduled = new Date(date);
    scheduled.setHours(20, 0, 0, 0);
    if (scheduled.getTime() <= Date.now()) {
      scheduled = new Date(Date.now() + 60 * 60_000);
      scheduled.setMinutes(scheduled.getMinutes() < 30 ? 30 : 0, 0, 0);
      if (scheduled.getMinutes() === 0) scheduled.setHours(scheduled.getHours() + 1);
    }
    const scheduledAt = dateTimeLocalValue(scheduled);
    if (activeItem) {
      updateItem(activeItem.id, { deliveryMode: 'schedule', scheduledAt, status: 'draft', error: undefined });
    } else {
      const next = {
        ...createPublishItem(null, connectedAccounts.map(account => account.id)),
        deliveryMode: 'schedule' as const,
        scheduledAt,
      };
      setItems([next]);
      setActiveItemId(next.id);
    }
    setNotice(`已把当前视频安排到 ${scheduled.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}，补齐素材后即可加入日历。`);
    window.setTimeout(() => publishSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const openPendingContent = (id: string) => {
    const item = items.find(candidate => candidate.id === id);
    if (!item) return;
    setActiveItemId(id);
    setWorkspaceTab('publish');
    setNotice(`已打开“${item.title || titleFromVideoPath(item.videoPath)}”，可以继续编辑或安排发布时间。`);
    window.setTimeout(() => document.getElementById('publishing-content-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const saveCurrentContent = async () => {
    if (!activeItem) return;
    if (activeItem.status === 'provider_processing') { setError('平台仍在处理这条发布，请等待最终回执后再创建新版本。'); return; }
    const targets = connectedAccounts.filter(account => activeItem.targetAccountIds.includes(account.id));
    if (!activeItem.videoPath.trim()) { setError('请先上传视频'); return; }
    if (!activeItem.title.trim()) { setError('请填写视频标题'); return; }
    if (!activeItem.description.trim()) { setError('请填写发布文案'); return; }
    if (activeItem.sourceProjectId && !studioGenerationIsVerified(activeItem)) {
      setError('当前 Studio 作品缺少已通过的 AI 来源、质量和可发布记录，请返回内容创作重新审核。');
      return;
    }
    if (activeItem.calendarPostIds?.length) {
      if (!targets.length) { setError('日历内容需要至少选择一个发布平台账号'); return; }
      const calendarPlatform = activeItem.sourcePlatform || selectedPlatforms[0];
      const platformTargets = calendarPlatform
        ? targets.filter(account => account.platform === calendarPlatform)
        : targets;
      const copy = calendarPlatform ? activeItem.platformCopy[calendarPlatform] : undefined;
      setSavingContent(true);
      setError('');
      try {
        await Promise.all(activeItem.calendarPostIds.map(postId => fetchJson(`/api/overseas/publishing/calendar/${postId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: calendarPlatform ? platformTitle(calendarPlatform, copy, activeItem.title.trim()) : activeItem.title.trim(),
            description: calendarPlatform ? platformBody(calendarPlatform, copy, activeItem.description.trim()) : activeItem.description.trim(),
            firstComment: copy?.firstComment || activeItem.firstComment,
            videoPath: activeItem.videoPath.trim(),
            targetAccountIds: platformTargets.map(account => account.id),
            targetAccountLabels: platformTargets.map(account => account.handle || account.title),
            trackWaLink: activeItem.trackWaLink,
            ...(activeItem.deliveryMode === 'flexible' && activeItem.scheduledAt
              ? { scheduledAt: new Date(activeItem.scheduledAt).toISOString() }
              : {}),
          }),
        })));
        updateItem(activeItem.id, {
          status: 'scheduled',
          error: undefined,
        });
        setCalendarRefreshKey(value => value + 1);
        setNotice(`“${activeItem.title.trim()}”的内容修改已保存，原排期保持不变。`);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '保存日历内容失败');
      } finally {
        setSavingContent(false);
      }
      return;
    }
    if (activeItem.deliveryMode === 'schedule') {
      const scheduledTime = Date.parse(activeItem.scheduledAt);
      if (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now()) {
        setError('请为定点排期选择一个未来时间');
        return;
      }
    }
    updateItem(activeItem.id, {
      status: 'ready',
      deliveryMode: activeItem.deliveryMode,
      scheduledAt: activeItem.deliveryMode === 'schedule' ? activeItem.scheduledAt : '',
      error: undefined,
    });
    setError('');
    setNotice(activeItem.deliveryMode === 'now'
      ? targets.length
        ? `“${activeItem.title.trim()}”已保存，可直接立即发布。`
        : `“${activeItem.title.trim()}”已保存到待发布内容；连接平台账号后即可发布。`
      : activeItem.deliveryMode === 'flexible'
        ? `“${activeItem.title.trim()}”已保存，拖入日历时再选择时间。`
        : `“${activeItem.title.trim()}”已保存，定点时间已经锁定。`);
    setWorkspaceTab('schedule');
    window.setTimeout(() => document.getElementById('publishing-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const schedulePendingContent = async (id: string, scheduledAt: Date): Promise<number> => {
    const item = items.find(candidate => candidate.id === id);
    if (!item || !['ready', 'partial', 'failed'].includes(item.status)) throw new Error('这条视频还没有保存到待发布内容');
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new Error('计划发布时间必须晚于当前时间');
    const targets = connectedAccounts.filter(account => item.targetAccountIds.includes(account.id));
    if (!targets.length) throw new Error('这条视频还没有选择可用的发布账号');

    const createdIds: string[] = [];
    const failures: string[] = [];
    for (const postId of item.calendarPostIds || []) {
      try { await fetchJson(`/api/overseas/publishing/calendar/${postId}`, { method: 'DELETE' }); } catch { /* stale placeholder */ }
    }
    const platforms = Array.from(new Set(targets.map(account => account.platform)));
    for (const platform of platforms) {
      const platformAccounts = targets.filter(account => account.platform === platform);
      const copy = item.platformCopy[platform];
      try {
        const result = await fetchJson<{ item: CalendarPost }>('/api/overseas/publishing/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduledAt: scheduledAt.toISOString(),
            platform,
            title: platformTitle(platform, copy, item.title.trim()),
            description: platformBody(platform, copy, item.description.trim()),
            contentId: item.sourceProjectId,
            firstComment: copy?.firstComment || item.firstComment,
            videoPath: item.videoPath.trim(),
            targetAccountIds: platformAccounts.map(account => account.id),
            targetAccountLabels: platformAccounts.map(account => account.handle || account.title),
            trackWaLink: item.trackWaLink,
            scheduleLocked: item.deliveryMode === 'schedule',
            workflowRunId: item.workflowRunId || '',
            workflowTaskId: item.workflowTaskId || '',
            workflowTaskKey: item.workflowTaskKey || '',
          }),
        });
        createdIds.push(result.item.id);
      } catch (scheduleError) {
        failures.push(`${PLATFORM_META[platform].label}：${scheduleError instanceof Error ? scheduleError.message : '排期失败'}`);
      }
    }
    updateItem(item.id, {
      deliveryMode: item.deliveryMode,
      scheduledAt: dateTimeLocalValue(scheduledAt),
      status: failures.length ? (createdIds.length ? 'partial' : 'ready') : 'scheduled',
      calendarPostIds: createdIds.length ? createdIds : undefined,
      completedTargets: failures.length ? createdIds.length : targets.length,
      error: failures.length ? failures.join('；') : undefined,
    });
    setCalendarRefreshKey(value => value + 1);
    if (failures.length) throw new Error(failures.join('；'));
    setNotice(`“${item.title}”已安排到 ${scheduledAt.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}。`);
    return createdIds.length;
  };

  const openCalendarPost = (post: CalendarPost) => {
    if (post.status === 'awaiting_reapproval') {
      setError('这条内容或排期已经变更，原审批已失效；请返回智能经营重新发起审批。');
      setWorkspaceTab('schedule');
      return;
    }
    if (post.platformPostId || post.status === 'published') {
      setError('这条内容已经发布，不能再次提交平台');
      setWorkspaceTab('publish');
      return;
    }
    if (post.status === 'publishing') {
      setError('这条内容正在提交平台，请等待发布结果，避免重复发布');
      setWorkspaceTab('publish');
      return;
    }
    if (post.status === 'partial') {
      void fetchJson<{ item: CalendarPost }>(`/api/overseas/publishing/calendar/${post.id}/retry`, { method: 'POST' })
        .then(() => {
          setNotice(`“${post.title}”会仅重试尚未成功的账号，已发布账号不会重复提交。`);
          setCalendarRefreshKey(value => value + 1);
        })
        .catch(retryError => setError(retryError instanceof Error ? retryError.message : '重试发布失败'));
      setWorkspaceTab('publish');
      return;
    }
    const fallbackTargetIds = connectedAccounts
      .filter(account => account.platform === post.platform)
      .map(account => account.id);
    const targetAccountIds = (post.targetAccountIds || []).filter(id => connectedAccountIds.has(id));
    const patch: Partial<PublishQueueItem> = {
      videoPath: post.videoPath || '',
      previewUrl: post.videoPreviewUrl || post.videoUrl || browserVideoUrl(post.videoPath),
      title: post.title,
      description: post.description || '',
      sourcePlatform: post.platform in PLATFORM_META ? post.platform as PublishPlatform : undefined,
      workflowRunId: post.workflowRunId,
      workflowTaskId: post.workflowTaskId,
      workflowTaskKey: post.workflowTaskKey,
      targetAccountIds: targetAccountIds.length ? targetAccountIds : fallbackTargetIds,
      firstComment: post.firstComment || '',
      trackWaLink: post.trackWaLink !== false,
      deliveryMode: post.scheduleLocked ? 'schedule' : 'flexible',
      scheduledAt: dateTimeLocalValue(new Date(post.publishedAt)),
      calendarPostIds: [post.id],
      status: 'draft',
      completedTargets: 0,
      error: undefined,
    };
    const existing = items.find(item => item.calendarPostIds?.includes(post.id));
    if (existing) {
      updateItem(existing.id, patch);
      setActiveItemId(existing.id);
    } else {
      const next = { ...createPublishItem(null), ...patch } as PublishQueueItem;
      setItems(previous => [...previous, next]);
      setActiveItemId(next.id);
    }
    setNotice(post.scheduleLocked
      ? `已打开“${post.title}”，内容可以修改，定点发布时间保持锁定。`
      : `已打开“${post.title}”，内容可以修改，时间仍可在日历中调整。`);
    setWorkspaceTab('publish');
    window.setTimeout(() => publishSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const [youtube, tiktok, instagram, facebook] = await Promise.all([
        fetchJson<{ items?: Array<{ id: string; channelTitle: string; status: PublishAccount['status']; thumbnailUrl?: string }> }>('/api/overseas/youtube/accounts'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=tiktok'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=instagram'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=facebook'),
      ]);
      const next: PublishAccount[] = [
        ...(youtube.items ?? []).map(account => ({ id: account.id, platform: 'youtube' as const, title: account.channelTitle, handle: account.channelTitle, status: account.status, avatarUrl: account.thumbnailUrl })),
        ...(tiktok.items ?? []).map(account => ({ id: account.id, platform: 'tiktok' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(instagram.items ?? []).map(account => ({ id: account.id, platform: 'instagram' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(facebook.items ?? []).map(account => ({ id: account.id, platform: 'facebook' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
      ];
      setAccounts(next);
      if (!pendingAccountTargetsSeededRef.current) {
        setPendingTargetAccountIds(next.filter(account => account.status === 'connected' && account.platform !== 'tiktok').map(account => account.id));
        pendingAccountTargetsSeededRef.current = true;
      }
      if (!accountTargetsSeededRef.current) {
        const connected = next.filter(account => account.status === 'connected' && account.platform !== 'tiktok');
        setItems(prev => prev.map(item => {
          if (item.targetAccountIds.length) return item;
          const matchingSource = item.sourcePlatform
            ? connected.filter(account => account.platform === item.sourcePlatform)
            : [];
          return {
            ...item,
            targetAccountIds: (matchingSource.length ? matchingSource : connected).map(account => account.id),
          };
        }));
        accountTargetsSeededRef.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取授权账号');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAccounts(); }, []);

  useEffect(() => {
    if (!draft) return;
    const fingerprint = JSON.stringify(draft);
    if (fingerprint === appliedDraftRef.current) return;
    const additions = createPublishItems(draft, connectedAccounts.map(account => account.id));
    setItems(prev => mergePublishItems(prev, additions));
    setActiveItemId(additions[0]?.id || '');
    setWorkspaceTab('publish');
    appliedDraftRef.current = fingerprint;
  }, [draft]);

  useEffect(() => {
    const pendingPaths = items
      .filter(item => item.videoPath.trim() && !item.previewUrl && !browserVideoUrl(item.videoPath))
      .map(item => item.videoPath.trim())
      .filter(videoPath => !materializedVideoPathsRef.current.has(videoPath));
    if (!pendingPaths.length) return;
    pendingPaths.forEach(videoPath => materializedVideoPathsRef.current.add(videoPath));
    void fetchJson<{ videos?: Array<{ sourcePath: string; videoPath?: string; previewUrl?: string; error?: string }> }>('/api/overseas/publishing/local-videos/import-rendered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPaths: pendingPaths }),
    }).then(result => {
      const imported = new Map((result.videos || []).map(video => [video.sourcePath, video]));
      setItems(previous => previous.map(item => {
        const video = imported.get(item.videoPath.trim());
        if (!video) return item;
        if (video.videoPath) return { ...item, sourceVideoPath: item.sourceVideoPath || item.videoPath, videoPath: video.videoPath, previewUrl: video.previewUrl, selected: true, error: undefined };
        return { ...item, videoPath: '', previewUrl: undefined, selected: false, error: '原成片文件已失效，请返回内容创作重新生成此版本。' };
      }));
    }).catch(importError => {
      pendingPaths.forEach(videoPath => materializedVideoPathsRef.current.delete(videoPath));
      setError(importError instanceof Error ? importError.message : '无法读取已生成成片');
    });
  }, [items]);

  const toggleAccount = (accountId: string) => {
    const next = new Set(selectedTargetAccountIds);
    const target = accounts.find(account => account.id === accountId);
    if (!target || target.status !== 'connected' || target.platform === 'tiktok') return;
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    if (activeItem) updateItem(activeItem.id, { targetAccountIds: Array.from(next), status: 'draft', error: undefined });
    else setPendingTargetAccountIds(Array.from(next));
  };

  const togglePlatform = (platform: PublishPlatform) => {
    const ids = connectedAccounts.filter(account => account.platform === platform).map(account => account.id);
    const next = new Set(selectedTargetAccountIds);
    const allSelected = ids.length > 0 && ids.every(id => next.has(id));
    ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
    if (activeItem) updateItem(activeItem.id, { targetAccountIds: Array.from(next), status: 'draft', error: undefined });
    else setPendingTargetAccountIds(Array.from(next));
  };

  const selectAllAccounts = () => {
    const ids = connectedAccounts.map(account => account.id);
    if (activeItem) updateItem(activeItem.id, { targetAccountIds: ids, status: 'draft', error: undefined });
    else setPendingTargetAccountIds(ids);
  };

  const applyContentToAll = () => {
    if (!activeItem) return;
    const lockedStatuses: PublishItemStatus[] = ['publishing', 'provider_processing', 'scheduled', 'published'];
    const targetIds = new Set(
      items
        .filter(item => item.id !== activeItem.id && !lockedStatuses.includes(item.status))
        .map(item => item.id),
    );
    if (!targetIds.size) return;

    setItems(previous => previous.map(item => targetIds.has(item.id) ? {
      ...item,
      title: activeItem.title,
      description: activeItem.description,
      platformCopy: Object.fromEntries(
        Object.entries(activeItem.platformCopy).map(([platform, copy]) => [platform, {
          ...copy,
          tags: copy.tags ? [...copy.tags] : undefined,
          hashtags: copy.hashtags ? [...copy.hashtags] : undefined,
        }]),
      ),
      firstComment: activeItem.firstComment,
      trackWaLink: activeItem.trackWaLink,
      status: 'draft',
      error: undefined,
    } : item));
    setNotice(`已把当前视频的发布内容同步到另外 ${targetIds.size} 条视频，视频文件、平台账号和发布时间保持不变。`);
  };

  const duplicatePublishItem = (item: PublishQueueItem) => {
    const next: PublishQueueItem = {
      ...item,
      id: publishItemId(),
      platformCopy: { ...item.platformCopy },
      targetAccountIds: [...item.targetAccountIds],
      calendarPostIds: undefined,
      status: 'draft',
      completedTargets: 0,
      error: undefined,
    };
    setItems(prev => [...prev, next]);
    setActiveItemId(next.id);
  };

  const removePublishItem = (id: string) => {
    setItems(prev => {
      if (prev.length === 1) {
        const replacement = createPublishItem(null, connectedAccounts.map(account => account.id), workflowContext);
        setActiveItemId(replacement.id);
        return [replacement];
      }
      const next = prev.filter(item => item.id !== id);
      if (activeItem?.id === id) setActiveItemId(next[0]?.id || '');
      return next;
    });
  };

  const addSelectedVideoFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter(file => /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name));
    if (!files.length) return;
    setUploadingVideos(true);
    setError('');
    setNotice('');
    const targetAccountIds = activeItem ? activeItem.targetAccountIds : pendingTargetAccountIds;
    const additions: PublishQueueItem[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const response = await fetch('/api/overseas/publishing/local-videos', {
          method: 'POST',
          headers: {
            ...authHeader(),
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
        const data = await response.json().catch(() => ({})) as { video?: { videoPath?: string; previewUrl?: string }; error?: string };
        if (!response.ok || !data.video?.videoPath) throw new Error(data.error || '视频接收失败');
        additions.push(createPublishItem({
          videoPath: data.video.videoPath,
          previewUrl: data.video.previewUrl,
          title: titleFromVideoPath(file.name),
          description: activeItem?.description || '',
          ratio: activeItem?.ratio,
          platform: activeItem?.sourcePlatform,
          workflowRunId: activeItem?.workflowRunId,
          workflowTaskId: activeItem?.workflowTaskId,
          workflowTaskKey: activeItem?.workflowTaskKey,
        }, targetAccountIds));
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError instanceof Error ? uploadError.message : '添加失败'}`);
      }
    }
    if (additions.length) {
      setItems(prev => {
        const onlyBlank = prev.length === 1 && !prev[0].videoPath.trim() && !prev[0].title.trim();
        return onlyBlank ? additions : [...prev, ...additions];
      });
      setActiveItemId(additions[0].id);
      setWorkspaceTab('publish');
      setNotice(`已加入 ${additions.length} 条视频，发布预览已启动。`);
      window.setTimeout(() => document.getElementById('publishing-video-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    }
    if (failures.length) setError(failures.join('；'));
    setUploadingVideos(false);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const addSystemFinishedVideo = (selectedDraft: PublishDraft) => {
    const targetAccountIds = activeItem ? activeItem.targetAccountIds : pendingTargetAccountIds;
    const additions = createPublishItems(selectedDraft, targetAccountIds);
    if (!additions.length) {
      setError('这条成片暂时无法加入发布，请返回内容制作确认成片状态。');
      return;
    }
    setItems(previous => {
      const onlyBlank = previous.length === 1 && !previous[0].videoPath.trim() && !previous[0].title.trim();
      return mergePublishItems(onlyBlank ? [] : previous, additions);
    });
    setActiveItemId(additions[0].id);
    setWorkspaceTab('publish');
    setSystemLibraryOpen(false);
    setError('');
    setNotice(`已从系统成片库加入 ${additions.length} 条视频。`);
    window.setTimeout(() => document.getElementById('publishing-video-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  };

  const adaptCopy = async (platform?: PublishPlatform) => {
    if (!activeItem || adaptingTarget) return;
    if (activeItem.status === 'provider_processing') {
      setError('平台仍在处理这条发布，请等待最终回执后再创建新版本。');
      return;
    }
    if (!activeItem.title.trim() && !activeItem.description.trim()) {
      setError('请先在“通用内容”中填写作品标题或发布配文');
      return;
    }
    const requestItem = activeItem;
    const platforms = platform ? [platform] : visiblePlatforms;
    const mode = platform ? 'regenerate' : 'generate';
    setAdaptingTarget(platform || 'all');
    setError('');
    setNotice('');
    try {
      const data = await fetchJson<{ ok: boolean; copy: Record<string, PlatformCopy>; source?: string; provenance?: string; qualityStatus?: string; publishable?: boolean; audit?: CopyAuditRecord }>('/api/overseas/publishing/adapt-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: requestItem.title,
          description: requestItem.description,
          platforms,
          language: 'English',
          mode,
          projectId: requestItem.sourceProjectId,
          currentCopy: Object.fromEntries(platforms.map(target => [target, requestItem.platformCopy[target] || {}])),
        }),
      });
      if (data.ok !== true || data.source !== 'ai' || data.provenance !== 'ai'
        || data.qualityStatus !== 'passed' || data.publishable !== true || !data.audit) {
        throw new Error('平台文案未返回可审计的 AI 事实校验结果，原内容已保留。');
      }
      const first = platforms[0];
      setItems(previous => previous.map(item => item.id === requestItem.id ? {
        ...item,
        platformCopy: { ...item.platformCopy, ...data.copy },
        firstComment: data.copy[first]?.firstComment || item.firstComment,
        copyAudit: data.audit,
        status: 'draft',
        error: undefined,
      } : item));
      setNotice(platform
        ? `${PLATFORM_META[platform].label} 已换成新版本。`
        : `已生成 ${platforms.map(target => PLATFORM_META[target].label).join('、')} 的差异化文案。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成平台文案失败');
    } finally {
      setAdaptingTarget(null);
    }
  };

  const requestPublishConfirmation = () => {
    if (!publishableItems.length) {
      setError('请至少配置一条含视频路径、标题和发布账号的视频');
      return;
    }
    setError('');
    setPublishConfirmationOpen(true);
  };

  const publishConfirmed = async () => {
    if (!publishableItems.length) {
      setPublishConfirmationOpen(false);
      setError('没有可发布的内容，请重新检查视频、标题和账号');
      return;
    }
    setPublishConfirmationOpen(false);
    setPublishing(true);
    setNotice('');
    setError('');
    let successfulTargets = 0;
    let processingTargets = 0;
    let scheduledTargets = 0;
    let failedTargets = 0;
    let skippedItems = 0;

    for (const item of items) {
      if (!item.selected) continue;
      if (item.status === 'published' || item.status === 'provider_processing' || item.status === 'scheduled') continue;
      if (item.deliveryMode === 'flexible') continue;
      const targets = connectedAccounts.filter(account => item.targetAccountIds.includes(account.id));
      if (!item.videoPath.trim() || !item.title.trim() || !targets.length) {
        skippedItems += 1;
        updateItem(item.id, {
          status: 'failed',
          completedTargets: 0,
          error: !item.videoPath.trim() ? '缺少视频路径' : !item.title.trim() ? '缺少标题' : '未选择可用账号',
        });
        continue;
      }
      if (item.deliveryMode === 'schedule') {
        const scheduledTime = Date.parse(item.scheduledAt);
        if (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now()) {
          skippedItems += 1;
          updateItem(item.id, {
            status: 'failed',
            completedTargets: 0,
            error: '请选择未来的排期时间',
          });
          continue;
        }
        updateItem(item.id, { status: 'publishing', completedTargets: 0, error: undefined });
        const itemFailures: string[] = [];
        const createdIds: string[] = [];
        for (const postId of item.calendarPostIds || []) {
          try {
            await fetchJson(`/api/overseas/publishing/calendar/${postId}`, { method: 'DELETE' });
          } catch {
            // The previous placeholder may already have been removed; creating the new plan can continue.
          }
        }
        const platforms = Array.from(new Set(targets.map(account => account.platform)));
        for (const platform of platforms) {
          const platformAccounts = targets.filter(account => account.platform === platform);
          const copy = item.platformCopy[platform];
          try {
            const result = await fetchJson<{ item: CalendarPost }>('/api/overseas/publishing/calendar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scheduledAt: new Date(scheduledTime).toISOString(),
                platform,
                title: platformTitle(platform, copy, item.title.trim()),
                description: platformBody(platform, copy, item.description.trim()),
                contentId: item.sourceProjectId,
                ...publishSourceRequestFields(item),
                firstComment: copy?.firstComment || item.firstComment,
                videoPath: item.videoPath.trim(),
                targetAccountIds: platformAccounts.map(account => account.id),
                targetAccountLabels: platformAccounts.map(account => account.handle || account.title),
                trackWaLink: item.trackWaLink,
                scheduleLocked: true,
                workflowRunId: item.workflowRunId || '',
                workflowTaskId: item.workflowTaskId || '',
                workflowTaskKey: item.workflowTaskKey || '',
              }),
            });
            createdIds.push(result.item.id);
            scheduledTargets += platformAccounts.length;
          } catch (scheduleError) {
            failedTargets += platformAccounts.length;
            itemFailures.push(`${PLATFORM_META[platform].label}: ${scheduleError instanceof Error ? scheduleError.message : '加入排期失败'}`);
          }
        }
        updateItem(item.id, {
          status: itemFailures.length ? (createdIds.length ? 'partial' : 'failed') : 'scheduled',
          calendarPostIds: createdIds.length ? createdIds : item.calendarPostIds,
          completedTargets: targets.length,
          error: itemFailures.length ? itemFailures.join('；') : undefined,
        });
        continue;
      }
      updateItem(item.id, { status: 'publishing', completedTargets: 0, error: undefined });
      const itemFailures: string[] = [];
      let itemSuccesses = 0;
      let itemProcessing = 0;
      const deliveryResults = { ...item.deliveryResults };
      const pendingAccountIds = new Set(pendingDirectPublishAccountIds(item, targets.map(account => account.id)));
      for (const account of targets.filter(account => pendingAccountIds.has(account.id))) {
        const meta = PLATFORM_META[account.platform];
        const copy = item.platformCopy[account.platform];
        try {
          const url = account.platform === 'youtube'
            ? `/api/overseas/youtube/accounts/${account.id}/upload`
            : `/api/overseas/social/accounts/${account.id}/upload`;
          const publishResult = await fetchJson<DirectPublishResponse>(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoPath: item.videoPath.trim(),
              title: platformTitle(account.platform, copy, item.title.trim()),
              description: platformBody(account.platform, copy, item.description.trim()),
              firstComment: copy?.firstComment || item.firstComment,
              trackWaLink: item.trackWaLink,
              privacyStatus: 'public',
              madeForKids: false,
              ...publishSourceRequestFields(item),
            }),
          });
          const delivery = classifyDirectPublishResponse(account.platform, publishResult);
          deliveryResults[account.id] = delivery;
          if (delivery.deliveryStatus === 'provider_accepted') {
            itemProcessing += 1;
            processingTargets += 1;
          } else if (item.sourceProjectId) {
            await fetch('/api/overseas/studio/publish-links', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeader() },
              body: JSON.stringify({
                projectId: item.sourceProjectId,
                accountId: account.id,
                platform: account.platform,
                title: item.title.trim(),
                publishResult,
                generationKind: item.generationKind,
                generationProvenance: item.generationProvenance,
                qualityStatus: item.qualityStatus,
                publishable: item.publishable,
                generationRecordId: item.generationRecordId,
              }),
            });
            itemSuccesses += 1;
            successfulTargets += 1;
          } else {
            itemSuccesses += 1;
            successfulTargets += 1;
          }
        } catch (e) {
          failedTargets += 1;
          const statusCode = Number((e as { statusCode?: unknown } | null)?.statusCode);
          const ambiguous = !statusCode || statusCode === 409 || statusCode >= 500;
          if (ambiguous) deliveryResults[account.id] = { platform: account.platform, deliveryStatus: 'unknown' };
          itemFailures.push(`${meta.label} · ${account.title}: ${e instanceof Error ? e.message : '发布失败'}${ambiguous ? '；结果不明，请先核对平台回执，禁止直接重发' : ''}`);
        }
        updateItem(item.id, {
          completedTargets: itemSuccesses + itemProcessing + itemFailures.length,
          deliveryResults,
        });
      }
      const outcome = directPublishOutcome(targets.map(account => account.id), deliveryResults, itemFailures.length);
      const hasUnknown = targets.some(account => deliveryResults[account.id]?.deliveryStatus === 'unknown');
      updateItem(item.id, {
        status: outcome.status,
        completedTargets: targets.length,
        deliveryResults,
        error: itemFailures.length ? itemFailures.join('；') : hasUnknown ? '存在结果不明的发布尝试，请先核对平台回执，禁止直接重发。' : undefined,
      });
      if (outcome.allPublished && item.calendarPostIds?.length) {
        await Promise.all(item.calendarPostIds.map(postId =>
          fetch(`/api/overseas/publishing/calendar/${postId}`, {
            method: 'DELETE',
            headers: authHeader(),
          }).catch(() => undefined),
        ));
      }
    }
    setPublishing(false);
    setCalendarRefreshKey(value => value + 1);
    if (failedTargets || skippedItems) setError(`${failedTargets} 个发布目标失败，${skippedItems} 条视频配置不完整；可在队列中查看并修改。`);
    const notices: string[] = [];
    if (successfulTargets) notices.push(`已确认 ${successfulTargets} 个账号完成发布，每条发布均生成独立追踪码。`);
    if (processingTargets) notices.push(`${processingTargets} 个账号已由平台受理，正在处理；收到最终公开视频回执前不会标记为已发布。`);
    if (scheduledTargets) notices.push(`已将 ${scheduledTargets} 个账号任务加入内容日历；系统会在用户已确认的设定时间提交到已选账号。`);
    if (notices.length) setNotice(notices.join(' '));
  };

  const previewRatio = activeItem?.ratio || (selectedPlatforms.length > 0 && selectedPlatforms.every(platform => platform === 'youtube') ? '16:9' : '9:16');

  return (
    <div className="px-6 pb-5 pt-3">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex justify-center">
          <div role="group" aria-label="发布工作区" className="flex w-full max-w-xl justify-center gap-8 border-b border-border">
            <button
              type="button"
              onClick={() => setWorkspaceTab('schedule')}
              aria-pressed={workspaceTab === 'schedule'}
              className={`h-11 border-b-2 px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${workspaceTab === 'schedule' ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}
            >
              内容日历
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceTab('publish')}
              aria-pressed={workspaceTab === 'publish'}
              className={`h-11 border-b-2 px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${workspaceTab === 'publish' ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}
            >
              新建发布
            </button>
          </div>
        </div>

        {workspaceTab === 'schedule' ? (
        <section id="publishing-calendar" className="scroll-mt-5 rounded-2xl border border-border bg-surface/60 p-3 shadow-sm">
          <CalendarPlanner
            refreshKey={calendarRefreshKey}
            onCreate={scheduleForCalendarDate}
            onOpenPost={openCalendarPost}
            pendingItems={pendingCalendarItems}
            onOpenPending={openPendingContent}
            onSchedulePending={schedulePendingContent}
          />
        </section>
        ) : (
        <>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4">
        <section data-lingshu-guide="publishing-workbench" className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm ring-1 ring-emerald-50">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">发布队列</h3>
                <p className="mt-1 text-xs text-text-muted">所有产出版本 {items.length} 条 · 已选 {selectedQueueItems.length} 条 · {totalAssignments} 个发布目标</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo"
                  multiple
                  className="hidden"
                  onChange={event => void addSelectedVideoFiles(event.target.files)}
                />
                <button type="button" onClick={() => videoInputRef.current?.click()} disabled={uploadingVideos} className="inline-flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-bold text-white disabled:opacity-50">
                  {uploadingVideos ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploadingVideos ? '上传中' : '上传'}
                </button>
                <button type="button" onClick={() => setSystemLibraryOpen(true)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent-glow px-3 text-xs font-bold text-accent hover:border-accent">
                  <Film size={13} />选择系统成片
                </button>
                <button
                  type="button"
                  onClick={applyContentToAll}
                  disabled={!activeItem || items.every(item => item.id === activeItem.id || ['publishing', 'provider_processing', 'scheduled', 'published'].includes(item.status))}
                  title="复制当前视频的标题、发布配文、分平台文案、首评和询盘追踪设置；不会覆盖视频文件、平台账号和发布时间"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent-glow px-3 text-xs font-bold text-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Copy size={13} /> 应用到全部视频
                </button>
                <button type="button" onClick={toggleAllQueueItems} className="inline-flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">
                  <CheckCircle2 size={13} />
                  {allQueueItemsSelected ? '取消全选' : '全选'}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item, index) => {
                const active = item.id === activeItem?.id;
                const status = PUBLISH_STATUS_META[item.status];
                const hasVideo = Boolean(item.videoPath.trim());
                const targetCount = item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length;
                return (
                  <div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 transition-colors ${active ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={event => updateItem(item.id, { selected: event.target.checked })}
                      disabled={!hasVideo}
                      aria-label={`选择素材 ${item.title || index + 1}`}
                      className="h-4 w-4 flex-shrink-0 rounded border-border text-emerald-600"
                    />
                    <button type="button" onClick={() => setActiveItemId(item.id)} className="min-w-0 flex-1 px-1.5 py-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-text-muted">{String(index + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">{item.title || titleFromVideoPath(item.videoPath) || '待填写视频'}</span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${hasVideo ? status.className : 'bg-amber-50 text-amber-700'}`}>{hasVideo ? status.label : '未生成成片'}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-muted">
                        {item.videoPath || '请返回内容创作生成该版本成片'} · {targetCount} 个账号 · {item.deliveryMode === 'now' ? '立即发布' : item.deliveryMode === 'flexible' ? '时间待定' : item.scheduledAt ? `定点 ${new Date(item.scheduledAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '待选定点时间'}
                      </p>
                      {item.error && <p className="mt-1 truncate text-[11px] font-semibold text-red-600" title={item.error}>{item.error}</p>}
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button type="button" onClick={() => duplicatePublishItem(item)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary" title="复制配置"><Copy size={12} /></button>
                      <button type="button" onClick={() => removePublishItem(item.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-red-50 hover:text-red-600" title="删除视频"><Trash2 size={12} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>

        <section data-lingshu-guide="publish-accounts" className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">平台账号选择</h3>
                <p className="mt-1 text-xs text-text-muted">当前视频已选择 {selectedConnectedAccounts.length} 个账号，覆盖 {selectedPlatforms.length} 个平台</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PLATFORM_META).map(([platform, meta]) => {
                  const platformAccounts = connectedAccounts.filter(account => account.platform === platform);
                  const selected = platformAccounts.length > 0 && platformAccounts.every(account => selectedTargetAccountIds.includes(account.id));
                  return (
                    <button key={platform} type="button" disabled={!platformAccounts.length} onClick={() => togglePlatform(platform as PublishPlatform)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40 ${selected ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}>
                      <SocialPlatformIcon platform={platform} size={15} /> {platformAccounts.length}
                    </button>
                  );
                })}
                <button type="button" onClick={selectAllAccounts} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary">全选</button>
              </div>
            </div>

          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {loading ? (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-10 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin" /> 正在读取已授权账号...
              </div>
            ) : accounts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center">
                <p className="text-sm font-bold text-text-primary">还没有已连接账号</p>
                <p className="mt-1 text-xs text-text-muted">请先进入集成中心完成 YouTube / TikTok / Instagram / Facebook 授权。</p>
              </div>
            ) : accounts.map(account => {
              const meta = PLATFORM_META[account.platform];
              const directPostUnavailable = account.platform === 'tiktok';
              const active = !directPostUnavailable && selectedTargetAccountIds.includes(account.id);
              return (
                <button key={account.id} type="button" onClick={() => toggleAccount(account.id)} disabled={account.status !== 'connected' || directPostUnavailable} className={`rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55 ${active ? 'border-accent bg-accent-glow shadow-sm' : 'border-border bg-surface hover:border-border-bright'}`}>
                  <div className="flex items-center justify-between gap-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt={account.title} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: meta.color }}>
                        <SocialPlatformIcon platform={account.platform} size={20} />
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${account.status === 'connected' && !directPostUnavailable ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-text-muted'}`}>
                      {directPostUnavailable ? '直发审核中' : account.status === 'connected' ? '已连接' : '需重新授权'}
                    </span>
                  </div>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-text-primary"><SocialPlatformIcon platform={account.platform} size={16} /> {meta.label}</p>
                  <p className="mt-1 truncate text-xs font-semibold text-text-secondary">{account.handle || account.title}</p>
                  <p className="mt-2 text-xs text-text-muted">{meta.format}</p>
                </button>
              );
            })}
          </div>
        </section>

            <section id="publishing-content-editor" className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">发布内容编辑</h3>
                  <p className="mt-1 text-xs text-text-muted">统一编辑通用内容，或切换到各平台的差异化文案。</p>
                </div>
                <div className="inline-grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
                  <button type="button" onClick={() => setContentEditorMode('common')} className={`h-8 rounded-lg px-4 text-xs font-black transition ${contentEditorMode === 'common' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                    通用内容
                  </button>
                  <button type="button" onClick={() => setContentEditorMode('platform')} className={`h-8 rounded-lg px-4 text-xs font-black transition ${contentEditorMode === 'platform' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                    分平台内容
                  </button>
                </div>
              </div>
              {contentEditorMode === 'common' && (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">素材文件</span>
                  <input value={activeItem?.videoPath || ''} onChange={event => activeItem && updateItem(activeItem.id, { videoPath: event.target.value, status: 'draft', error: undefined })} placeholder="/Users/.../rendered-video.mp4" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">作品标题</span>
                  <input value={activeItem?.title || ''} onChange={event => activeItem && updateItem(activeItem.id, { title: event.target.value, status: 'draft', error: undefined })} placeholder="发布标题" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">发布配文</span>
                  <textarea value={activeItem?.description || ''} onChange={event => activeItem && updateItem(activeItem.id, { description: event.target.value, status: 'draft', error: undefined })} rows={3} placeholder="输入卖点、脚本摘要和 hashtag" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={activeItem?.trackWaLink ?? true} onChange={event => activeItem && updateItem(activeItem.id, { trackWaLink: event.target.checked, status: 'draft' })} className="mt-1 h-4 w-4 rounded border-border text-accent" />
                    <span>
                      <span className="flex items-center gap-1.5 text-xs font-black text-emerald-900"><SocialPlatformIcon platform="whatsapp" size={15} /> 已附带 WhatsApp 询盘链接</span>
                      <span className="mt-1 block text-[11px] leading-5 text-emerald-800">发布时自动生成短追踪码。买家首条消息带码后，客户来源会精确归因到这条内容。</span>
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-[11px] text-text-muted">
                    {activeCalendarPost
                      ? '保存只更新内容，日历中的发布时间和锁定状态保持不变。'
                      : '保存后进入待发布内容；立即发布、时间待定和定点排期互不混用。'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveCurrentContent()}
                    disabled={savingContent || !activeItem || activeItem.status === 'publishing' || activeItem.status === 'provider_processing' || activeItem.status === 'scheduled' || activeItem.status === 'published'}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {savingContent ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {savingContent
                      ? '正在保存...'
                      : activeCalendarPost
                        ? activeItem?.status === 'ready' ? '日历修改已保存' : '保存日历修改'
                      : activeItem?.status === 'ready' ? '已保存到待发布内容' : '保存并加入待发布内容'}
                  </button>
                  {error && <p role="status" className="w-full text-right text-[11px] font-semibold text-red-600">{error}</p>}
                </div>
              </div>
              )}

              {contentEditorMode === 'platform' && (
              <div className="mt-4 border-t border-border pt-4">
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-text-muted">
                  {selectedPlatforms.length
                    ? `将按已选账号生成 ${visiblePlatforms.length} 个平台版本。`
                    : '尚未连接账号，也可以先生成四个平台版本；连接账号后直接使用。'}
                </p>
                <button type="button" onClick={() => void adaptCopy()} disabled={Boolean(adaptingTarget) || !activeItem} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {adaptingTarget === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  {adaptingTarget === 'all' ? '正在生成' : '一键生成'}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {visiblePlatforms.map(platform => {
                  const meta = PLATFORM_META[platform];
                  const copy = activeItem?.platformCopy[platform];
                  const body = platformBody(platform, copy, activeItem?.description || '');
                  return (
                    <div key={platform} className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-black text-text-primary"><SocialPlatformIcon platform={platform} size={16} /> {meta.label}</span>
                        <button
                          type="button"
                          onClick={() => void adaptCopy(platform)}
                          disabled={Boolean(adaptingTarget) || !activeItem}
                          aria-label={`为 ${meta.label} 换一版文案`}
                          className="inline-flex min-w-[64px] items-center justify-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {adaptingTarget === platform && <Loader2 size={11} className="animate-spin" />}
                          {adaptingTarget === platform ? '生成中' : '换一版'}
                        </button>
                      </div>
                      {platform === 'youtube' && (
                        <input value={platformTitle(platform, copy, activeItem?.title || '')} onChange={event => activeItem && updateItem(activeItem.id, { platformCopy: { ...activeItem.platformCopy, [platform]: { ...activeItem.platformCopy[platform], title: event.target.value } }, status: 'draft', error: undefined })} className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      )}
                      <textarea value={body} onChange={event => activeItem && updateItem(activeItem.id, { platformCopy: { ...activeItem.platformCopy, [platform]: { ...activeItem.platformCopy[platform], ...(platform === 'facebook' ? { text: event.target.value } : platform === 'youtube' ? { description: event.target.value } : { caption: event.target.value }) } }, status: 'draft', error: undefined })} rows={4} className="mt-3 w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
                        <span>{body.length} 字符</span>
                        <span>{platform === 'tiktok' && body.length > 120 ? '超出建议长度' : '长度正常'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
              )}
            </section>
          </section>

          <aside ref={publishSettingsRef} className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-text-primary">发布设置</h3>
              <button
                type="button"
                onClick={() => onReturnToPreview?.(activeItem?.sourceProjectId || draft?.sourceProjectId || readStoredPublishDraft(storageScope)?.sourceProjectId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent"
              >
                <ChevronLeft size={12} /> 返回成片预览
              </button>
            </div>
            <div data-lingshu-guide="publish-mode" className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <p className="text-[11px] font-bold text-text-secondary">当前视频的发布方式</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryMode('now')}
                  disabled={activeCalendarPost}
                  className={`rounded-xl border px-3 py-2 text-xs font-black ${activeItem?.deliveryMode === 'now' ? 'border-accent bg-accent text-white' : 'border-border bg-white text-text-secondary'}`}
                >
                  立即发布
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMode('flexible')}
                  disabled={activeCalendarPost}
                  className={`rounded-xl border px-3 py-2 text-xs font-black ${activeItem?.deliveryMode === 'flexible' ? 'border-sky-500 bg-sky-600 text-white' : 'border-border bg-white text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  时间待定
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMode('schedule')}
                  disabled={activeCalendarPost}
                  className={`rounded-xl border px-3 py-2 text-xs font-black ${activeItem?.deliveryMode === 'schedule' ? 'border-violet-500 bg-violet-600 text-white' : 'border-border bg-white text-text-secondary'}`}
                >
                  定点排期
                </button>
              </div>
              {activeItem?.deliveryMode === 'schedule' && (
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">计划发布时间</span>
                  <input
                    type="datetime-local"
                    min={dateTimeLocalValue(new Date(Date.now() + 5 * 60_000))}
                    value={activeItem.scheduledAt}
                    disabled={activeCalendarPost}
                    onChange={event => updateItem(activeItem.id, { scheduledAt: event.target.value, status: 'draft', error: undefined })}
                    className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </label>
              )}
              <p className="mt-2 text-[10px] leading-4 text-text-muted">
                {activeCalendarPost
                  ? activeItem?.deliveryMode === 'schedule'
                    ? '这条内容使用定点排期，拖动不会改变锁定时间。'
                    : '这条内容已选好时间；可在日历拖到其他日期，时分保持不变。'
                  : activeItem?.deliveryMode === 'now'
                    ? '确认发布后立即提交平台，不进入日历。'
                    : activeItem?.deliveryMode === 'flexible'
                      ? '先保存到待发布内容，拖入日历时再选择具体时间。'
                      : '保存完整日期和时间，拖入日历后按这个唯一时间执行。'}
              </p>
            </div>
            <div id="publishing-video-preview" className="mt-4 scroll-mt-24 rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-primary">发布预览</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-accent shadow-sm">{previewRatio}</span>
              </div>
              <div className="flex justify-center">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-inner" style={{ aspectRatio: previewRatio === '16:9' ? '16 / 9' : '9 / 16', maxWidth: previewRatio === '16:9' ? 260 : 150 }}>
                  {activePreviewUrl ? (
                    <video
                      key={activePreviewUrl}
                      src={activePreviewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-white/70">
                      <PlayCircle size={22} />
                      <span className="mt-2 text-[10px] font-bold">上传视频后自动预览</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">首条评论</span>
              <textarea value={activeItem?.firstComment || ''} onChange={event => activeItem && updateItem(activeItem.id, { firstComment: event.target.value, status: 'draft' })} rows={3} placeholder="hashtags、wa.me 链接或补充说明。平台不支持时会记录 warning。" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-accent" />
            </label>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                <ShieldCheck size={14} />
                发布前检查
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-green-800">
                <li>队列：{items.length} 条视频，{immediateItems.length} 条立即发布，{flexibleItems.length} 条时间待定，{scheduledItems.length} 条定点排期</li>
                <li>目标：{totalAssignments} 个账号任务，覆盖 {new Set(items.flatMap(item => connectedAccounts.filter(account => item.targetAccountIds.includes(account.id)).map(account => account.platform))).size} 个平台</li>
                <li>当前视频追踪链接：{activeItem?.trackWaLink ? '开启' : '关闭'}</li>
              </ul>
            </div>
            {accounts.some(account => account.platform === 'tiktok' && account.status === 'connected') && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-800">
                TikTok Direct Post 正式审核尚未完成，当前账号不会作为直发目标；请先生成和核对内容，待平台批准且完整发布设置上线后再由用户主动提交。
              </div>
            )}

            {notice && <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700"><CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></div>}
            {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}

            <button type="button" onClick={requestPublishConfirmation} disabled={publishing || loading || publishableItems.length === 0} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {publishing
                ? '正在提交已确认的发布任务...'
                  : `发布已确定时间的内容 · ${publishableItems.length} 条 / ${publishableAssignments} 个账号目标`}
            </button>
          </aside>
        </div>
        {publishConfirmationOpen && (
          <div ref={publishConfirmationRef} tabIndex={-1} className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="publish-confirmation-title">
            <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Send size={18} /></span>
                <div>
                  <h3 id="publish-confirmation-title" className="text-base font-black text-text-primary">确认发布这些内容？</h3>
                  <p className="mt-1 text-xs leading-5 text-text-muted">立即发布会直接调用已授权平台账号；定点排期会在锁定时间自动提交。时间待定内容需要先拖入日历选时，不会被误发布。</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><p className="text-[10px] font-bold text-emerald-700">立即真实发布</p><p className="mt-1 text-lg font-black text-emerald-900">{immediateItems.length} 条</p></div>
                <div className="rounded-xl border border-violet-100 bg-violet-50 p-3"><p className="text-[10px] font-bold text-violet-700">已确认定时提交</p><p className="mt-1 text-lg font-black text-violet-900">{scheduledItems.length} 条</p></div>
              </div>
              <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-[11px] leading-5 text-text-secondary">共 {publishableAssignments} 个账号目标。部分平台可能因审核、权限或素材规范拒绝发布，失败项会保留在队列中供修改后重试。</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" data-modal-initial-focus onClick={() => setPublishConfirmationOpen(false)} className="rounded-xl border border-border px-4 py-2.5 text-xs font-black text-text-secondary hover:bg-surface">返回检查</button>
                <button type="button" onClick={() => void publishConfirmed()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700"><CheckCircle2 size={14} /> 确认真实发布</button>
              </div>
            </div>
          </div>
        )}
        {systemLibraryOpen && (
          <div ref={systemLibraryDialogRef} tabIndex={-1} className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="选择系统生成成片" onClick={() => setSystemLibraryOpen(false)}>
            <div className="relative h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-ink shadow-2xl" onClick={event => event.stopPropagation()}>
              <button type="button" data-modal-initial-focus aria-label="关闭成片选择" title="关闭" onClick={() => setSystemLibraryOpen(false)} className="absolute right-5 top-5 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-text-muted shadow-sm hover:text-text-primary"><X size={17} /></button>
              <ContentLibrary onPublish={addSystemFinishedVideo} />
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
