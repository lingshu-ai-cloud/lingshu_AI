import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { lazy, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Input, Modal, Segmented, Tabs } from 'antd';
import { LsPageHeader } from './ui/LsPageHeader';
import type { SocialContentCreateRequest } from './socialContent/SocialContentWorkspace';
import {
  AlertCircle,
  ChevronLeft,
  CheckCircle2,
  Film,
  Loader2,
  Copy,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
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
import { SocialPlatformIcon } from './SocialPlatformIcon';
import type { TrafficViewMode } from './trafficViewMode';
import ContentLibrary from './ContentLibrary';
import TrafficWorkspacePage from './TrafficWorkspacePage';

const CalendarPlanner = lazy(() => import('./publishing/CalendarPlanner').then(module => ({ default: module.CalendarPlanner })));

type ViewMode = TrafficViewMode;

function contentCreationAspectRatio(aspectRatio?: number, width?: number, height?: number): '9:16' | '1:1' | '16:9' | undefined {
  const measured = Number(aspectRatio) > 0
    ? Number(aspectRatio)
    : Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 0;
  if (!Number.isFinite(measured) || measured <= 0) return undefined;
  if (measured > 1.12) return '16:9';
  if (measured < 0.89) return '9:16';
  return '1:1';
}

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

export interface Props {
  sourcePage: Page;
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
  onOpenCreationHome?: (openChooser?: boolean) => void;
  onLaunchContentStudio?: (request: SocialContentCreateRequest) => void;
  onReturnToContentPlanning?: (request: SocialContentCreateRequest) => void;
}

const PLATFORM_META: Record<PublishPlatform, { label: string; color: string; format: string }> = {
  youtube: { label: 'YouTube', color: '#ff0000', format: 'Shorts / Video' },
  tiktok: { label: 'TikTok', color: '#111827', format: '9:16 短视频' },
  instagram: { label: 'Instagram', color: '#c13584', format: 'Reels' },
  facebook: { label: 'Facebook', color: '#1877f2', format: 'Reels / Page Video' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', format: 'Feed Video' },
};

const ALL_PUBLISH_PLATFORMS = Object.keys(PLATFORM_META) as PublishPlatform[];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || '请求失败'), { statusCode: response.status });
  return data;
}

function platformBody(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (fallback.trim()) return fallback;
  if (!copy) return fallback;
  if (platform === 'youtube') return copy.description || fallback;
  if (platform === 'facebook' || platform === 'linkedin') return copy.text || fallback;
  return copy.caption || fallback;
}

function platformTitle(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (fallback.trim()) return fallback;
  if (platform === 'youtube') return copy?.title || fallback;
  return fallback;
}

export default function TrafficPage(props: Props) {
  return (
    <TrafficWorkspacePage
      {...props}
      PublishPanel={SocialPublishPanel}
      consumeWorkflowContext={consumeDigitalEmployeeWorkflowContext}
      contentCreationAspectRatio={contentCreationAspectRatio}
    />
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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [pendingTargetAccountIds, setPendingTargetAccountIds] = useState<string[]>([]);
  const accountTargetsSeededRef = useRef(false);
  const pendingAccountTargetsSeededRef = useRef(false);
  const appliedDraftRef = useRef(JSON.stringify(draft || readStoredPublishDraft(storageScope) || {}));
  const materializedVideoPathsRef = useRef(new Set<string>());
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const publishSettingsRef = useRef<HTMLElement | null>(null);
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
    window.setTimeout(() => publishSettingsRef.current?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 60);
  };

  const openPendingContent = (id: string) => {
    const item = items.find(candidate => candidate.id === id);
    if (!item) return;
    setActiveItemId(id);
    setWorkspaceTab('publish');
    setNotice(`已打开“${item.title || titleFromVideoPath(item.videoPath)}”，可以继续编辑或安排发布时间。`);
    window.setTimeout(() => document.getElementById('publishing-content-editor')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 60);
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
            ...publishSourceRequestFields(activeItem),
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
    window.setTimeout(() => document.getElementById('publishing-calendar')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' }), 80);
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
            ...publishSourceRequestFields(item),
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
      sourceProjectId: post.contentId,
      sourcePlatform: post.platform in PLATFORM_META ? post.platform as PublishPlatform : undefined,
      workflowRunId: post.workflowRunId,
      workflowTaskId: post.workflowTaskId,
      workflowTaskKey: post.workflowTaskKey,
      copyAudit: post.copyAudit,
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
    window.setTimeout(() => publishSettingsRef.current?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 60);
  };

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const [youtube, tiktok, instagram, facebook, linkedin] = await Promise.all([
        fetchJson<{ items?: Array<{ id: string; channelTitle: string; status: PublishAccount['status']; thumbnailUrl?: string }> }>('/api/overseas/youtube/accounts'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=tiktok'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=instagram'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=facebook'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=linkedin'),
      ]);
      const next: PublishAccount[] = [
        ...(youtube.items ?? []).map(account => ({ id: account.id, platform: 'youtube' as const, title: account.channelTitle, handle: account.channelTitle, status: account.status, avatarUrl: account.thumbnailUrl })),
        ...(tiktok.items ?? []).map(account => ({ id: account.id, platform: 'tiktok' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(instagram.items ?? []).map(account => ({ id: account.id, platform: 'instagram' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(facebook.items ?? []).map(account => ({ id: account.id, platform: 'facebook' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(linkedin.items ?? []).map(account => ({ id: account.id, platform: 'linkedin' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
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
      copyAudit: item.sourceProjectId === activeItem.sourceProjectId ? activeItem.copyAudit : undefined,
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
      window.setTimeout(() => document.getElementById('publishing-video-preview')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 80);
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
    window.setTimeout(() => document.getElementById('publishing-video-preview')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 80);
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
    <div className="px-4 pb-5 pt-3 sm:px-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <LsPageHeader title="内容发布" description="安排发布时间，确认平台账号，并跟进真实发布回执。"/>
        <Tabs aria-label="发布工作区" activeKey={workspaceTab} onChange={value => setWorkspaceTab(value as 'schedule' | 'publish')} items={[{ key: 'schedule', label: '内容日历' }, { key: 'publish', label: '新建发布' }]}/>

        {workspaceTab === 'schedule' ? (
        <section id="publishing-calendar" className="scroll-mt-5">
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
        <section data-lingshu-guide="publishing-workbench" className="rounded-lg border border-border bg-white p-4">
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
                <Button onClick={() => videoInputRef.current?.click()} loading={uploadingVideos} icon={<Upload size={14}/>}>上传视频</Button>
                <Button onClick={() => setSystemLibraryOpen(true)} icon={<Film size={14}/>}>选择系统成片</Button>
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
                  <p className="mt-1 text-xs text-text-muted">一份文案和 Tag 作为所有平台的发布原稿；平台只处理账号、媒体格式和发布时间。</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {visiblePlatforms.map(platform => <span key={platform} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-text-secondary"><SocialPlatformIcon platform={platform} size={12}/>{PLATFORM_META[platform].label}</span>)}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">素材文件</span>
                  <Input value={activeItem?.videoPath || ''} onChange={event => activeItem && updateItem(activeItem.id, { videoPath: event.target.value, status: 'draft', error: undefined })} placeholder="已上传或生成的视频文件" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">作品标题</span>
                  <Input value={activeItem?.title || ''} onChange={event => activeItem && updateItem(activeItem.id, { title: event.target.value, status: 'draft', error: undefined })} placeholder="发布标题" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">统一发布文案 + Tag</span>
                  <Input.TextArea value={activeItem?.description || ''} onChange={event => activeItem && updateItem(activeItem.id, { description: event.target.value, status: 'draft', error: undefined })} rows={5} placeholder="输入最终发布文案，并在末尾保留同一组 #Tag；所有平台原样使用" />
                  <span className="mt-1.5 block text-[11px] text-text-muted">只在内容计划中替换商品名、品牌名、企业名等已绑定事实；认证、价格、交期和功效不能自动替换。</span>
                </label>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox aria-label="附带 WhatsApp 询盘链接" checked={activeItem?.trackWaLink ?? true} onChange={event => activeItem && updateItem(activeItem.id, { trackWaLink: event.target.checked, status: 'draft' })} className="mt-1" />
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
                  <Button
                    type="primary"
                    onClick={() => void saveCurrentContent()}
                    disabled={savingContent || !activeItem || activeItem.status === 'publishing' || activeItem.status === 'provider_processing' || activeItem.status === 'scheduled' || activeItem.status === 'published'}
                    loading={savingContent}
                    icon={<CheckCircle2 size={14}/>}
                  >
                    {savingContent
                      ? '正在保存...'
                      : activeCalendarPost
                        ? activeItem?.status === 'ready' ? '日历修改已保存' : '保存日历修改'
                      : activeItem?.status === 'ready' ? '已保存到待发布内容' : '保存并加入待发布内容'}
                  </Button>
                  {error && <p role="status" className="w-full text-right text-[11px] font-semibold text-red-600">{error}</p>}
                </div>
              </div>
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
              <Segmented className="mt-2" block aria-label="发布方式" value={activeItem?.deliveryMode || 'flexible'} disabled={activeCalendarPost} onChange={value => setDeliveryMode(value as DeliveryMode)} options={[{ value: 'now', label: '立即发布' }, { value: 'flexible', label: '时间待定' }, { value: 'schedule', label: '定点排期' }]}/>
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

            <Button type="primary" block onClick={requestPublishConfirmation} disabled={loading || publishableItems.length === 0} loading={publishing} icon={<CheckCircle2 size={16}/>} className="mt-5" style={{ height: 'auto', minHeight: 40, whiteSpace: 'normal' }}>
              {publishing
                ? '正在提交已确认的发布任务...'
                  : `发布已确定时间的内容 · ${publishableItems.length} 条 / ${publishableAssignments} 个账号目标`}
            </Button>
          </aside>
        </div>
        <Modal title="确认发布这些内容？" open={publishConfirmationOpen} onCancel={() => setPublishConfirmationOpen(false)} onOk={() => void publishConfirmed()} confirmLoading={publishing} okText="确认真实发布" cancelText="返回检查" mask={{ closable: !publishing }} closable={!publishing} destroyOnHidden>
          <p className="text-sm leading-6 text-text-secondary">立即发布会直接调用已授权平台账号；定点排期会在锁定时间自动提交。时间待定内容需要先在日历选择时间。</p>
          <dl className="my-4 grid grid-cols-2 divide-x divide-border border-y border-border py-4"><div><dt className="text-xs text-text-secondary">立即真实发布</dt><dd className="mt-1 text-xl font-semibold">{immediateItems.length} 条</dd></div><div className="pl-4"><dt className="text-xs text-text-secondary">已确认定时提交</dt><dd className="mt-1 text-xl font-semibold">{scheduledItems.length} 条</dd></div></dl>
          <Alert type="info" showIcon title={`共 ${publishableAssignments} 个账号目标`} description="失败项会保留在队列中，可修改后重试；平台受理不等同于已公开发布。"/>
        </Modal>
        <Drawer title="选择系统生成成片" open={systemLibraryOpen} onClose={() => setSystemLibraryOpen(false)} size="large" destroyOnHidden styles={{ body: { padding: 0 } }}>
          <ContentLibrary onPublish={addSystemFinishedVideo} />
        </Drawer>
        </>
        )}
      </div>
    </div>
  );
}
