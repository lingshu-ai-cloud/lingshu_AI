import type { CSSProperties } from 'react';
import type { AgentType, Message, Page } from '../../App';
import { authHeader } from '../../lib/auth';
import type { AssistantActionId } from '../../../shared/contracts/assistantActions';
import type { AgentThreadState, OrbitAgentId } from '../../stores/assistantStore';

export interface AssistantContext {
  agent: AgentType;
  label: string;
  summary: string;
  suggestions: string[];
  pendingCount?: number;
  todoItems?: AssistantTodoItem[];
  /** Page-local focus only. The server still authorizes every read and action. */
  sourcePage?: string;
  goalId?: string;
  planId?: string;
  runId?: string;
  taskId?: string;
  contentId?: string;
  viewKey?: string;
  workflowStage?: 'setup_required' | 'unplanned' | 'planned' | 'running' | 'history';
}

export interface AssistantTodoItem {
  id: string;
  name: string;
  product: string;
  source?: string;
  headline: string;
  reason: string;
  tone: 'red' | 'amber' | 'blue' | 'green';
  completed: boolean;
}

export const DEFAULT_CONTEXT: Record<string, AssistantContext> = {
  digitalEmployees: {
    agent: 'strategy',
    label: '智能经营',
    summary: '当前在智能经营，优先处理周计划开始、计划调整及其他会阻断后续工作的审批。',
    suggestions: ['查看当前经营重点', '梳理下一步经营动作', '核对本周计划范围'],
  },
  strategy: {
    agent: 'strategy',
    label: '首页',
    summary: '当前在首页，适合做经营复盘、目标拆解和跨模块动作安排。',
    suggestions: ['复盘本周经营重点', '拆解下一步增长动作', '判断目标市场优先级', '联网核验目标市场机会'],
  },
  traffic: {
    agent: 'traffic',
    label: '我的社媒',
    summary: '当前在我的社媒，适合做素材筛选、脚本生成、发布节奏和内容复盘。',
    suggestions: ['生成主推品短视频脚本', '拆解爆款素材方向', '规划本周发布节奏', '联网核验平台内容趋势'],
  },
  socialInspiration: {
    agent: 'traffic', label: '灵感大屏', summary: '当前在灵感大屏，适合发现、筛选和拆解高潜社媒内容。',
    suggestions: ['拆解爆款素材方向', '筛选适合目标市场的内容', '把素材转成创作任务'],
  },
  inspirationMarket: {
    agent: 'traffic', label: '灵感集市', summary: '当前在灵感集市，可筛选爆款参考、管理素材、对标账号与待拍事项。',
    suggestions: ['筛选适合产品的爆款参考', '查看已收藏素材', '拆解对标内容'],
  },
  scriptLibrary: {
    agent: 'traffic', label: '脚本库', summary: '当前在脚本库，适合整理、复用和迭代历史脚本。',
    suggestions: ['查找可复用脚本', '优化脚本开头', '按平台改写脚本'],
  },
  smartAssets: {
    agent: 'traffic', label: '内容制作', summary: '当前在内容制作，优先处理内容、质量与发布前的必要决定。',
    suggestions: ['生成主推品短视频', '优化前三秒钩子', '生成多平台素材'],
  },
  accountManagement: {
    agent: 'traffic', label: '账号管理', summary: '当前在账号管理，适合查看账号表现、评论与发布状态。',
    suggestions: ['检查账号表现', '查看高意向评论', '规划发布节奏'],
  },
  conversion: {
    agent: 'conversion',
    label: '我的客户',
    summary: '当前在我的客户，适合做高质量询盘筛选、自动回复、跟单建议和老客唤醒。',
    suggestions: ['筛选高质量询盘', '生成 WhatsApp 跟进话术', '整理老客唤醒批次'],
  },
  orders: {
    agent: 'conversion',
    label: '我的订单',
    summary: '当前在我的订单，订单数据待接入，可先围绕订单履约、复购和客户跟进设计流程。',
    suggestions: ['设计订单跟进流程', '规划履约异常提醒', '生成成交客户复购动作'],
  },
  enterprise: {
    agent: 'strategy',
    label: '企业中心',
    summary: '当前在企业中心，适合完善企业资料、产品画像和全局知识。',
    suggestions: ['检查企业资料缺口', '整理产品卖点', '生成客户画像字段'],
  },
  scheduled: {
    agent: 'strategy',
    label: '定时任务',
    summary: '当前在定时任务，适合配置自动复盘、社媒采集、客户唤醒和报价提醒。',
    suggestions: ['规划每周自动复盘', '配置老客唤醒任务', '设计社媒趋势日报'],
  },
  plugins: {
    agent: 'strategy',
    label: '集成中心',
    summary: '当前在集成中心，适合判断要先接入哪些渠道和数据。',
    suggestions: ['推荐优先接入渠道', '梳理 WhatsApp 接入步骤', '规划社媒账号授权'],
  },
};

export const PRIMARY_ASSISTANT_THREAD: OrbitAgentId = 'business';
export const CURRENT_STATUS_TASK_ID = 'assistant-current-status';
const MAX_PERSISTED_MESSAGES = 120;
const MAX_PERSISTED_TASK_CARDS = 50;
export const WORKFLOW_MUTATION_ACTIONS = new Set<AssistantActionId>([
  'start_task',
  'pause_task',
  'resume_task',
  'confirm_choice',
  'accept_result',
  'request_revision',
]);

const INTERNAL_AGENT_TYPE: Record<OrbitAgentId, AgentType> = {
  business: 'strategy',
  director: 'traffic',
  content: 'traffic',
  customer: 'conversion',
};

export type AssistantThreadSaveQueue = {
  pending: AgentThreadState | null;
  running: boolean;
  retryAttempt: number;
  retryTimer: number | null;
  abortController: AbortController | null;
  idleWaiters: Set<() => void>;
};

export type AssistantPersistenceReason = 'change' | 'retry' | 'lifecycle';
const ASSISTANT_PERSIST_RETRY_BASE_MS = 500;
const ASSISTANT_PERSIST_RETRY_MAX_MS = 8_000;
export const ASSISTANT_PERSIST_KEEPALIVE_MAX_BYTES = 60 * 1024;

export function emptyAssistantThread(): AgentThreadState {
  return {
    conversationKey: undefined,
    conversationResetVersion: 0,
    deletedAt: '',
    title: '',
    creationDraft: null,
    version: 0,
    updatedAt: '',
    messages: [],
    draftInput: '',
    scrollPosition: 0,
    unreadCount: 0,
    isFollowingLatest: true,
    paused: false,
    taskCards: {},
    focusedTaskId: null,
    pendingContentTaskBinding: null,
  };
}

/**
 * Ordinary conversation text is transient by default; an active creation draft restores its scoped dialogue. Persisted assistant threads may
 * restore operational cards and their CAS metadata, but they must not make a
 * newly opened conversation look like the previous one. Explicitly saved
 * conversations are restored through the `restore` prop instead.
 */
export function withoutPersistedConversation(thread: AgentThreadState): AgentThreadState {
  const retainConversation = thread.creationDraft || thread.messages.some(message =>
    message.companyReport || message.creationPortal?.scenario === 'viral_replication' || message.taskPortal?.action === 'view_production');
  return {
    ...thread,
    messages: retainConversation ? thread.messages : [],
    draftInput: retainConversation ? thread.draftInput : '',
    scrollPosition: 0,
    unreadCount: 0,
    isFollowingLatest: true,
  };
}

export function assistantBubbleStyle(index: number): CSSProperties {
  const boundedIndex = Math.min(Math.max(0, index), 6);
  return {
    '--assistant-bubble-index': boundedIndex,
    '--assistant-bubble-delay': `${boundedIndex * 15}ms`,
  } as CSSProperties;
}

export function assistantPersistenceRetryDelay(attempt: number): number {
  return Math.min(
    ASSISTANT_PERSIST_RETRY_MAX_MS,
    ASSISTANT_PERSIST_RETRY_BASE_MS * (2 ** Math.min(Math.max(0, attempt), 4)),
  );
}

export function assistantPersistenceCanRun(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function cloneAssistantThread(thread: AgentThreadState): AgentThreadState {
  return {
    ...thread,
    messages: thread.messages.map(message => ({
      ...message,
      ...(message.sources ? { sources: message.sources.map(source => ({ ...source })) } : {}),
      ...(message.referenceMedia ? { referenceMedia: { ...message.referenceMedia } } : {}),
      ...(message.creationPortal ? { creationPortal: { ...message.creationPortal, platforms: [...message.creationPortal.platforms] } } : {}),
      ...(message.taskPortal ? { taskPortal: { ...message.taskPortal } } : {}),
      ...(message.sourcePortal ? { sourcePortal: { ...message.sourcePortal } } : {}),
      ...(message.analysisWork ? { analysisWork: message.analysisWork.map(event => ({ ...event })) } : {}),
      ...(message.companyReport ? { companyReport: structuredClone(message.companyReport) } : {}),
    })),
    taskCards: Object.fromEntries(Object.entries(thread.taskCards).map(([id, card]) => [id, {
      ...card,
      details: [...card.details],
      items: card.items.map(item => ({ ...item })),
      secondaryActions: card.secondaryActions.map(action => ({ ...action })),
      ...(card.primaryAction ? { primaryAction: { ...card.primaryAction } } : {}),
      ...(card.workspace ? { workspace: { ...card.workspace } } : {}),
    }])),
    pendingContentTaskBinding: thread.pendingContentTaskBinding
      ? { ...thread.pendingContentTaskBinding }
      : null,
  };
}

export function mergeAssistantThread(remote: AgentThreadState, local: AgentThreadState): AgentThreadState {
  if (remote.deletedAt || (remote.conversationResetVersion ?? 0) > (local.conversationResetVersion ?? 0)) return remote;
  const cards = { ...remote.taskCards };
  for (const [taskId, card] of Object.entries(local.taskCards)) {
    const remoteCard = cards[taskId];
    if (!remoteCard || card.updatedAt >= remoteCard.updatedAt) cards[taskId] = card;
  }
  const taskCards = Object.fromEntries(
    Object.entries(cards)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_PERSISTED_TASK_CARDS),
  );
  const focusedTaskId = local.focusedTaskId && taskCards[local.focusedTaskId]
    ? local.focusedTaskId
    : remote.focusedTaskId && taskCards[remote.focusedTaskId]
      ? remote.focusedTaskId
      : null;
  return {
    ...remote,
    ...local,
    version: remote.version,
    updatedAt: remote.updatedAt,
    // Remote messages belong to an earlier, implicitly persisted session.
    // A CAS conflict after the user sends a new message must never append that
    // old transcript below the current reply. Explicit saved-conversation
    // restoration is handled separately through the `restore` prop.
    messages: local.messages.slice(-MAX_PERSISTED_MESSAGES),
    taskCards,
    focusedTaskId,
    pendingContentTaskBinding: local.pendingContentTaskBinding ?? remote.pendingContentTaskBinding,
  };
}

export function persistedAssistantThread(value: unknown, fallback: AgentThreadState): AgentThreadState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<AgentThreadState>;
  const version = Number(source.version);
  if (!Number.isSafeInteger(version) || version < 0) return null;
  return {
    creationDraft: source.creationDraft ?? null,
    conversationKey: (source as Partial<AgentThreadState> & { agentId?: string }).agentId || source.conversationKey || fallback.conversationKey,
    conversationResetVersion: source.conversationResetVersion ?? 0,
    deletedAt: source.deletedAt || '',
    title: source.title || '',
    version,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    messages: Array.isArray(source.messages) ? source.messages : [],
    draftInput: typeof source.draftInput === 'string' ? source.draftInput : '',
    scrollPosition: Number.isFinite(source.scrollPosition) ? Number(source.scrollPosition) : 0,
    unreadCount: Number.isSafeInteger(source.unreadCount) ? Number(source.unreadCount) : 0,
    isFollowingLatest: typeof source.isFollowingLatest === 'boolean' ? source.isFollowingLatest : true,
    paused: typeof source.paused === 'boolean' ? source.paused : false,
    taskCards: source.taskCards && typeof source.taskCards === 'object' ? source.taskCards : {},
    focusedTaskId: source.focusedTaskId === '' ? null : typeof source.focusedTaskId === 'string' || source.focusedTaskId === null
      ? source.focusedTaskId
      : fallback.focusedTaskId,
    pendingContentTaskBinding: source.pendingContentTaskBinding === null
      || (source.pendingContentTaskBinding && typeof source.pendingContentTaskBinding === 'object')
      ? source.pendingContentTaskBinding
      : fallback.pendingContentTaskBinding,
  };
}

export function pageKey(page: Page) {
  if (page === 'youtube' || page === 'channels') return 'plugins';
  if (page === 'retention') return 'conversion';
  return page;
}

export function orbitIdForPage(page: Page): OrbitAgentId {
  if (page === 'socialInspiration' || page === 'scriptLibrary') return 'director';
  if (page === 'smartAssets') return 'content';
  if (page === 'conversion' || page === 'wecomCustomerService' || page === 'orders' || page === 'retention') return 'customer';
  return 'business';
}

export function orbitIdForAgent(agent: AgentType, pageAgent: OrbitAgentId = 'business'): OrbitAgentId {
  if (agent === 'conversion' || agent === 'retention') return 'customer';
  if (agent === 'traffic') return pageAgent === 'customer' ? 'content' : pageAgent;
  return 'business';
}

export function agentForOrbit(id: OrbitAgentId): AgentType {
  return INTERNAL_AGENT_TYPE[id];
}

export function contextForOrbit(id: OrbitAgentId, fallback: AssistantContext): AssistantContext {
  return { ...fallback, agent: agentForOrbit(id) };
}

export function compactText(text: string, maxLength = 900) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function contextIdentifier(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

export function assistantBusinessObjectContext(context: AssistantContext): string {
  const references = [
    context.goalId ? `周目标 ${context.goalId}` : '',
    context.planId ? `计划 ${context.planId}` : '',
    context.runId ? `运行 ${context.runId}` : '',
    context.taskId ? `任务 ${context.taskId}` : '',
    context.contentId ? `内容 ${context.contentId}` : '',
    context.viewKey ? `当前视图 ${context.viewKey}` : '',
  ].filter(Boolean);
  return references.length
    ? `【当前业务对象，仅用于定位，不能代替服务端授权或状态核验】${references.join('；')}`
    : '【当前业务对象】当前页面没有选中具体任务或内容；不得从历史对话猜测对象。';
}

export async function loadLiveIntegrationFacts(): Promise<string> {
  const readItems = async (path: string): Promise<Record<string, unknown>[] | null> => {
    try {
      const response = await fetch(path, { headers: authHeader() });
      if (!response.ok) return null;
      const data = await response.json() as { items?: Record<string, unknown>[] };
      return Array.isArray(data.items) ? data.items : null;
    } catch {
      return null;
    }
  };

  const readVideoInventory = async (): Promise<number | null> => {
    try {
      const response = await fetch('/api/overseas/videos?page=1&perPage=1&contentFormat=video', { headers: authHeader() });
      if (!response.ok) return null;
      const data = await response.json() as { inventoryTotalItems?: number; totalItems?: number };
      const count = Number(data.inventoryTotalItems ?? data.totalItems);
      return Number.isFinite(count) && count >= 0 ? count : null;
    } catch {
      return null;
    }
  };

  const [socialAccounts, youtubeAccounts, customers, collectedVideos] = await Promise.all([
    readItems('/api/overseas/social/accounts'),
    readItems('/api/overseas/youtube/accounts'),
    readItems('/api/overseas/customers'),
    readVideoInventory(),
  ]);
  const connectedSocialAccounts = (socialAccounts ?? []).filter(item => String(item.status || '').trim().toLowerCase() === 'connected');
  const connectedYoutubeAccounts = (youtubeAccounts ?? []).filter(item => String(item.status || '').trim().toLowerCase() === 'connected');
  const socialPlatforms = Array.from(new Set(connectedSocialAccounts
    .map(item => String(item.platform || item.provider || '').trim())
    .filter(Boolean)));
  // `/customers` returns customer profiles imported from WhatsApp. A profile is
  // not itself an inquiry event, so keep that distinction explicit in the
  // grounding context supplied to the model.
  const whatsappCustomers = (customers ?? []).filter(item => String(item.source || '').toLowerCase() === 'whatsapp');
  const accountViews = [...connectedSocialAccounts, ...connectedYoutubeAccounts].reduce(
    (sum, item) => sum + Math.max(0, Number(item.viewCount ?? item.views ?? 0)),
    0,
  );
  const confirmed: string[] = [];
  if (connectedSocialAccounts.length) confirmed.push(`已接入社媒账号 ${connectedSocialAccounts.length} 个${socialPlatforms.length ? `（${socialPlatforms.join('、')}）` : ''}`);
  if (connectedYoutubeAccounts.length) confirmed.push(`已接入 YouTube 账号 ${connectedYoutubeAccounts.length} 个`);
  if (collectedVideos !== null && collectedVideos > 0) confirmed.push(`已采集视频 ${collectedVideos} 条`);
  if (accountViews > 0) confirmed.push(`账号内容曝光 ${accountViews.toLocaleString('zh-CN')}`);
  if (whatsappCustomers.length) confirmed.push(`WhatsApp 客户档案 ${whatsappCustomers.length} 条`);
  return [
    `核验时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
    `已确认接入/真实数据：${confirmed.length ? confirmed.join('；') : '本次实时接口未返回可确认项目'}`,
    customers === null
      ? '客户档案接口读取失败，本次数量未知。'
      : `本次接口返回客户档案 ${customers.length} 条；其中 WhatsApp 来源客户档案 ${whatsappCustomers.length} 条。此处仅统计当前接口返回范围，不能视为全量总数。`,
    socialAccounts === null || youtubeAccounts === null || collectedVideos === null
      ? '部分账号或素材接口未成功读取；未返回数据不代表数量为零。'
      : '',
    '统计边界：客户档案数量不等于询盘事件数量。当前事实未提供消息正文、关键词命中数、询盘事件数或历史订单数；不得推断或编造这些数字。',
    '判定规则：以上来自当前租户授权接口，优先级高于企业摘要；接口未返回某项只能说“本次未核验到”，不得说“未接入”。',
  ].join('\n');
}

export function mergeConsecutiveAssistant(list: Message[]): Message[] {
  const merged: Message[] = [];
  for (const msg of list) {
    const last = merged[merged.length - 1];
    if (last?.role === 'assistant' && msg.role === 'assistant' && !last.creation && !msg.creation && !last.creationPortal && !msg.creationPortal && !last.taskPortal && !msg.taskPortal && !last.sourcePortal && !msg.sourcePortal && !last.companyReport && !msg.companyReport && !last.businessScene && !msg.businessScene && !last.businessScenePrompt && !msg.businessScenePrompt) {
      last.content = [last.content, msg.content].filter(Boolean).join('\n\n');
      last.sources = msg.sources ?? last.sources;
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

export async function responseErrorMessage(resp: Response): Promise<string> {
  const data = await resp.json().catch(() => null) as {
    error?: string;
    message?: string;
    quota?: string;
    tokenCost?: number;
    demo?: {
      remaining?: { aiChat?: number; tokens?: number };
      totalRemaining?: { tokens?: number };
    };
  } | null;

  if (data?.error === 'demo_token_quota_exceeded') {
    const daily = data.demo?.remaining?.tokens;
    const total = data.demo?.totalRemaining?.tokens;
    const left = Math.min(daily ?? Number.POSITIVE_INFINITY, total ?? Number.POSITIVE_INFINITY);
    const leftText = Number.isFinite(left) ? `当前剩余约 ${Math.max(0, left)} token，` : '';
    const costText = data.tokenCost ? `本次预计需要约 ${data.tokenCost} token，` : '';
    return `试用 Token 不足：${leftText}${costText}请清空一部分对话历史、换更短的问题，或重置/开通更多试用额度。`;
  }
  if (data?.error === 'demo_quota_exceeded') {
    const label = data.quota === 'aiChat' ? '今日对话次数' : '今日试用额度';
    return `${label}已用完，请明天再试或联系服务顾问开通更多额度。`;
  }
  if (data?.error === 'demo_expired') return '试用已到期，请联系服务顾问开通或延长试用。';
  if (data?.error === 'assistant_preview_real_queries_not_enabled') return '当前本地预览未启用真实联网问答。首页资讯、策略和周任务会直接读取本地数据；自由提问需要在明确授权后再启用真实模型调用。';
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (data?.error) return data.error;
  return `请求失败（HTTP ${resp.status}），请稍后重试。`;
}

