import { socialDiscoveryApi } from '../lib/socialDiscoveryApi';
import { discoveryKeywords } from '../../shared/socialDiscoveryKeywords';
import type { SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow';
import { useAgentProductionAction } from '../lib/agentProductionSession';
import { useState, useEffect, useRef } from 'react';
import { Button, Drawer, Modal, Segmented } from 'antd';
import LsPageHeader from './ui/LsPageHeader';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, AlertTriangle, BarChart3, ChevronDown, Clock, Download, DownloadCloud, Loader, Play, Plus, RefreshCw, Trash2, X, CheckCircle } from 'lucide-react';
import type { AgentAction } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { suggestedActions, type NextAction } from './scheduledTaskActions';
import { taskWorkspace } from './scheduledTaskWorkspaces';
import ScheduledBusinessDynamicsWorkspace, { type BusinessDynamicsPayload } from './ScheduledBusinessDynamicsWorkspace';
import {
  AGENT_GROUPS, CRAWLER_LIMIT_MAX, CRAWLER_LIMIT_MIN,
  CRON_PRESETS, TASK_TEMPLATES, TEMPLATE_GROUPS, WEEKDAYS,
  nextDirectorCheckLabel, normalizeCrawlerLimit, normalizedTemplateConfig,
  scheduleLabel, taskAgentGroup, templateSchedule,
  type AgentTaskGroup, type TaskTemplate,
} from './scheduledTaskTemplates';
import {
  CONTENT_ACTION_STORAGE,
  consumeSessionPrefill,
  type ScheduleActionPrefill,
} from '../lib/contentActionNavigation';
import { normalizeKeywordInput, type KeywordPlatform } from '../lib/keywordInput';
import { discoveryFailurePresentation } from '../lib/discoveryFailurePresentation';
import {
  consumeScheduledWorkflowHandoff,
  peekScheduledWorkflowHandoff,
  type ScheduledTaskExecutionState,
  type ScheduledWorkflowHandoff,
} from '../lib/scheduledWorkflowHandoff';
export { parseScheduledWorkflowHandoff } from '../lib/scheduledWorkflowHandoff';
export type { ScheduledTaskExecutionState, ScheduledWorkflowHandoff } from '../lib/scheduledWorkflowHandoff';

interface ScheduledTask {
  id: string;
  name: string;
  category: 'daily' | 'monitor' | 'report' | 'automation';
  taskType: string;
  cronExpr: string;
  cronLabel: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  executionState?: ScheduledTaskExecutionState;
  channelId?: string;
  config: Record<string, string>;
  createdAt: string;
}

interface VideoAnalysisItem {
  id: string;
  title: string;
  platform: string;
  thumbnailUrl?: string;
  duration?: number;
  status: 'analyzing' | 'analyzed' | 'strategy' | 'review' | 'failed' | 'paused' | 'cancelled';
  analysisMode?: string;
  updatedAt?: string;
  error?: string;
  statusReason?: string;
  recoveryAction?: string;
  failureCode?: 'gemini_missing' | 'qwen_timeout' | 'candidate_hidden' | 'source_unavailable' | 'downloader_missing' | 'analysis_failed' | 'none';
  provider?: 'Gemini' | 'Qwen' | 'AI';
  visibility?: 'visible' | 'hidden';
  productionReady?: boolean;
  productionBlockers?: string[];
}

interface VideoStatsPayload {
  tasks?: ScheduledTask[];
  stats?: {
    updatedAt?: string;
    crawl?: {
      total?: number;
      today?: number;
      last24h?: number;
      latestAt?: string;
      byPlatform?: Record<string, number>;
    };
    fetchQueue?: {
      queued?: number;
      byStatus?: Record<string, number>;
      ops?: {
        total?: number;
        workerActive?: boolean;
        workerEnabled?: boolean;
      };
    };
    analysisQueue?: {
      queued?: number;
      byStatus?: Record<string, number>;
      pendingRecords?: number;
      analyzedRecords?: number;
      strategyRecords?: number;
      failedRecords?: number;
      hiddenRecords?: number;
      providerStatus?: {
        gemini?: { configured?: boolean; reason?: string; recoveryAction?: string };
        qwen?: { configured?: boolean; reason?: string; recoveryAction?: string };
      };
      items?: VideoAnalysisItem[];
      refinementItems?: Array<{
        id: string;
        title: string;
        platform: string;
        thumbnailUrl?: string;
        duration?: number;
        status: string;
        analysisMode?: string;
        analysisQuality?: string;
        syncedAt: string;
        analyzedAt?: string;
      }>;
    };
  };
}

export function scheduledTaskExecutionState(
  task: Pick<ScheduledTask, 'lastResult' | 'executionState'>,
  options: { running?: boolean; workerOnline?: boolean } = {},
): ScheduledTaskExecutionState {
  if (options.running) return 'running';
  const text = String(task.lastResult || '').trim();
  const serverState = task.executionState;
  const queued = serverState === 'queued' || /\u6267\u884c\u72b6\u6001\uff1a\u5df2\u6392\u961f|\u6267\u884c\u72b6\u6001\uff1a\u5904\u7406\u4e2d|\u7b49\u5f85\s*(?:Mac\s*)?(?:\u672c\u5730\s*)?Worker/.test(text);
  if (queued && options.workerOnline === false) return 'worker_offline';
  if (serverState) return serverState;
  if (queued) return 'queued';
  if (/执行状态：部分成功/.test(text)) return 'partial';
  if (/执行状态：已采集，待分析/.test(text)) return 'collected';
  if (/执行状态：暂无结果/.test(text)) return 'no_data';
  if (/执行状态：执行失败/.test(text)) return 'failed';
  if (/\u6267\u884c\u72b6\u6001\uff1a(?:\u6267\u884c\u6210\u529f|\u90e8\u5206\u6210\u529f)|\u4efb\u52a1\u6267\u884c\u5b8c\u6210|\u91c7\u96c6\u5df2\u7ed3\u675f/.test(text)) return 'succeeded';
  if (/\u6267\u884c\u72b6\u6001\uff1a\u6267\u884c\u5931\u8d25|\u6267\u884c\u5931\u8d25[:\uff1a]|\u4efb\u52a1\u5747\u6267\u884c\u5931\u8d25/.test(text)) return 'failed';
  return 'idle';
}

const TASK_EXECUTION_META: Record<ScheduledTaskExecutionState, { label: string; style: string }> = {
  idle: { label: '待执行', style: 'bg-gray-100 text-gray-600' },
  queued: { label: '已入队', style: 'bg-amber-50 text-amber-700' },
  running: { label: '执行中', style: 'bg-blue-50 text-blue-700' },
  partial: { label: '部分成功', style: 'bg-amber-50 text-amber-700' },
  collected: { label: '已采集，待分析', style: 'bg-blue-50 text-blue-700' },
  no_data: { label: '暂无结果', style: 'bg-gray-100 text-gray-600' },
  succeeded: { label: '成功', style: 'bg-green-50 text-green-700' },
  failed: { label: '失败', style: 'bg-red-50 text-red-700' },
  worker_offline: { label: 'Worker 离线', style: 'bg-red-50 text-red-700' },
};

function safeAnalysisActionMessage(message: unknown, fallback: string): string {
  const text = String(message || '').trim();
  if (!text) return fallback;
  if (/404|not found|unable to download|download webpage|unsupported url/i.test(text)) return '源视频暂时无法获取，请确认链接有效后重试。';
  if (/429|quota|resource_exhausted|额度|余额/i.test(text)) return 'AI 分析额度暂时不足，请稍后重试。';
  if (/timeout|timed out|超时/i.test(text)) return '视频分析超时，请稍后重试。';
  if (/command failed|python3|yt_dlp|\/app\/|ffmpeg|bearer|api[_-]?key/i.test(text)) return fallback;
  return text.slice(0, 120);
}



type SocialTaskTab = 'crawler' | 'analysis';

export default function ScheduledPage({ onAction }: { onAction?: AgentAction }) {
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

  const renderAutomationTemplates = (group: AgentTaskGroup) => {
    const templates = TASK_TEMPLATES.filter(template => taskAgentGroup(template.taskType) === group);
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">可用自动化模板</p>
          <span className="text-xs text-gray-400">{templates.length} 个模板</span>
        </div>
        <div className="space-y-2">
          {templates.map(template => {
            const exists = tasks.some(task => templateForTask(task)?.templateId === template.templateId);
            return (
              <div key={template.templateId} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                <span className="text-xl">{template.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{template.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{template.desc}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-400"><Clock size={11} /> {template.cronLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={event => { event.preventDefault(); event.stopPropagation(); if (!exists) void createTaskFromTemplate(template); }}
                  disabled={exists}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${exists ? 'cursor-default bg-green-50 text-green-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  {exists ? '已创建' : '创建'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const groupWorkspace = (group: AgentTaskGroup) => {
    if (group === 'conversion') return (
      <ScheduledBusinessDynamicsWorkspace
        businessDynamics={businessDynamics}
        businessDynamicsLoading={businessDynamicsLoading}
        businessDynamicsError={businessDynamicsError}
        formatTime={formatTime}
        onRefresh={() => void fetchBusinessDynamics(true)}
        renderAutomationTemplates={renderAutomationTemplates}
      />
    );
    const cards = [
      { label: '客户分层', value: '60 天', desc: '识别沉默客户和复购机会' },
      { label: '唤醒触达', value: 'WhatsApp', desc: '生成老客唤醒文案与推品理由' },
      { label: '复购节奏', value: '每周', desc: '沉淀客户偏好和下一次跟进时间' },
    ];
    return (
      <div className="mb-6 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cards.map(card => (
            <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{card.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{card.desc}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.1fr]">
          {renderAutomationTemplates(group)}
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-gray-900">工作流预览</p>
            <div className="mt-3 space-y-3">
              {['筛选沉默客户', '匹配历史采购偏好', '生成触达话术和推品清单'].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-semibold text-green-700">{index + 1}</span>
                  <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2"><p className="text-xs font-medium text-gray-800">{step}</p></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-white" data-lingshu-guide="scheduled-tasks">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      {/* Left sidebar */}
      <div
        role="navigation"
        aria-label="Agent 任务板块"
        className="flex w-full shrink-0 overflow-x-auto border-b border-gray-100 px-3 py-2 md:w-64 md:flex-col md:overflow-x-visible md:border-b-0 md:border-r md:py-6"
      >
        <p className="mb-3 hidden px-3 text-xs font-medium text-gray-400 md:block">Agent 任务板块</p>
        {AGENT_GROUPS.map(group => (
          <button
            key={group.id}
            type="button"
            onClick={() => selectGroup(group.id)}
            className={`mr-1 min-w-40 shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors md:mr-0 md:mb-1 md:min-w-0 md:py-3 ${activeGroup === group.id ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className="block">{group.label}</span>
            <span className="block text-xs text-gray-400 mt-1">
              {tasks.filter(t => taskAgentGroup(t.taskType) === group.id).length} 个任务
            </span>
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-6 md:px-8 md:py-5">
          <LsPageHeader title="定时任务" description={activeGroupMeta.label} className="!mb-0 !border-0 !pb-0" extra={<Button type="primary" icon={<Plus size={16} />} data-demo-target={!showAdd && activeGroup === 'social' ? 'scheduled_run' : undefined} onClick={openAddModal}>新建任务</Button>} />
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">
          {activeGroup === 'social' && (
          <div className="mb-6 space-y-4">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <Segmented value={socialTaskTab} onChange={setSocialTaskTab} options={[{ value: 'crawler', label: '社媒爬虫定时任务' }, { value: 'analysis', label: '视频分析' }]} />
                <p className="text-xs text-gray-500 mt-2">
                  {socialTaskTab === 'crawler'
                    ? `${crawlTasks.length > 0 ? crawlTasks.map(task => `${task.name} · ${task.cronLabel}`).join(' / ') : '自动采集任务未创建'} · 更新时间 ${formatTime(stats?.updatedAt)}`
                    : `视频下载入库后的 Gemini 分析进度 · 更新时间 ${formatTime(stats?.updatedAt)}`}
                </p>
              </div>
              <Button
                onClick={() => { void fetchTasks(); void fetchVideoStats(true); }}
                loading={videoStatsLoading}
                icon={<RefreshCw size={14} />}
              >
                刷新
              </Button>
            </div>

            {videoStatsError && videoStats && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {videoStatsError}当前展示上一次成功快照，页面会继续自动刷新。
              </p>
            )}

            {videoStatsLoading && !videoStats ? (
              <div role="status" className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-500">
                <Loader size={16} className="animate-spin" /> 正在加载生产状态…
              </div>
            ) : videoStatsError && !videoStats ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                <p className="font-medium">生产状态暂时无法加载</p>
                <p className="mt-1 text-xs">{videoStatsError}页面会每 5 秒自动重试，也可手动点击刷新。</p>
              </div>
            ) : socialTaskTab === 'crawler' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <BarChart3 size={14} className="text-orange-500" />
                    视频爬取数据
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-2xl font-semibold text-gray-900">{crawl.today ?? 0}</span>
                    <span className="text-xs text-gray-500 pb-1">今日新增</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">24小时 {crawl.last24h ?? 0} 条 · 累计库内 {crawl.total ?? 0} 条 · 最新 {formatTime(crawl.latestAt)}</p>
                  <p className="text-xs text-gray-400 mt-1">累计来源：YT {crawl.byPlatform?.youtube ?? 0} / TK {crawl.byPlatform?.tiktok ?? 0} / IG {crawl.byPlatform?.instagram ?? 0} / FB {crawl.byPlatform?.facebook ?? 0}</p>
                </div>

                <div className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <DownloadCloud size={14} className="text-blue-500" />
                    获取视频排队数据
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-2xl font-semibold text-gray-900">{fetchQueue.queued ?? 0}</span>
                    <span className="text-xs text-gray-500 pb-1">已入队 / 执行中</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Ops 队列 {fetchQueue.ops?.total ?? 0} · {fetchQueue.ops?.workerActive
                      ? 'Worker 执行中'
                      : (fetchQueue.queued ?? 0) > 0
                        ? 'Worker 离线'
                        : fetchQueue.ops?.workerEnabled ? 'Worker 待命' : 'Worker 离线'}
                  </p>
                  {(fetchQueue.queued ?? 0) > 0 && !fetchQueue.ops?.workerActive && (
                    <p className="mt-2 text-[11px] text-red-600">请启动本地 Worker 或检查云端兜底；已入队任务不会丢失。</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {providerWarnings.map(warning => (
                  <div key={warning.providerName} role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <p className="font-semibold">{warning.reason || `${warning.providerName} 未配置`}</p>
                    {warning.recoveryAction && <p className="mt-1 text-[11px] leading-5 text-amber-700">人工恢复：{warning.recoveryAction}</p>}
                  </div>
                ))}
                <div className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Activity size={14} className="text-green-500" />
                    视频分析排队数据
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-2xl font-semibold text-gray-900">{analysisQueue.queued ?? 0}</span>
                    <span className="text-xs text-gray-500 pb-1">AI 分析队列</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">生产可用 {analysisQueue.analyzedRecords ?? 0} · 策略分析 {analysisQueue.strategyRecords ?? 0} · 待处理/复核 {analysisQueue.pendingRecords ?? 0} · 失败 {analysisQueue.failedRecords ?? 0}</p>
                </div>

                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <button
                    type="button"
                    aria-expanded={analysisQueueOpen}
                    aria-controls="video-analysis-queue-list"
                    onClick={() => setAnalysisQueueOpen(open => !open)}
                    className="mb-3 flex w-full items-center justify-between rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">视频分析队列</p>
                      <p className="text-xs text-gray-500 mt-0.5">点击展开，查看每条视频的分析状态与操作。</p>
                    </div>
                    <span className="flex items-center gap-2 text-xs text-gray-400">
                      {analysisItems.length} 条 · 自动刷新 5 秒
                      <ChevronDown size={16} className={`transition-transform ${analysisQueueOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {analysisStatusRows.map(row => (
                      <div key={row.label} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                        <p className="text-xs text-gray-500">{row.label}</p>
                        <p className="mt-2 text-xl font-semibold text-gray-900">{row.value}</p>
                        <p className="mt-1 text-[11px] text-gray-400">{row.desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                    <p className="text-xs font-medium text-gray-700">状态分布</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analysisStatusEntries.length > 0 ? analysisStatusEntries.map(([status, count]) => (
                        <span key={status} className="rounded-full bg-white px-2.5 py-1 text-xs text-gray-500 border border-gray-100">
                          {status}: {count}
                        </span>
                      )) : (
                        <span className="text-xs text-gray-400">暂无状态明细</span>
                      )}
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {analysisQueueOpen && (
                      <motion.div
                        id="video-analysis-queue-list"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto border-t border-gray-100 pt-3">
                          {analysisActionError && (
                            <div role="status" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                              {analysisActionError}
                            </div>
                          )}
                          {analysisItems.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 py-8 text-center text-xs text-gray-400">
                              暂无视频分析记录
                            </div>
                          ) : analysisItems.map(item => {
                            const statusMeta = item.status === 'analyzing'
                              ? { label: '分析中', style: 'bg-blue-50 text-blue-700' }
                              : item.status === 'analyzed'
                                ? { label: '已完成，可生产', style: 'bg-green-50 text-green-700' }
                                : item.status === 'strategy'
                                  ? { label: '策略分析已完成', style: 'bg-blue-50 text-blue-700' }
                                : item.status === 'review'
                                  ? { label: '分析完成，待生产复核', style: 'bg-amber-50 text-amber-700' }
                                : item.status === 'failed'
                                  ? { label: '分析失败', style: 'bg-red-50 text-red-700' }
                                  : item.status === 'cancelled'
                                    ? { label: '已取消', style: 'bg-gray-100 text-gray-600' }
                                    : { label: '已暂停', style: 'bg-amber-50 text-amber-700' };
                            const actionPending = analysisActionId === item.id;
                            return (
                              <article key={item.id} data-testid={`video-analysis-row-${item.id}`} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                                {item.thumbnailUrl ? (
                                  <img src={item.thumbnailUrl} alt={`${item.title} 缩略图`} className="h-14 w-24 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />
                                ) : (
                                  <div className="flex h-14 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300"><Play size={18} /></div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-semibold text-gray-900" title={item.title}>{item.title}</p>
                                  <p className="mt-1 text-[11px] text-gray-500">{item.platform.toUpperCase()} · {item.analysisMode === 'exact' ? '精确分析' : '策略分析'} · {item.duration ? `${Math.round(item.duration)} 秒` : '时长未知'}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                    {item.provider && <span className="rounded bg-white px-1.5 py-0.5 text-gray-500">{item.provider}</span>}
                                    <span className={`rounded px-1.5 py-0.5 ${item.visibility === 'hidden' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                                      {item.visibility === 'hidden' ? '候选暂未展示' : '可见'}
                                    </span>
                                  </div>
                                  {item.error && <p className="mt-1 text-[11px] leading-4 text-red-500">{item.error}</p>}
                                  {item.statusReason && <p className="mt-1 text-[11px] leading-4 text-amber-700">状态原因：{item.statusReason}</p>}
                                  {item.recoveryAction && <p className="mt-1 text-[11px] leading-4 text-gray-500">人工恢复：{item.recoveryAction}</p>}
                                  {item.status === 'review' && item.productionBlockers?.length ? (
                                    <p className="mt-1 text-[11px] leading-4 text-amber-700">尚未进入生产：{item.productionBlockers.join('；')}</p>
                                  ) : null}
                                </div>
                                <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusMeta.style}`}>{statusMeta.label}</span>
                                <div className="flex flex-shrink-0 items-center gap-2">
                                  {item.status === 'analyzing' && (
                                    <>
                                      <button
                                        type="button"
                                        aria-label={`暂停分析 ${item.title}`}
                                        disabled={actionPending}
                                        onClick={() => void updateVideoAnalysis(item, 'pause')}
                                        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                      >
                                        {actionPending ? '处理中…' : '暂停'}
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`取消分析 ${item.title}`}
                                        disabled={actionPending}
                                        onClick={() => void updateVideoAnalysis(item, 'cancel')}
                                        className="rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                                      >
                                        取消
                                      </button>
                                    </>
                                  )}
                                  {(item.status === 'paused' || item.status === 'failed' || item.status === 'cancelled') && (
                                    <button
                                      type="button"
                                      aria-label={`恢复分析 ${item.title}`}
                                      disabled={actionPending}
                                      onClick={() => void updateVideoAnalysis(item, item.status === 'failed' ? 'reanalyze' : 'resume')}
                                      className="rounded-lg border border-green-200 bg-white px-2.5 py-1.5 text-[11px] text-green-700 hover:bg-green-50 disabled:opacity-50"
                                    >
                                      {actionPending ? '提交中…' : item.status === 'failed' ? '重试' : '恢复'}
                                    </button>
                                  )}
                                  {item.status === 'paused' && (
                                    <button
                                      type="button"
                                      aria-label={`取消分析 ${item.title}`}
                                      disabled={actionPending}
                                      onClick={() => void updateVideoAnalysis(item, 'cancel')}
                                      className="rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      取消
                                    </button>
                                  )}
                                  {item.status === 'review' && (
                                    <button
                                      type="button"
                                      aria-label={`重新分析 ${item.title}`}
                                      disabled={actionPending}
                                      onClick={() => void updateVideoAnalysis(item, 'reanalyze')}
                                      className="rounded-lg border border-green-200 bg-white px-2.5 py-1.5 text-[11px] text-green-700 hover:bg-green-50 disabled:opacity-50"
                                    >
                                      {actionPending ? '提交中…' : '补全生产分析'}
                                    </button>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">精修视频同步</p>
                      <p className="text-xs text-gray-500 mt-0.5">从灵感大屏点击“AI一键爆款迭代”后自动进入此列表。</p>
                    </div>
                    <span className="text-xs text-gray-400">最近 {refinementItems.length} 条</span>
                  </div>
                  {refinementItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 py-8 text-center text-xs text-gray-400">
                      暂无已同步的精修视频
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {refinementItems.map(item => (
                        <article key={item.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt="" className="h-12 w-20 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />
                          ) : (
                            <div className="h-12 w-20 flex-shrink-0 rounded-lg bg-gray-100" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-gray-900">{item.title}</p>
                            <p className="mt-1 text-[11px] text-gray-500">{item.platform.toUpperCase()} · {item.analysisMode === 'exact' ? '全片精确分析' : '视频分析'} · {item.duration ? `${Math.round(item.duration)} 秒` : '时长未知'}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">待精修</span>
                            <p className="mt-1 text-[10px] text-gray-400">{formatTime(item.syncedAt)}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
          )}

          {activeGroup !== 'social' && !loading && groupWorkspace(activeGroup)}

          {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

          {!loading && showTaskList && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-gray-400">
              <Clock size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">还没有定时任务</p>
            </div>
          )}

          {!loading && showTaskList && filtered.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">{activeGroupMeta.label}</h2>
              <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map(task => {
                  const tmpl = templateForTask(task);
                  const isDirectorTask = task.taskType === 'social_discovery_collection';
                  const taskScope = isDirectorTask && discoveryScope && String(discoveryScope.approval?.scopeVersion) === task.config.discoveryScopeVersion
                    ? discoveryScope : null;
                  const result = runResult[task.id];
                  const resultDiagnosis = isDirectorTask ? discoveryFailurePresentation(result || task.lastResult) : null;
                  const isExpanded = expandedId === task.id;
                  const crawlerTask = ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType);
                  const executionState = scheduledTaskExecutionState(task, {
                    running: runningId === task.id,
                    workerOnline: crawlerTask && task.executionState === 'queued' && videoStats
                      ? Boolean(fetchQueue.ops?.workerActive)
                      : undefined,
                  });
                  const executionMeta = TASK_EXECUTION_META[executionState];
                  return (
                    <div key={task.id} className={`border rounded-xl p-4 min-h-[148px] h-full flex flex-col transition-all ${task.enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                      <div className="flex items-start gap-3">
                        <div className="text-2xl">{isDirectorTask ? '🎬' : tmpl?.icon ?? '⚙️'}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-900 truncate">{task.name}</p>
                            <button
                              type="button"
                              aria-label={`${task.enabled ? '停用' : '启用'}任务 ${task.name}`}
                              aria-pressed={task.enabled}
                              onClick={() => toggleTask(task.id)}
                              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ml-2 ${task.enabled ? 'bg-green-500' : 'bg-gray-200'}`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${task.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                            <Clock size={10} /> {task.cronLabel}
                          </p>
                          {isDirectorTask && <p className="mt-1 text-[11px] font-semibold text-emerald-700">编导 Agent 主采集 · 计划 v{task.config.discoveryScopeVersion || '待确认'}</p>}
                          {!isDirectorTask && crawlerTask && <p className="mt-1 text-[11px] text-gray-500">{task.config.keywordSource === 'discovery_scope' ? '独立专项任务 · 借用编导关键词，单独计数' : '独立专项采集 · 单独执行'}</p>}
                          <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${executionMeta.style}`}>
                            {executionMeta.label}
                          </span>
                          {task.lastRun && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              上次执行：{new Date(task.lastRun).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </div>

                      {isDirectorTask && (
                        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-2.5 text-[11px] text-gray-700">
                          <p>下次检查：{!task.enabled ? '已暂停' : task.cronExpr === '*/15 * * * *' ? `${nextDirectorCheckLabel()}（北京时间）` : task.cronLabel}；仅在编导计划到期时采集</p>
                          {taskScope ? <p className="mt-1">采集范围：近 {taskScope.discoveryBrief.lookbackDays} 天发布 · 滚动 7 天目标 {taskScope.discoveryBrief.resultLimit} 条合格视频 · {discoveryKeywords(taskScope).length} 个关键词</p> : <p className="mt-1">计划详情暂未加载；任务执行时读取已批准的范围。</p>}
                          {task.config.directorReviewRequired && <p className="mt-1 font-semibold text-amber-700">{task.config.directorReviewRequired}。当前任务仍按上一版已批准范围执行。</p>}
                          <button type="button" onClick={openDiscoveryScope} className="mt-1.5 font-semibold text-emerald-700 hover:underline">前往灵感大屏调整采集范围</button>
                        </div>
                      )}

                      {task.taskType === 'video_keyword_crawl' && (
                        <div className="mt-3">
                          <div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2">
                            <label className="block min-w-0">
                              <span className="block text-[10px] text-gray-400 mb-1">{discoveryScope ? `发现范围 · v${discoveryScope.keywordSet.version}` : '进阶覆盖词（可选）'}</span>
                              <input
                                key={discoveryScope?.version || 'legacy'}
                                readOnly={Boolean(discoveryScope)}
                                defaultValue={discoveryScope ? discoveryKeywords(discoveryScope).join('、') : task.config.keywords || task.config.keyword || ''}
                                onBlur={e => { if (!discoveryScope) void updateCrawlerConfig(task, { keywords: e.currentTarget.value }); }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 focus:outline-none focus:border-green-400"
                                placeholder="留空则使用当前发现范围"
                              />
                            </label>
                            <label className="block">
                              <span className="block text-[10px] text-gray-400 mb-1">目标数量</span>
                              <input
                                type="number"
                                min={CRAWLER_LIMIT_MIN}
                                max={CRAWLER_LIMIT_MAX}
                                defaultValue={task.config.limit || '5'}
                                onBlur={e => {
                                  const limit = normalizeCrawlerLimit(e.currentTarget.value);
                                  e.currentTarget.value = limit;
                                  void updateCrawlerConfig(task, { limit });
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 focus:outline-none focus:border-green-400"
                              />
                            </label>
                          </div>
                          <p className="mt-1.5 text-[10px] text-gray-400">单条任务最多爬取 {CRAWLER_LIMIT_MAX} 条视频</p>
                        </div>
                      )}

                      {/* Last result */}
                      {(result || task.lastResult) && isExpanded && (
                        <div className="mt-3 space-y-2">
                          {resultDiagnosis && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"><p className="font-semibold">{resultDiagnosis.label}</p><p className="mt-1">{resultDiagnosis.action}</p></div>}
                          <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 max-h-32 overflow-y-auto whitespace-pre-wrap">{result || task.lastResult}</div>
                        </div>
                      )}

                      <div className="flex gap-2 mt-auto pt-3">
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); void runTaskNow(task.id); }}
                          data-agent-action={window.__agentProductionTarget?.link.businessRef.entityId === task.id ? 'scheduler-primary' : undefined}
                          disabled={agentProduction.active ? !agentProduction.action || agentProduction.busy : runningId === task.id}
                          className="h-9 px-3 rounded-lg bg-green-50 text-xs text-green-700 hover:bg-green-100 disabled:opacity-50 whitespace-nowrap"
                        >
                          {runningId === task.id ? '执行中…' : isDirectorTask && executionState === 'failed' ? '重试执行' : '立即执行'}
                        </button>
                        <button
                          type="button"
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : task.id);
                            setResultTaskId(task.id);
                            setWorkspaceMessage('');
                          }}
                          className="h-9 px-3 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50 whitespace-nowrap"
                        >
                          进入页面
                        </button>
                        {!isDirectorTask && <button type="button" aria-label={`删除任务 ${task.name}`} onClick={e => { e.preventDefault(); e.stopPropagation(); void deleteTask(task.id); }} className="w-9 h-9 flex items-center justify-center border border-gray-200 rounded-lg text-gray-400 hover:text-red-400 hover:border-red-200 transition-colors flex-shrink-0">
                          <Trash2 size={12} />
                        </button>}
                      </div>
                      {runNotice?.taskId === task.id && (
                        <p role="status" className={`mt-2 text-[11px] ${runNotice.error ? 'text-red-600' : 'text-green-700'}`}>{runNotice.message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {runNotice && (
        <div role="status" aria-live="assertive" className={`fixed right-6 top-20 z-[80] max-w-sm rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${runNotice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-white text-green-700'}`}>
          {runNotice.message}
        </div>
      )}
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showAdd && (
          <Modal open title="新建定时任务" width={640} onCancel={closeAddModal} footer={null} mask={{ closable: false }} closable={!creatingTasks} keyboard={!creatingTasks} styles={{ body: { maxHeight: '70dvh', overflowY: 'auto' } }}>
              <p className="mb-4 text-sm text-text-muted">{activeGroupMeta.label}</p>

              <p className="text-xs text-gray-500 mb-3 font-medium">选择任务模板</p>
              <div className="space-y-5 mb-5">
                {groupedTemplates.map(group => (
                  <section key={group.id}>
                    <div className="flex items-center justify-between mb-2 px-0.5">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-800">{group.label}</h4>
                        <p className="text-[10px] text-gray-400 mt-0.5">{group.desc}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500">{group.templates.length} 个</span>
                    </div>
                    <div className="space-y-2">
                    {group.templates.map(tmpl => (
                  <button
                    type="button"
                    key={tmpl.templateId}
                    data-demo-target={showAdd && selectedTemplateIds.length === 0 && tmpl.templateId === 'youtube_video_keyword_crawl' ? 'scheduled_run' : undefined}
                    onClick={() => {
                      const selected = selectedTemplateIds.includes(tmpl.templateId);
                      setSelectedTemplateIds(current => selected
                        ? current.filter(id => id !== tmpl.templateId)
                        : [...current, tmpl.templateId]);
                      if (selectedTemplateIds.length === 0 && !selected) {
                        const schedule = templateSchedule(tmpl);
                        setScheduleTime(schedule.time);
                        setScheduleDays(schedule.days);
                        if (tmpl.config && 'keywords' in tmpl.config) setTaskKeywords(String(tmpl.config.keywords || 'foundation'));
                        setConfirmedKeywordSignature('');
                        setCreateError('');
                        setScheduleOpen(false);
                      }
                      if (selected && selectedTemplateIds.length === 1) setCustomName('');
                    }}
                    className={`w-full p-3 rounded-xl border-2 text-left flex items-start gap-3 transition-all ${selectedTemplateIds.includes(tmpl.templateId) ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <span className="text-2xl">{tmpl.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{tmpl.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{tmpl.desc}</div>
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={10} /> {tmpl.cronLabel}</div>
                    </div>
                    {selectedTemplateIds.includes(tmpl.templateId) && <CheckCircle size={16} className="text-green-500 ml-auto mt-0.5 flex-shrink-0" />}
                  </button>
                    ))}
                    </div>
                  </section>
                ))}
              </div>

              {selectedTemplates.length > 0 && selectedTemplate && (
                <>
                  {selectedTemplates.length === 1 ? <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">任务名称</label>
                    <input
                      value={customName}
                      onChange={e => setCustomName(e.target.value)}
                      placeholder={selectedTemplate.name}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400"
                    />
                  </div> : (
                    <div className="mb-4 rounded-xl border border-green-100 bg-green-50 px-3.5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-green-800">已选择 {selectedTemplates.length} 个任务</p>
                        <p className="text-[10px] text-green-600 mt-0.5">将使用各模板默认名称，并应用同一执行频率</p>
                      </div>
                      <button type="button" onClick={() => setSelectedTemplateIds([])} className="text-[11px] text-green-700 hover:text-green-900">清空</button>
                    </div>
                  )}
                  {discoveryScope && selectedTemplates.some(template => template.taskType === 'video_keyword_crawl') && <div className="mb-4 rounded-xl bg-green-50 p-3 text-xs text-green-900"><p>发现范围：{discoveryScope.keywordSet.name} · v{discoveryScope.keywordSet.version}</p><p className="mt-2">{discoveryKeywords(discoveryScope).join('、')}</p><p className="mt-2">这是独立专项任务：每次读取灵感中心最新关键词，但平台、时间和数量按本任务单独执行、单独计数。</p></div>}
                  {keywordTemplates.length > 0 && (
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">采集关键词</label>
                      <textarea
                        value={taskKeywords}
                        onChange={event => {
                          setTaskKeywords(event.target.value);
                          setConfirmedKeywordSignature('');
                          setCreateError('');
                        }}
                        placeholder={'可粘贴脏格式，例如：\n##foundation，Bahja Care عناية بهجة'}
                        rows={3}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm leading-5 resize-none focus:outline-none focus:border-green-400"
                      />
                      <p className="text-[10px] text-gray-400 mt-1.5">支持逗号、空格、换行、全角符号、标签链接及混合语种，系统会先清洗再提交。</p>

                      <div className={`mt-3 rounded-xl border p-3 ${keywordReviewReady ? 'border-green-100 bg-green-50/70' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-800">自动清洗结果</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">请确认以下内容，确认后才会创建并执行任务。</p>
                          </div>
                          {keywordReviewConfirmed && <span className="flex items-center gap-1 text-[10px] font-medium text-green-700"><CheckCircle size={13} /> 已确认</span>}
                        </div>
                        <div className="mt-2.5 space-y-2.5">
                          {keywordReviews.map(({ platform, review }) => (
                            <div key={platform}>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <SocialPlatformIcon platform={platform} size={13} />
                                <span className="text-[10px] font-medium text-gray-600 capitalize">{platform}</span>
                              </div>
                              {review.items.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {review.items.map(item => <span key={item} className="max-w-full break-all px-2 py-1 rounded-full bg-white border border-green-200 text-[11px] text-green-800">{item}</span>)}
                                </div>
                              ) : (
                                <p className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={13} /> 没有识别到可用关键词，请修改输入。</p>
                              )}
                              {[...review.changes, ...review.warnings].length > 0 && (
                                <ul className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                                  {[...review.changes, ...review.warnings].map(message => <li key={message}>· {message}</li>)}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!keywordReviewReady) return;
                            setConfirmedKeywordSignature(keywordSignature);
                            setCreateError('');
                          }}
                          disabled={!keywordReviewReady || keywordReviewConfirmed}
                          className="mt-3 w-full py-2 rounded-lg border border-green-300 bg-white text-xs font-medium text-green-700 disabled:opacity-50"
                        >
                          {keywordReviewConfirmed ? '已确认清洗结果' : `确认使用以上 ${keywordReviews.reduce((sum, item) => sum + item.review.items.length, 0)} 个关键词`}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mb-5">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">执行频率</label>
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setScheduleOpen(open => !open)}
                        className="w-full px-3.5 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                      >
                        <span className="flex items-center gap-2 text-sm text-gray-800">
                          <Clock size={14} className="text-green-600" />
                          {scheduleLabel(scheduleTime, scheduleDays)}
                        </span>
                        <ChevronDown size={16} className={`text-gray-400 transition-transform ${scheduleOpen ? 'rotate-180' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {scheduleOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden border-t border-gray-100"
                          >
                            <div className="p-3.5 bg-gray-50/70 space-y-3">
                              <div>
                                <p className="text-[11px] text-gray-500 mb-2">执行日期</p>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setScheduleDays([])}
                                    className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${scheduleDays.length === 0 ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                                  >
                                    每天
                                  </button>
                                  {WEEKDAYS.map(day => {
                                    const selected = scheduleDays.includes(day.value);
                                    return (
                                      <button
                                        type="button"
                                        key={day.value}
                                        onClick={() => setScheduleDays(current => selected ? current.filter(value => value !== day.value) : [...current, day.value])}
                                        className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${selected ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                                      >
                                        {day.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="text-[11px] text-gray-500">当日时点</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">北京时间</p>
                                </div>
                                <input
                                  type="time"
                                  value={scheduleTime}
                                  onChange={event => setScheduleTime(event.target.value || '08:00')}
                                  className="w-36 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm focus:outline-none focus:border-green-400"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  {selectedTemplates.some(template => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(template.taskType)) && (
                    <button
                      type="button"
                      onClick={() => setRunAfterCreate(value => !value)}
                      className={`mb-4 w-full rounded-xl border px-3.5 py-3 flex items-center justify-between text-left transition-colors ${runAfterCreate ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${runAfterCreate ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'}`}><Play size={14} /></span>
                        <span>
                          <span className="block text-xs font-medium text-gray-800">创建后立即执行一次</span>
                          <span className="block text-[10px] text-gray-500 mt-0.5">确认参数没有问题后，直接启动爬虫并返回本次结果</span>
                        </span>
                      </span>
                      <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${runAfterCreate ? 'bg-green-600' : 'bg-gray-300'}`}><span className={`block w-4 h-4 rounded-full bg-white transition-transform ${runAfterCreate ? 'translate-x-4' : ''}`} /></span>
                    </button>
                  )}
                </>
              )}

              {createError && <p className="mb-3 flex items-start gap-1.5 text-xs text-red-600"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />{createError}</p>}
              <div className="flex gap-3">
                <Button onClick={closeAddModal} disabled={creatingTasks} className="flex-1">取消</Button>
                <Button
                  type="primary"
                  data-demo-target={showAdd && selectedTemplates.length > 0 ? 'scheduled_run' : undefined}
                  onClick={createTask}
                  disabled={selectedTemplates.length === 0 || creatingTasks || !keywordReviewConfirmed}
                  className="flex-1" loading={creatingTasks}
                >
                  {creatingTasks
                    ? (runAfterCreate ? '正在创建并执行…' : '正在创建…')
                    : selectedTemplates.length > 1
                      ? `${runAfterCreate ? '创建并执行' : '创建'} ${selectedTemplates.length} 个任务`
                      : runAfterCreate && ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(selectedTemplate?.taskType || '')
                        ? '创建并执行任务'
                        : '创建任务'}
                </Button>
              </div>
          </Modal>
        )}
        {resultTask && (
          <Drawer open title={resultWorkspace?.title ?? resultTask.name} onClose={closeResultPanel} size={640} styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}>
              <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
                <div className="text-3xl w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                  {resultTemplate?.icon ?? '⚙️'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 id="scheduled-result-dialog-title" className="text-sm font-semibold text-gray-900 truncate">{resultWorkspace?.title ?? resultTask.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 font-medium">任务页面</span>
                  </div>
                  <p className="text-xs text-gray-700 mt-1 truncate">{resultTask.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {resultTask.cronLabel} · 上次执行 {formatTime(resultTask.lastRun)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { void exportPdf(resultTask); }}
                  disabled={exportingId === resultTask.id || !resultTask.lastRun || !resultTask.lastResult}
                  title={!resultTask.lastRun || !resultTask.lastResult ? '任务执行完成后可导出 PDF' : '导出任务报告'}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {exportingId === resultTask.id ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                  导出 PDF
                </button>
                <button type="button" data-modal-initial-focus aria-label="关闭任务详情" onClick={closeResultPanel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>

              {exportNotice?.taskId === resultTask.id && (
                <div role="status" aria-live="polite" className={`mx-5 mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${exportNotice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                  {exportNotice.message}
                </div>
              )}
              {runNotice?.taskId === resultTask.id && (
                <div role="status" aria-live="assertive" className={`mx-5 mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${runNotice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                  {runNotice.message}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {resultWorkspace && (
                  <section className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-semibold text-gray-800 mb-3">交互页面</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {resultWorkspace.cards.map(card => (
                        <div key={card.label} className="min-h-[98px] rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                          <p className="text-[11px] text-gray-400">{card.label}</p>
                          <p className="text-sm font-semibold text-gray-900 mt-1 break-words">{card.value}</p>
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {resultWorkspace.actions.map(action => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setWorkspaceMessage(`${action}已准备，可结合任务产出继续处理。`)}
                          className="h-9 rounded-lg border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50 px-2"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                    {workspaceMessage && (
                      <div className="mt-3 rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-800 leading-relaxed">
                        {workspaceMessage}
                      </div>
                    )}
                  </section>
                )}

                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold text-gray-800 mb-3">建议下一步</p>
                  <div className="space-y-2">
                    {suggestedActions(resultTask, resultText).map((action, index) => (
                      <div key={action.label} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-green-50 text-green-700 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">{index + 1}</span>
                        <p className="text-xs text-gray-600 leading-relaxed flex-1">{action.label}</p>
                        <button
                          type="button"
                          data-demo-target={index === 0 ? 'automation_workflow_agent' : undefined}
                          onClick={() => goToAgent(action)}
                          className="h-7 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] text-gray-600 hover:border-green-200 hover:text-green-700 hover:bg-green-50 flex-shrink-0"
                        >
                          去{action.agentLabel}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold text-gray-800 mb-3">任务信息</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">类型</p>
                      <p className="text-gray-700 font-medium mt-0.5">{resultTemplate?.name ?? resultTask.taskType}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">状态</p>
                      <p className="text-gray-700 font-medium mt-0.5">{resultTask.enabled ? '已启用' : '已停用'}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">频率</p>
                      <p className="text-gray-700 font-medium mt-0.5">{resultTask.cronLabel}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">创建时间</p>
                      <p className="text-gray-700 font-medium mt-0.5">{formatTime(resultTask.createdAt)}</p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="border-t border-gray-100 p-4 flex justify-end">
                <button type="button" onClick={closeResultPanel} className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50">
                  关闭
                </button>
              </div>
          </Drawer>
        )}
      </AnimatePresence>
    </div>
  );
}
