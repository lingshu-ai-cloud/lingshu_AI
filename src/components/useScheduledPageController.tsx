import { socialDiscoveryApi } from '../lib/socialDiscoveryApi';
import type { SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow';
import { useAgentProductionAction } from '../lib/agentProductionSession';
import { useState, useEffect, useRef } from 'react';
import type { AgentAction } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';
import { authHeader } from '../lib/auth';
import type { NextAction } from './scheduledTaskActions';
import { taskWorkspace } from './scheduledTaskWorkspaces';
import type { BusinessDynamicsPayload } from './ScheduledBusinessDynamicsWorkspace';
import { scheduledTaskExecutionState, safeAnalysisActionMessage } from './scheduledExecutionPresentation';
import {
  AGENT_GROUPS, CRON_PRESETS, TASK_TEMPLATES, TEMPLATE_GROUPS,
  normalizeCrawlerLimit, normalizedTemplateConfig, scheduleLabel,
  taskAgentGroup, templateSchedule, type AgentTaskGroup, type TaskTemplate,
} from './scheduledTaskTemplates';
import { CONTENT_ACTION_STORAGE, consumeSessionPrefill, type ScheduleActionPrefill } from '../lib/contentActionNavigation';
import { normalizeKeywordInput, type KeywordPlatform } from '../lib/keywordInput';
import {
  consumeScheduledWorkflowHandoff,
  peekScheduledWorkflowHandoff,
  type ScheduledTaskExecutionState,
} from '../lib/scheduledWorkflowHandoff';
import type { ScheduledTask, VideoAnalysisItem, VideoStatsPayload, SocialTaskTab } from './ScheduledPage';

export function useScheduledPageController(onAction?: AgentAction) {
  const [discoveryScope, setDiscoveryScope] = useState<SocialCrawlStrategy | null>(null);
  useEffect(() => {
    const refresh = () => { void socialDiscoveryApi.getScope().then(result => setDiscoveryScope(result.persisted ? result.scope : null)).catch(() => setDiscoveryScope(null)); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const agentProduction = useAgentProductionAction('scheduler');
  const [activeGroup, setActiveGroup] = useState<AgentTaskGroup>(() => {
    if (window.__agentProductionTarget || peekScheduledWorkflowHandoff()) return 'social';
    const saved = window.sessionStorage.getItem('scheduled.activeGroup');
    return saved === 'social' || saved === 'customer' || saved === 'conversion' ? saved : 'conversion';
  });
  const [socialTaskTab, setSocialTaskTab] = useState<SocialTaskTab>(() => (
    peekScheduledWorkflowHandoff()
      ? 'crawler'
      : window.sessionStorage.getItem('scheduled.socialTaskTab') === 'analysis' ? 'analysis' : 'crawler'
  ));
  const [showAdd, setShowAdd] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [customName, setCustomName] = useState('');
  const [taskKeywords, setTaskKeywords] = useState('foundation');
  const [confirmedKeywordSignature, setConfirmedKeywordSignature] = useState('');
  const [runAfterCreate, setRunAfterCreate] = useState(true);
  const [createError, setCreateError] = useState('');
  const [creatingTasks, setCreatingTasks] = useState(false);
  const runResult: Record<string, string> = {};
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultTaskId, setResultTaskId] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{ taskId: string; message: string; error: boolean } | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<{ taskId: string; message: string; error: boolean } | null>(null);
  const [videoStats, setVideoStats] = useState<VideoStatsPayload | null>(null);
  const [videoStatsLoading, setVideoStatsLoading] = useState(true);
  const [videoStatsError, setVideoStatsError] = useState('');
  const [analysisQueueOpen, setAnalysisQueueOpen] = useState(() => window.sessionStorage.getItem('scheduled.analysisQueueOpen') === 'true');
  const [analysisActionId, setAnalysisActionId] = useState<string | null>(null);
  const [analysisActionError, setAnalysisActionError] = useState('');
  const [businessDynamics, setBusinessDynamics] = useState<BusinessDynamicsPayload | null>(null);
  const [businessDynamicsLoading, setBusinessDynamicsLoading] = useState(true);
  const [businessDynamicsError, setBusinessDynamicsError] = useState('');
  const didAutoOpenDemoTask = useRef(false);
  const tasksRequestRef = useRef<AbortController | null>(null);
  const videoStatsRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const prefill = consumeSessionPrefill<ScheduleActionPrefill>(CONTENT_ACTION_STORAGE.schedule);
    if (!prefill) return;
    const inferredTemplateId = prefill.templateId
      || (prefill.platform ? `${prefill.platform}_video_keyword_crawl` : 'trend_report');
    const template = TASK_TEMPLATES.find(item => item.templateId === inferredTemplateId);
    if (!template) return;
    const schedule = templateSchedule(template);
    setActiveGroup(taskAgentGroup(template.taskType));
    setSocialTaskTab('crawler');
    setSelectedTemplateIds([template.templateId]);
    setCustomName(prefill.name || '');
    setTaskKeywords(prefill.keywords || String(template.config && 'keywords' in template.config ? template.config.keywords || 'foundation' : 'foundation'));
    setScheduleTime(prefill.time || schedule.time);
    setScheduleDays(prefill.days || schedule.days);
    setRunAfterCreate(prefill.runAfterCreate ?? true);
    setConfirmedKeywordSignature('');
    setCreateError('');
    setShowAdd(true);
  }, []);

  useEffect(() => {
    const focusSourceCollection = (entityId?: string) => {
      if (entityId) { setResultTaskId(entityId); setExpandedId(entityId); }
      setActiveGroup('social');
      setSocialTaskTab('crawler');
      setShowAdd(false);
      setWorkspaceMessage('已进入编导 Agent 的定时采集工作区。');
    };
    const handoff = consumeScheduledWorkflowHandoff();
    if (handoff) focusSourceCollection(handoff.entityId);

    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{
        page?: string;
        runId?: string;
        taskId?: string;
        businessRef?: { taskKey?: string; preview?: boolean; entityId?: string };
      }>).detail;
      if (
        detail?.page !== 'scheduled'
        || detail.businessRef?.taskKey !== 'scheduled_source_collection'
        || (!detail.businessRef?.preview && (!detail.runId || !detail.taskId))
      ) return;
      try { window.sessionStorage.removeItem('digitalEmployee.businessDeepLink'); } catch { /* optional handoff cache */ }
      focusSourceCollection(detail.businessRef?.entityId);
    };
    window.addEventListener('lingshu:navigate', onNavigate);
    return () => window.removeEventListener('lingshu:navigate', onNavigate);
  }, []);

  useEffect(() => {
    if (!agentProduction.active) return;
    const refresh = () => {
      void fetchTasks(false);
      const id = window.__agentProductionTarget?.link.businessRef.entityId;
      if (id) setExpandedId(id);
    };
    const id = window.__agentProductionTarget?.link.businessRef.entityId;
    if (id) setExpandedId(id);
    window.addEventListener('lingshu:agent-business-refresh', refresh);
    return () => window.removeEventListener('lingshu:agent-business-refresh', refresh);
  }, [agentProduction.active]);

  const closeResultPanel = () => {
    // 用户主动关闭后，本次页面生命周期内不再由演示引导自动拉起任务侧栏。
    didAutoOpenDemoTask.current = true;
    setResultTaskId(null);
    setWorkspaceMessage('');
  };


  useEffect(() => {
    void fetchTasks();
    void fetchVideoStats(true);
    void fetchBusinessDynamics();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchTasks(false);
      void fetchVideoStats(false);
    }, 5000);
    return () => {
      window.clearInterval(timer);
      const tasksController = tasksRequestRef.current;
      tasksRequestRef.current = null;
      tasksController?.abort();
      const videoStatsController = videoStatsRequestRef.current;
      videoStatsRequestRef.current = null;
      videoStatsController?.abort();
    };
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem('scheduled.activeGroup', activeGroup);
    window.sessionStorage.setItem('scheduled.socialTaskTab', socialTaskTab);
    window.sessionStorage.setItem('scheduled.analysisQueueOpen', String(analysisQueueOpen));
  }, [activeGroup, socialTaskTab, analysisQueueOpen]);

  useEffect(() => {
    if (resultTaskId) { didAutoOpenDemoTask.current = true; return; }
    if (didAutoOpenDemoTask.current) return;
    const progress = readDemoProgress();
    if (!progress.scheduler || progress.automation_workflow || resultTaskId || tasks.length === 0) return;
    didAutoOpenDemoTask.current = true;
    const taskInCurrentGroup = tasks.find(task => taskAgentGroup(task.taskType) === activeGroup);
    if (taskInCurrentGroup) setResultTaskId(taskInCurrentGroup.id);
  }, [activeGroup, resultTaskId, tasks]);

  async function fetchTasks(showLoading = true) {
    if (tasksRequestRef.current) return;
    const controller = new AbortController();
    tasksRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    if (showLoading) setLoading(true);
    try {
      const r = await fetch('/api/overseas/scheduler', { headers: authHeader(), signal: controller.signal });
      if (!r.ok) {
        setTasks([]);
        return;
      }
      setTasks(await r.json());
    } catch {
      // 保留最近一次成功结果；超时后下一轮仍可恢复。
    } finally {
      window.clearTimeout(timeout);
      if (tasksRequestRef.current === controller) {
        tasksRequestRef.current = null;
        if (showLoading) setLoading(false);
      }
    }
  }

  async function fetchVideoStats(showLoading = false) {
    if (videoStatsRequestRef.current) return;
    const controller = new AbortController();
    videoStatsRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    if (showLoading) setVideoStatsLoading(true);
    setVideoStatsError('');
    try {
      const r = await fetch('/api/overseas/scheduler/video-stats', { headers: authHeader(), signal: controller.signal });
      if (!r.ok) throw new Error(`生产状态加载失败（${r.status}）`);
      setVideoStats(await r.json());
    } catch (error) {
      // StrictMode and navigation deliberately abort stale requests; only real
      // transport failures should surface as a production-status warning.
      if (error instanceof Error && error.name === 'AbortError') return;
      // Keep the previous snapshot visible during backend hot reloads.
      setVideoStatsError(error instanceof Error ? error.message : '生产状态暂时不可用，将自动重试。');
    } finally {
      window.clearTimeout(timeout);
      if (videoStatsRequestRef.current === controller) {
        videoStatsRequestRef.current = null;
        if (showLoading) setVideoStatsLoading(false);
      }
    }
  }

  async function updateVideoAnalysis(item: VideoAnalysisItem, action: 'pause' | 'cancel' | 'resume' | 'reanalyze') {
    setAnalysisActionId(item.id);
    setAnalysisActionError('');
    try {
      const endpoint = action === 'reanalyze'
        ? `/api/overseas/videos/${item.id}/reanalyze`
        : `/api/overseas/videos/${item.id}/analysis-${action}`;
      const response = await fetch(
        endpoint,
        {
          method: action === 'reanalyze' ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: action === 'reanalyze' || action === 'resume'
            ? JSON.stringify({ analysisMode: item.analysisMode === 'exact' ? 'exact' : 'strategy' })
            : JSON.stringify({}),
        },
      );
      const payload = await response.json().catch(() => ({})) as { error?: string };
      const fallback = action === 'pause' ? '暂停分析失败，请稍后重试。'
        : action === 'cancel' ? '取消分析失败，请稍后重试。'
          : action === 'resume' ? '恢复分析失败，请稍后重试。'
            : '重新分析失败，请稍后重试。';
      if (!response.ok) throw new Error(safeAnalysisActionMessage(payload.error, fallback));
      await fetchVideoStats();
    } catch (error) {
      setAnalysisActionError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setAnalysisActionId(null);
    }
  }

  async function fetchBusinessDynamics(forceRefresh = false) {
    setBusinessDynamicsLoading(true);
    setBusinessDynamicsError('');
    try {
      const query = forceRefresh ? '?refresh=1' : '';
      const response = await fetch(`/api/overseas/scheduler/business-dynamics${query}`, { headers: authHeader() });
      const payload = await response.json().catch(() => null) as BusinessDynamicsPayload & { message?: string } | null;
      if (!response.ok || !payload) throw new Error(payload?.message || '经营动态暂时无法生成');
      setBusinessDynamics(payload);
    } catch (error) {
      setBusinessDynamicsError(error instanceof Error ? error.message : '经营动态暂时无法生成');
    } finally {
      setBusinessDynamicsLoading(false);
    }
  }

  async function createTask() {
    const selectedTemplates = TASK_TEMPLATES.filter(template => selectedTemplateIds.includes(template.templateId));
    if (!selectedTemplates.length || creatingTasks) return;
    const keywordTemplates = selectedTemplates.filter(template => template.taskType === 'image_post_crawl' || (template.taskType === 'video_keyword_crawl' && !discoveryScope));
    const reviews = keywordTemplates.map(template => {
      const platform = String(('config' in template ? template.config?.platforms : '') || 'youtube') as KeywordPlatform;
      return { template, platform, review: normalizeKeywordInput(taskKeywords, platform) };
    });
    const signature = reviews.map(({ platform, review }) => `${platform}:${review.serialized}`).join('|');
    if (reviews.some(({ review }) => review.items.length === 0) || (reviews.length > 0 && confirmedKeywordSignature !== signature)) {
      setCreateError('请先确认自动清洗后的关键词，再创建任务。');
      return;
    }
    const [hour = '8', minute = '0'] = scheduleTime.split(':');
    const cronExpr = `${Number(minute) || 0} ${Number(hour) || 0} * * ${scheduleDays.length ? scheduleDays.join(',') : '*'}`;
    setCreatingTasks(true);
    setCreateError('');
    try {
      const created: ScheduledTask[] = [];
      for (const template of selectedTemplates) {
        const templateConfig = normalizedTemplateConfig(template);
        const platform = String(templateConfig.platforms || 'youtube') as KeywordPlatform;
        const cleanedKeywords = normalizeKeywordInput(taskKeywords, platform).serialized;
        const saved = await createTaskFromTemplate(
          template,
          selectedTemplates.length === 1 ? customName : '',
          cronExpr,
          scheduleLabel(scheduleTime, scheduleDays),
          false,
          ['video_keyword_crawl', 'image_post_crawl'].includes(template.taskType)
            ? template.taskType === 'video_keyword_crawl' && discoveryScope ? { ...templateConfig, keywords: '', keywordSource: 'discovery_scope' } : { ...templateConfig, keywords: cleanedKeywords }
            : templateConfig,
        );
        created.push(saved);
      }
      if (runAfterCreate) {
        const crawlerTasks = created.filter(task => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType));
        const results = await Promise.all(crawlerTasks.map(async task => {
          const response = await fetch(`/api/overseas/scheduler/${task.id}/run`, { method: 'POST', headers: authHeader() });
          if (!response.ok) throw new Error(`${task.name} 启动失败`);
          return response.json();
        }));
        if (results.length) setWorkspaceMessage(`已创建 ${created.length} 个任务，并启动 ${results.length} 个爬虫任务。`);
      }
      await fetchTasks();
      await fetchVideoStats();
      setShowAdd(false);
      setSelectedTemplateIds([]);
      setCustomName('');
      setConfirmedKeywordSignature('');
      setScheduleOpen(false);
      if (created.length) setResultTaskId(created[created.length - 1].id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '任务创建或执行失败，请重试。');
    } finally {
      setCreatingTasks(false);
    }
  }

  async function createTaskFromTemplate(template: TaskTemplate, name = '', cronExpr = '', customLabel = '', refresh = true, config: Record<string, string> = normalizedTemplateConfig(template)): Promise<ScheduledTask> {
    const resolvedCronExpr = cronExpr || template.cronExpr;
    const body = {
      ...template,
      name: name || template.name,
      config,
      cronExpr: resolvedCronExpr,
      cronLabel: customLabel || CRON_PRESETS.find(p => p.expr === resolvedCronExpr)?.label || template.cronLabel,
    };
    const response = await fetch('/api/overseas/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('定时任务创建失败');
    const saved = await response.json() as ScheduledTask;
    completeDemoStep('scheduler');
    if (refresh) await fetchTasks();
    return saved;
  }

  async function toggleTask(id: string) {
    await fetch(`/api/overseas/scheduler/${id}/toggle`, { method: 'POST', headers: authHeader() });
    await fetchTasks();
  }

  async function deleteTask(id: string) {
    await fetch(`/api/overseas/scheduler/${id}`, { method: 'DELETE', headers: authHeader() });
    if (resultTaskId === id) setResultTaskId(null);
    await fetchTasks();
  }

  async function runTaskNow(id: string) {
    if (agentProduction.active) { await agentProduction.execute(); return; }
    setRunningId(id);
    setRunNotice({ taskId: id, message: '任务已提交，正在执行…', error: false });
    try {
      const response = await fetch(`/api/overseas/scheduler/${id}/run`, { method: 'POST', headers: authHeader() });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `执行失败（${response.status}）`);
      }
      const body = await response.json() as { result?: string; state?: ScheduledTaskExecutionState; lastRun?: string };
      const completedAt = body.lastRun || new Date().toISOString();
      const returnedState = body.state || scheduledTaskExecutionState({ lastResult: body.result });
      const workerOnline = videoStats ? Boolean(videoStats.stats?.fetchQueue?.ops?.workerActive) : undefined;
      const visibleState = returnedState === 'queued' && workerOnline === false ? 'worker_offline' : returnedState;
      setTasks(current => current.map(task => task.id === id ? {
        ...task,
        lastRun: completedAt,
        lastResult: body.result || task.lastResult || '任务执行完成',
        executionState: returnedState,
      } : task));
      await fetchVideoStats();
      const time = new Date(completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const message = visibleState === 'queued'
        ? `已入队（${time}），Worker 处理后将自动刷新。`
        : visibleState === 'worker_offline'
          ? `已入队，但 Worker 离线。请启动 Worker，队列会自动继续。`
          : visibleState === 'running'
            ? `执行中（${time}），页面每 5 秒自动刷新。`
            : visibleState === 'failed'
              ? `执行失败（${time}），请展开结果查看原因后重试。`
              : visibleState === 'no_data'
                ? `暂无符合条件的结果（${time}），请展开查看检索范围。`
                : visibleState === 'collected'
                  ? `已采集，视频分析在后台继续（${time}）。`
                  : visibleState === 'partial'
                    ? `部分成功（${time}），请展开查看未完成的平台和原因。`
                    : visibleState === 'succeeded'
                      ? `执行成功（${time}），结果已刷新。`
                      : `状态未知（${time}），请展开结果查看。`;
      setRunNotice({
        taskId: id,
        message,
        error: !['queued', 'running', 'no_data', 'collected', 'partial', 'succeeded'].includes(String(visibleState)),
      });
      window.setTimeout(() => { void fetchTasks(false); }, 800);
    } catch (error) {
      setRunNotice({ taskId: id, message: error instanceof Error ? error.message : '任务执行失败，请稍后重试。', error: true });
    } finally {
      setRunningId(null);
    }
  }

  async function updateCrawlerConfig(task: ScheduledTask, patch: Record<string, string>) {
    if (task.taskType !== 'video_keyword_crawl') return;
    const keywordPatchProvided = Object.prototype.hasOwnProperty.call(patch, 'keywords');
    const nextConfig = {
      ...task.config,
      ...patch,
      keywords: (patch.keywords ?? task.config.keywords ?? task.config.keyword ?? '').trim(),
      keywordSource: keywordPatchProvided
        ? (String(patch.keywords || '').trim() ? 'explicit' : 'business_profile')
        : (task.config.keywordSource || 'business_profile'),
      limit: normalizeCrawlerLimit(patch.limit ?? task.config.limit ?? '5'),
    };
    setTasks(prev => prev.map(item => item.id === task.id ? { ...item, config: nextConfig } : item));
    const res = await fetch(`/api/overseas/scheduler/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ config: nextConfig }),
    });
    if (!res.ok) {
      await fetchTasks();
      return;
    }
    const saved = await res.json() as ScheduledTask;
    setTasks(prev => prev.map(item => item.id === saved.id ? saved : item));
  }

  function selectGroup(group: AgentTaskGroup) {
    setActiveGroup(group);
    if (group !== 'social') setSocialTaskTab('crawler');
    if (group === 'conversion' && !businessDynamics && !businessDynamicsLoading) void fetchBusinessDynamics();
    setSelectedTemplateIds([]);
    setCustomName('');
    setTaskKeywords('foundation');
    setConfirmedKeywordSignature('');
    setCreateError('');
    setScheduleOpen(false);
    setResultTaskId(null);
    setWorkspaceMessage('');
  }

  function closeAddModal() {
    setShowAdd(false);
    setSelectedTemplateIds([]);
    setCustomName('');
    setTaskKeywords('foundation');
    setConfirmedKeywordSignature('');
    setCreateError('');
    setScheduleOpen(false);
  }

  function openAddModal() {
    setResultTaskId(null);
    setWorkspaceMessage('');
    setSelectedTemplateIds([]);
    setCustomName('');
    setTaskKeywords('foundation');
    setConfirmedKeywordSignature('');
    setCreateError('');
    setScheduleOpen(false);
    setShowAdd(true);
  }

  const filtered = tasks.filter(t => taskAgentGroup(t.taskType) === activeGroup);
  const activeGroupMeta = AGENT_GROUPS.find(group => group.id === activeGroup)!;
  const visibleTemplates = TASK_TEMPLATES.filter(t => taskAgentGroup(t.taskType) === activeGroup);
  const selectedTemplates = TASK_TEMPLATES.filter(template => selectedTemplateIds.includes(template.templateId));
  const selectedTemplate = selectedTemplates[0] ?? null;
  const keywordTemplates = selectedTemplates.filter(template => template.taskType === 'image_post_crawl' || (template.taskType === 'video_keyword_crawl' && !discoveryScope));
  const keywordReviews = [...new Set(keywordTemplates.map(template => String(('config' in template ? template.config?.platforms : '') || 'youtube') as KeywordPlatform))]
    .map(platform => ({ platform, review: normalizeKeywordInput(taskKeywords, platform) }));
  const keywordSignature = keywordReviews.map(({ platform, review }) => `${platform}:${review.serialized}`).join('|');
  const keywordReviewReady = keywordReviews.length === 0 || keywordReviews.every(({ review }) => review.items.length > 0);
  const keywordReviewConfirmed = keywordReviews.length === 0 || (keywordReviewReady && confirmedKeywordSignature === keywordSignature);
  const groupedTemplates = TEMPLATE_GROUPS
    .map(group => ({ ...group, templates: visibleTemplates.filter(template => (group.taskTypes as readonly string[]).includes(template.taskType)) }))
    .filter(group => group.templates.length > 0);
  const stats = videoStats?.stats;
  const crawl = stats?.crawl ?? {};
  const fetchQueue = stats?.fetchQueue ?? {};
  const analysisQueue = stats?.analysisQueue ?? {};
  const analysisStatusRows = [
    { label: 'AI 分析队列', value: analysisQueue.queued ?? 0, desc: '已入队 / 执行中' },
    { label: '待处理素材', value: analysisQueue.pendingRecords ?? 0, desc: '已入库但未完成分析' },
    { label: '生产可用素材', value: analysisQueue.analyzedRecords ?? 0, desc: '已通过逐镜生产校验' },
    { label: '策略分析素材', value: analysisQueue.strategyRecords ?? 0, desc: '仅供灵感浏览，未进入生产' },
    { label: '失败素材', value: analysisQueue.failedRecords ?? 0, desc: '需要重试或排查源文件' },
  ];
  const analysisStatusEntries = Object.entries(analysisQueue.byStatus ?? {});
  const analysisItems = analysisQueue.items ?? [];
  const providerWarnings = Object.entries(analysisQueue.providerStatus ?? {})
    .filter(([, status]) => status?.configured === false)
    .map(([providerName, status]) => ({ providerName, ...status }));
  const refinementItems = analysisQueue.refinementItems ?? [];
  const crawlTasks = (videoStats?.tasks ?? tasks).filter(t => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(t.taskType));
  const showTaskList = activeGroup !== 'social' || socialTaskTab === 'crawler';
  const formatTime = (value?: string) => value
    ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '暂无';
  const resultTask = tasks.find(task => task.id === resultTaskId) ?? null;
  const resultText = resultTask ? (runResult[resultTask.id] || resultTask.lastResult || '') : '';
  const templateForTask = (task: ScheduledTask) => TASK_TEMPLATES.find(t => {
    if (t.taskType !== task.taskType) return false;
    if (!['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType)) return true;
    return ('config' in t ? t.config?.platforms : '') === task.config.platforms;
  }) ?? null;
  const resultTemplate = resultTask ? templateForTask(resultTask) : null;

  const openDiscoveryScope = () => {
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration' } }));
  };

  const exportPdf = async (task: ScheduledTask) => {
    setExportingId(task.id);
    setExportNotice(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/overseas/scheduler/${task.id}/export-pdf`, {
        headers: authHeader(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        const message = body?.error === 'task_has_no_result'
          ? '任务执行完成后即可导出本周报告'
          : body?.error === 'not found'
            ? '当前任务已更新，请刷新页面后重试'
            : res.status >= 500
              ? '报告生成服务暂时不可用，请稍后重试'
              : `PDF 导出未完成（${res.status}）`;
        throw new Error(message);
      }
      const blob = await res.blob();
      if (!blob.size || !String(res.headers.get('content-type') || '').includes('application/pdf')) {
        throw new Error('服务器没有返回有效的 PDF 文件');
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${task.name}-任务报告.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Safari/WebKit may start reading the Blob after click() returns. Revoking
      // immediately can silently cancel the download, so release it later.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportNotice({ taskId: task.id, message: 'PDF 已生成，下载已开始', error: false });
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'PDF 生成超时，请稍后重试'
        : error instanceof Error ? error.message : 'PDF 导出失败，请稍后重试';
      setExportNotice({ taskId: task.id, message, error: true });
    } finally {
      window.clearTimeout(timeout);
      setExportingId(null);
    }
  };

  const goToAgent = (action: NextAction) => {
    setResultTaskId(null);
    onAction?.(action.agent, action.prompt);
    window.setTimeout(() => completeDemoStep('automation_workflow'), 600);
  };

  const resultWorkspace = resultTask ? taskWorkspace(resultTask) : null;


  return {
    discoveryScope, tasks, loading, agentProduction, activeGroup, socialTaskTab, setSocialTaskTab, showAdd,
    selectedTemplateIds, setSelectedTemplateIds, scheduleOpen, setScheduleOpen, scheduleTime, setScheduleTime, scheduleDays, setScheduleDays,
    customName, setCustomName, taskKeywords, setTaskKeywords, setConfirmedKeywordSignature, runAfterCreate, setRunAfterCreate, createError,
    setCreateError, creatingTasks, runResult, expandedId, setExpandedId, setResultTaskId, workspaceMessage, setWorkspaceMessage,
    exportingId, exportNotice, runningId, runNotice, videoStats, videoStatsLoading, videoStatsError, analysisQueueOpen,
    setAnalysisQueueOpen, analysisActionId, analysisActionError, closeResultPanel, fetchTasks, fetchVideoStats, updateVideoAnalysis, createTask,
    createTaskFromTemplate, fetchBusinessDynamics, businessDynamics, businessDynamicsLoading, businessDynamicsError,
    toggleTask, deleteTask, runTaskNow, updateCrawlerConfig, selectGroup, closeAddModal, openAddModal, filtered,
    activeGroupMeta, selectedTemplates, selectedTemplate, keywordTemplates, keywordReviews, keywordSignature, keywordReviewReady, keywordReviewConfirmed,
    groupedTemplates, stats, crawl, fetchQueue, analysisQueue, analysisStatusRows, analysisStatusEntries, analysisItems,
    providerWarnings, refinementItems, crawlTasks, showTaskList, formatTime, resultTask, resultText, templateForTask,
    resultTemplate, openDiscoveryScope, exportPdf, goToAgent, resultWorkspace,
  };
}
