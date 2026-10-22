import { discoveryKeywords } from '../../shared/socialDiscoveryKeywords';
import { Button, Segmented } from 'antd';
import LsPageHeader from './ui/LsPageHeader';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, BarChart3, ChevronDown, Clock, DownloadCloud, Loader, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { AgentAction } from '../App';
import ScheduledTaskResultDrawer from './ScheduledTaskResultDrawer';
import ScheduledTaskAddModal from './ScheduledTaskAddModal';
import ScheduledBusinessDynamicsWorkspace from './ScheduledBusinessDynamicsWorkspace';
import { useScheduledPageController } from './useScheduledPageController';
import { scheduledTaskExecutionState, TASK_EXECUTION_META } from './scheduledExecutionPresentation';
import {
  AGENT_GROUPS, CRAWLER_LIMIT_MAX, CRAWLER_LIMIT_MIN, TASK_TEMPLATES,
  nextDirectorCheckLabel, normalizeCrawlerLimit, taskAgentGroup, type AgentTaskGroup,
} from './scheduledTaskTemplates';
import { discoveryFailurePresentation } from '../lib/discoveryFailurePresentation';
import type { ScheduledTaskExecutionState } from '../lib/scheduledWorkflowHandoff';

export { scheduledTaskExecutionState } from './scheduledExecutionPresentation';
export { parseScheduledWorkflowHandoff } from '../lib/scheduledWorkflowHandoff';
export type { ScheduledTaskExecutionState, ScheduledWorkflowHandoff } from '../lib/scheduledWorkflowHandoff';

export interface ScheduledTask {
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

export interface VideoAnalysisItem {
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

export interface VideoStatsPayload {
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





export type SocialTaskTab = 'crawler' | 'analysis';

export default function ScheduledPage({ onAction }: { onAction?: AgentAction }) {
  const {
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
  } = useScheduledPageController(onAction);

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
        {showAdd && <ScheduledTaskAddModal
          showAdd={showAdd}
          closeAddModal={closeAddModal}
          creatingTasks={creatingTasks}
          activeGroupLabel={activeGroupMeta.label}
          groupedTemplates={groupedTemplates}
          selectedTemplateIds={selectedTemplateIds}
          setSelectedTemplateIds={setSelectedTemplateIds}
          selectedTemplates={selectedTemplates}
          selectedTemplate={selectedTemplate}
          customName={customName}
          setCustomName={setCustomName}
          discoveryScope={discoveryScope}
          keywordTemplatesCount={keywordTemplates.length}
          taskKeywords={taskKeywords}
          setTaskKeywords={setTaskKeywords}
          keywordReviewReady={keywordReviewReady}
          keywordReviewConfirmed={keywordReviewConfirmed}
          keywordReviews={keywordReviews}
          keywordSignature={keywordSignature}
          setConfirmedKeywordSignature={setConfirmedKeywordSignature}
          setCreateError={setCreateError}
          createError={createError}
          scheduleOpen={scheduleOpen}
          setScheduleOpen={setScheduleOpen}
          scheduleTime={scheduleTime}
          setScheduleTime={setScheduleTime}
          scheduleDays={scheduleDays}
          setScheduleDays={setScheduleDays}
          runAfterCreate={runAfterCreate}
          setRunAfterCreate={setRunAfterCreate}
          createTask={createTask}
        />}
        {resultTask && <ScheduledTaskResultDrawer
          resultTask={resultTask}
          resultWorkspace={resultWorkspace}
          resultTemplate={resultTemplate}
          resultText={resultText}
          workspaceMessage={workspaceMessage}
          setWorkspaceMessage={setWorkspaceMessage}
          exportingId={exportingId}
          exportNotice={exportNotice}
          runNotice={runNotice}
          closeResultPanel={closeResultPanel}
          formatTime={formatTime}
          exportPdf={exportPdf}
          goToAgent={goToAgent}
        />}
      </AnimatePresence>
    </div>
  );
}
