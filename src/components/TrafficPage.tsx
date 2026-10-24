import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { useEffect, useRef, useState } from 'react';
import type { SocialContentCreateRequest } from './socialContent/SocialContentWorkspace';
import type { CalendarPost } from './publishing/CalendarPlanner';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';
import { authHeader } from '../lib/auth';
import {
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
  type DeliveryMode,
  type DirectPublishResponse,
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
import type { TrafficViewMode } from './trafficViewMode';
import TrafficWorkspacePage from './TrafficWorkspacePage';
import SocialPublishPanelView from './SocialPublishPanelView';
import { PLATFORM_META } from './publishing/publishPlatformMeta';
import { derivePublishPanelSelection } from './publishing/publishPanelSelection';
import { fetchPublishingJson as fetchJson, platformBody, platformTitle } from './publishing/publishRequest';
import { usePublishingAccounts } from './publishing/usePublishingAccounts';
import { usePublishingVideoUpload } from './publishing/usePublishingVideoUpload';
import { usePublishQueueRefresh } from './publishing/usePublishQueueRefresh';
import {
  consumeDigitalEmployeeWorkflowContext,
  contentCreationAspectRatio,
  type DigitalEmployeeWorkflowContext,
} from './trafficWorkflowContext';
export {
  consumeDigitalEmployeeWorkflowContext,
  parseDigitalEmployeeWorkflowContext,
} from './trafficWorkflowContext';
export type { DigitalEmployeeWorkflowContext } from './trafficWorkflowContext';

type ViewMode = TrafficViewMode;

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
  /** Mount the inspiration workspace inside the lightweight home scroll surface. */
  embeddedInspiration?: boolean;
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

function SocialPublishPanel(props: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null; onReturnToPreview?: (projectId?: string) => void; workflowContext?: DigitalEmployeeWorkflowContext; storageScope?: string }) {
  const controller = useSocialPublishPanelController(props);
  return <SocialPublishPanelView controller={controller} />;
}

export function useSocialPublishPanelController({ onNavigate, draft, onReturnToPreview, workflowContext, storageScope }: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null; onReturnToPreview?: (projectId?: string) => void; workflowContext?: DigitalEmployeeWorkflowContext; storageScope?: string }) {
  const [workspaceTab, setWorkspaceTab] = useState<'schedule' | 'publish'>(() => isPublishingCalendarNode(workflowContext?.taskKey) ? 'schedule' : draft || readStoredPublishDraft(storageScope) ? 'publish' : 'schedule');
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
  const [savingContent, setSavingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false);
  const [systemLibraryOpen, setSystemLibraryOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const { accounts, loading, pendingTargetAccountIds, setPendingTargetAccountIds, loadAccounts } = usePublishingAccounts(setItems, setError);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  usePublishQueueRefresh(storageScope, setItems);
  const appliedDraftRef = useRef(JSON.stringify(draft || readStoredPublishDraft(storageScope) || {}));
  const materializedVideoPathsRef = useRef(new Set<string>());
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

  const {
    connectedAccounts, activeItem, activePreviewUrl, activeCalendarPost, pendingCalendarItems,
    selectedTargetAccountIds, selectedConnectedAccounts, selectedPlatforms, visiblePlatforms,
    connectedAccountIds, totalAssignments, publishableItems, immediateItems, scheduledItems,
    flexibleItems, publishableAssignments,
  } = derivePublishPanelSelection(items, accounts, activeItemId, pendingTargetAccountIds);
  const { uploadingVideos, videoInputRef, addSelectedVideoFiles } = usePublishingVideoUpload({
    activeItem, pendingTargetAccountIds, setItems, setActiveItemId, setWorkspaceTab, setNotice, setError,
  });

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

  return {
    draft, onReturnToPreview, storageScope, videoInputRef, publishSettingsRef, connectedAccounts, activeItem,
    activePreviewUrl, activeCalendarPost, pendingCalendarItems, selectedTargetAccountIds, selectedConnectedAccounts, selectedPlatforms, visiblePlatforms,
    connectedAccountIds, totalAssignments, publishableItems, immediateItems, scheduledItems, flexibleItems, publishableAssignments,
    updateItem, selectedQueueItems, allQueueItemsSelected, toggleAllQueueItems, setDeliveryMode, scheduleForCalendarDate, openPendingContent,
    saveCurrentContent, schedulePendingContent, openCalendarPost, toggleAccount, togglePlatform, selectAllAccounts, applyContentToAll,
    duplicatePublishItem, removePublishItem, addSelectedVideoFiles, addSystemFinishedVideo, requestPublishConfirmation, publishConfirmed, previewRatio,
    setWorkspaceTab, setActiveItemId, setPublishConfirmationOpen, setSystemLibraryOpen, workspaceTab, accounts, items,
    loading, uploadingVideos, savingContent, publishing, publishConfirmationOpen, systemLibraryOpen, notice,
    error, calendarRefreshKey,
  };
}
