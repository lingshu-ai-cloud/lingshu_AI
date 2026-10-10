import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Badge, Button } from 'antd';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  Bot,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  X,
} from 'lucide-react';
import type { AgentAction, AgentType, Message, Page } from '../App';
import { authHeader, getToken } from '../lib/auth';
import { lsMotion } from '../lib/designTokens';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { renderAssistantConversationBoundary, selectAssistantConversationContext } from '../lib/assistantConversationContext';
import {
  ASSISTANT_GUIDES,
  ASSISTANT_NOTIFICATION_POLICY,
  ASSISTANT_RESPONSE_CONTRACT,
  type AssistantGuide,
} from '../lib/assistantGuides';
import {
  assistantActionTarget,
  assistantRunControl,
  shouldNotifyAssistant,
  type AssistantNotificationReason,
  type AssistantTaskCard,
  type AssistantTaskCardInput,
  type AgentThreadState,
  type OrbitAgentId,
  useAssistantStore,
} from '../stores/assistantStore';
import AgentReply from './AgentReply';
import AssistantComposer, { assistantAttachmentKind } from './assistant/AssistantComposer';
import { AssistantDecisionCenter } from './assistant';
import type { AssistantDecisionFeed } from '../../shared/contracts/assistantDecisionCenter';
import KnowledgeIntakePanel, { type AppliedProfile } from './enterprise/KnowledgeIntakePanel';
import { studioApi } from '../lib/studioApi';
import {
  clearAssistantThreadJournal,
  readAssistantThreadJournal,
  sameAssistantThreadJournalContent,
  writeAssistantThreadJournal,
  type AssistantJournalScope,
} from '../lib/assistantThreadJournal';
import type {
  AssistantActionId,
  AssistantActionRequest,
  AssistantActionResponse,
  AssistantCompactCard,
} from '../../shared/contracts/assistantActions';

interface AssistantContext {
  agent: AgentType;
  label: string;
  summary: string;
  suggestions: string[];
  pendingCount?: number;
  todoItems?: AssistantTodoItem[];
}

interface AssistantTodoItem {
  id: string;
  name: string;
  product: string;
  source?: string;
  headline: string;
  reason: string;
  tone: 'red' | 'amber' | 'blue' | 'green';
  completed: boolean;
}

type AssistantTool = 'knowledge-intake';

type UploadedAssistantAttachment = {
  name: string;
  size: number;
  kind: 'image' | 'video' | 'audio';
  materialId: string;
  materialUrl?: string;
};

const GUIDE_MEMORY_KEY = 'lingshu-feature-guides-human-v1';
const GUIDE_HOVER_DELAY_MS = 900;
const GUIDE_COOLDOWN_MS = 45_000;
const GUIDE_VISIBLE_MS = 6_000;
const ENTERPRISE_GUIDE_MEMORY_ID = '__enterprise-guide-shown__';
const ASSISTANT_PRIMARY_ENTRY_SEEN_KEY = 'lingshu-assistant-primary-entry-seen-v1';

type AssistantPerformance = { phase: string; message?: string; reason: AssistantNotificationReason };
type AssistantSpeech = { id: number; message: string };
type AssistantPanelView = 'approvals' | 'todo' | 'chat' | 'decision';

const PERFORMANCE_LINES: Record<string, string[]> = {
  script: ['我正在把卖点排成能拍的镜头，马上就好。', '好内容值得多想几秒，我先帮你把逻辑捋顺。', '别急，我正在检查每个镜头能不能真正执行。'],
  storyboard: ['分镜正在生成，请稍候。', '镜头衔接交给我，我会把节奏接顺。', '正在逐镜检查，避免成片时才发现问题。'],
  voice: ['正在逐句处理配音，不会漏掉后面的台词。', '我在给每句话找合适的停顿和节奏。', '配音还在生成，我陪你等一小会儿。'],
  material: ['我正在替每个分镜挑合适的素材。', '素材匹配中，先看动作，再看画面是否真的能用。', '稍等，我正在把重复镜头和不合适的素材筛掉。'],
  render: ['成片正在合成，我先替进度条加加油。', '最后几步通常最费功夫，马上就能看成片。', '正在把画面、字幕和声音稳稳地合在一起。'],
  default: ['任务正在处理中，我会一直在这里陪你。', '稍等一下，好结果正在路上。', '后台任务正在继续执行。'],
};

type GuideMemory = {
  seen: string[];
  lastShownAt: number;
};

interface Props {
  page: Page;
  persistenceScope: AssistantJournalScope;
  primaryEntry?: boolean;
  compactMode?: boolean;
  restore?: { agent: AgentType; messages: Message[]; key: string } | null;
  kickoff?: { agent: AgentType; text: string; key: string } | null;
  suppressForRightSidebar?: boolean;
  onKickoffConsumed?: () => void;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

const API_PATH: Record<AgentType, string> = {
  strategy: '/api/overseas/strategy/chat',
  traffic: '/api/overseas/agents/traffic/chat',
  conversion: '/api/overseas/agents/conversion/chat',
  retention: '/api/overseas/agents/retention/chat',
};

const DEFAULT_CONTEXT: Record<string, AssistantContext> = {
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
  agentMemory: {
    agent: 'strategy', label: '智能体记忆', summary: '当前在智能体记忆，适合治理业务事实、客户偏好与行为规则。',
    suggestions: ['检查记忆来源', '梳理客户偏好', '制定记忆治理规则'],
  },
  organizationPermissions: {
    agent: 'strategy', label: '组织与权限', summary: '当前在组织与权限，适合规划成员角色和数据访问边界。',
    suggestions: ['设计成员角色', '检查数据权限', '规划最小权限'],
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

const PRIMARY_ASSISTANT_THREAD: OrbitAgentId = 'business';
const CURRENT_STATUS_TASK_ID = 'assistant-current-status';
const MAX_PERSISTED_MESSAGES = 120;
const MAX_PERSISTED_TASK_CARDS = 50;
const WORKFLOW_MUTATION_ACTIONS = new Set<AssistantActionId>([
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

type AssistantThreadSaveQueue = {
  pending: AgentThreadState | null;
  running: boolean;
  retryAttempt: number;
  retryTimer: number | null;
  abortController: AbortController | null;
};

type AssistantPersistenceReason = 'change' | 'retry' | 'lifecycle';
const ASSISTANT_PERSIST_RETRY_BASE_MS = 500;
const ASSISTANT_PERSIST_RETRY_MAX_MS = 8_000;
const ASSISTANT_PERSIST_KEEPALIVE_MAX_BYTES = 60 * 1024;

function emptyAssistantThread(): AgentThreadState {
  return {
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
  };
}

function assistantPersistenceRetryDelay(attempt: number): number {
  return Math.min(
    ASSISTANT_PERSIST_RETRY_MAX_MS,
    ASSISTANT_PERSIST_RETRY_BASE_MS * (2 ** Math.min(Math.max(0, attempt), 4)),
  );
}

function assistantPersistenceCanRun(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function cloneAssistantThread(thread: AgentThreadState): AgentThreadState {
  return {
    ...thread,
    messages: thread.messages.map(message => ({
      ...message,
      ...(message.sources ? { sources: message.sources.map(source => ({ ...source })) } : {}),
    })),
    taskCards: Object.fromEntries(Object.entries(thread.taskCards).map(([id, card]) => [id, {
      ...card,
      details: [...card.details],
      items: card.items.map(item => ({ ...item })),
      secondaryActions: card.secondaryActions.map(action => ({ ...action })),
      ...(card.primaryAction ? { primaryAction: { ...card.primaryAction } } : {}),
      ...(card.workspace ? { workspace: { ...card.workspace } } : {}),
    }])),
  };
}

function mergeAssistantMessages(remote: Message[], local: Message[]): Message[] {
  let commonPrefix = 0;
  while (
    commonPrefix < remote.length
    && commonPrefix < local.length
    && JSON.stringify(remote[commonPrefix]) === JSON.stringify(local[commonPrefix])
  ) commonPrefix += 1;
  if (commonPrefix === remote.length) return local.slice(-MAX_PERSISTED_MESSAGES);
  if (commonPrefix === local.length) return remote.slice(-MAX_PERSISTED_MESSAGES);
  return [...remote, ...local.slice(commonPrefix)].slice(-MAX_PERSISTED_MESSAGES);
}

function mergeAssistantThread(remote: AgentThreadState, local: AgentThreadState): AgentThreadState {
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
    messages: mergeAssistantMessages(remote.messages, local.messages),
    taskCards,
    focusedTaskId,
  };
}

function persistedAssistantThread(value: unknown, fallback: AgentThreadState): AgentThreadState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<AgentThreadState>;
  const version = Number(source.version);
  if (!Number.isSafeInteger(version) || version < 0) return null;
  return {
    version,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    messages: Array.isArray(source.messages) ? source.messages : [],
    draftInput: typeof source.draftInput === 'string' ? source.draftInput : '',
    scrollPosition: Number.isFinite(source.scrollPosition) ? Number(source.scrollPosition) : 0,
    unreadCount: Number.isSafeInteger(source.unreadCount) ? Number(source.unreadCount) : 0,
    isFollowingLatest: typeof source.isFollowingLatest === 'boolean' ? source.isFollowingLatest : true,
    paused: typeof source.paused === 'boolean' ? source.paused : false,
    taskCards: source.taskCards && typeof source.taskCards === 'object' ? source.taskCards : {},
    focusedTaskId: typeof source.focusedTaskId === 'string' || source.focusedTaskId === null
      ? source.focusedTaskId
      : fallback.focusedTaskId,
  };
}

function pageKey(page: Page) {
  if (page === 'youtube' || page === 'channels') return 'plugins';
  if (page === 'retention') return 'conversion';
  return page;
}

function orbitIdForPage(page: Page): OrbitAgentId {
  if (page === 'socialInspiration' || page === 'scriptLibrary') return 'director';
  if (page === 'smartAssets') return 'content';
  if (page === 'conversion' || page === 'wecomCustomerService' || page === 'orders' || page === 'retention') return 'customer';
  return 'business';
}

function orbitIdForAgent(agent: AgentType, pageAgent: OrbitAgentId = 'business'): OrbitAgentId {
  if (agent === 'conversion' || agent === 'retention') return 'customer';
  if (agent === 'traffic') return pageAgent === 'customer' ? 'content' : pageAgent;
  return 'business';
}

function agentForOrbit(id: OrbitAgentId): AgentType {
  return INTERNAL_AGENT_TYPE[id];
}

function contextForOrbit(id: OrbitAgentId, fallback: AssistantContext): AssistantContext {
  return { ...fallback, agent: agentForOrbit(id) };
}

function compactText(text: string, maxLength = 900) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

async function loadLiveIntegrationFacts(): Promise<string> {
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

function mergeConsecutiveAssistant(list: Message[]): Message[] {
  const merged: Message[] = [];
  for (const msg of list) {
    const last = merged[merged.length - 1];
    if (last?.role === 'assistant' && msg.role === 'assistant') {
      last.content = [last.content, msg.content].filter(Boolean).join('\n\n');
      last.sources = msg.sources ?? last.sources;
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

async function responseErrorMessage(resp: Response): Promise<string> {
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
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (data?.error) return data.error;
  return `请求失败（HTTP ${resp.status}），请稍后重试。`;
}

function todoToneClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'border-green/20 bg-green/5 text-green';
  if (tone === 'red') return 'border-red/20 bg-red/5 text-red';
  if (tone === 'amber') return 'border-amber/20 bg-amber-dim text-amber';
  if (tone === 'blue') return 'border-accent/20 bg-accent-glow text-accent';
  return 'border-border bg-surface text-text-secondary';
}

function todoDotClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'bg-green';
  if (tone === 'red') return 'bg-red';
  if (tone === 'amber') return 'bg-amber';
  if (tone === 'blue') return 'bg-accent';
  return 'bg-border-bright';
}

function taskStatusLabel(card: AssistantTaskCard) {
  if (card.status === 'needs_input') return '待补信息';
  if (card.status === 'approval') return '待确认';
  if (card.status === 'ready') return '可开始';
  if (card.status === 'running') return '执行中';
  if (card.status === 'paused') return '已暂停';
  if (card.status === 'failed') return '需要处理';
  return '已完成';
}

function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const FOCUSED_MUTATION_PATTERNS: Array<[AssistantActionId, RegExp]> = [
  ['start_task', /^(?:请|请帮我|帮我)?(?:现在|立即|马上)?(?:开始执行|开始|启动)(?:这个|该|当前)?(?:任务|工作|计划|执行)(?:一下)?[。！!]?$/],
  ['pause_task', /^(?:请|请帮我|帮我)?(?:我想|我希望)?(?:现在|立即|马上)?(?:暂停|先暂停|停止)(?:这个|该|当前)?(?:任务|工作|计划|执行|运行)(?:一下)?[。！!]?$/],
  ['resume_task', /^(?:请|请帮我|帮我)?(?:我想|我希望)?(?:现在|立即|马上)?(?:继续执行|继续|恢复)(?:这个|该|当前)?(?:任务|工作|计划|执行|运行)?[。！!]?$/],
  ['confirm_choice', /^(?:请)?(?:(?:确认|采用|选择)(?:这个|该|当前)?(?:选择|方案|选项)|(?:批准|确认)(?:这个|该|当前|这份)?报价)[。！!]?$/],
  ['accept_result', /^(?:请)?(?:验收通过|接受结果|确认结果)[。！!]?$/],
  ['request_revision', /^(?:请)?(?:退回修改|要求修改|修改(?:这个|该|当前)?(?:结果|方案)|重新做|再改)(?:一下)?[。！!]?$/],
];

function focusedNaturalLanguageActionId(text: string): AssistantActionId | undefined {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const matches = FOCUSED_MUTATION_PATTERNS.filter(([, pattern]) => pattern.test(normalized));
  return matches.length === 1 ? matches[0][0] : undefined;
}

function focusedNaturalLanguageActionInput(
  card: AssistantTaskCard | null | undefined,
  actionId: AssistantActionId,
): Pick<AssistantActionRequest, 'target' | 'parameters'> | undefined {
  const target = assistantActionTarget(card, actionId);
  if (!card || !target?.objectId || !target.expectedVersion) return undefined;
  const matchingActions = [card.primaryAction, ...card.secondaryActions].filter(action => (
    action?.actionId === actionId
    && action.target?.objectType === target.objectType
    && action.target.objectId?.trim() === target.objectId
    && action.target.expectedVersion?.trim() === target.expectedVersion
  ));
  if (matchingActions.length !== 1) return undefined;
  const parameters = matchingActions[0]?.parameters;
  return { target, ...(parameters ? { parameters } : {}) };
}

function actionResponseCardId(
  request: AssistantActionRequest,
  response: AssistantActionResponse,
  existingCards: Record<string, AssistantTaskCard>,
): string {
  const responseActions = [response.card.primaryAction, ...(response.card.secondaryActions ?? [])];
  const requestObjectId = request.target?.objectId?.trim();
  const requestObjectType = request.target?.objectType;
  const responseTargets = responseActions
    .map(action => action?.target)
    .filter((target): target is NonNullable<typeof target> => Boolean(target?.objectId?.trim()));
  const responseObjectIds = [...new Set(responseTargets.map(target => target.objectId!.trim()))];
  const responseDisagreesWithRequest = Boolean(requestObjectId)
    && responseTargets.some(target => (
      target.objectId?.trim() !== requestObjectId
      || (requestObjectType && target.objectType !== requestObjectType)
    ));
  // Never attach a cross-object response to either the request card or an
  // existing card for the unexpected response target. Treat it as a new
  // response until the server and caller agree on one business object.
  if (responseDisagreesWithRequest) return response.requestId || request.requestId;
  const objectId = requestObjectId || (responseObjectIds.length === 1 ? responseObjectIds[0] : undefined);
  if (!objectId) return response.requestId || request.requestId;
  if (existingCards[objectId]) return objectId;
  const matchingCardIds = Object.entries(existingCards)
    .filter(([, card]) => [card.primaryAction, ...card.secondaryActions]
      .some(action => (
        action?.target?.objectId?.trim() === objectId
        && (!requestObjectType || action.target.objectType === requestObjectType)
      )))
    .map(([cardId]) => cardId);
  return matchingCardIds.length === 1
    ? matchingCardIds[0]
    : response.requestId || request.requestId;
}

function responseHasCrossObjectAction(
  request: AssistantActionRequest,
  response: AssistantActionResponse,
): boolean {
  const requestObjectId = request.target?.objectId?.trim();
  const requestObjectType = request.target?.objectType;
  if (!requestObjectId || !requestObjectType) return false;
  return [response.card.primaryAction, ...(response.card.secondaryActions ?? [])]
    .some(action => Boolean(
      action?.target?.objectId?.trim()
      && (
        action.target.objectId.trim() !== requestObjectId
        || action.target.objectType !== requestObjectType
      )
    ));
}

function responseWithoutCrossObjectActions(
  request: AssistantActionRequest,
  response: AssistantActionResponse,
): AssistantActionResponse {
  if (!responseHasCrossObjectAction(request, response)) return response;
  const requestObjectId = request.target?.objectId?.trim();
  const requestObjectType = request.target?.objectType;
  const safeAction = (action: AssistantCompactCard['primaryAction']) => (
    !action?.target?.objectId?.trim()
    || (
      action.target.objectId.trim() === requestObjectId
      && action.target.objectType === requestObjectType
    )
  );
  return {
    ...response,
    card: {
      ...response.card,
      primaryAction: safeAction(response.card.primaryAction) ? response.card.primaryAction : undefined,
      secondaryActions: (response.card.secondaryActions ?? []).filter(safeAction),
    },
  };
}

function notificationReasonFromResponse(response: AssistantActionResponse): AssistantNotificationReason {
  if (response.status === 'missing_required_input') return 'missing_input';
  if (response.status === 'approval_required') return 'approval_required';
  if (response.status === 'failed' || response.status === 'stale_action') return 'failed';
  return 'routine';
}

function taskStatusFromResponse(response: AssistantActionResponse): AssistantTaskCard['status'] {
  if (response.status === 'missing_required_input') return 'needs_input';
  if (response.status === 'approval_required') return 'approval';
  if (response.status === 'failed' || response.status === 'stale_action') return 'failed';
  const signedRunControl = [response.card.primaryAction, ...(response.card.secondaryActions ?? [])]
    .find(action => action?.actionId === 'pause_task' || action?.actionId === 'resume_task');
  if (signedRunControl?.actionId === 'resume_task') return 'paused';
  if (signedRunControl?.actionId === 'pause_task') return 'running';
  if (response.actionId === 'pause_task' && (response.status === 'accepted' || response.status === 'completed')) return 'paused';
  if (response.actionId === 'resume_task' && (response.status === 'accepted' || response.status === 'completed')) return 'running';
  if (response.status === 'accepted' || response.status === 'delegated') return 'running';
  return 'completed';
}

function actionCardToTaskCard(
  card: AssistantCompactCard,
  response: AssistantActionResponse,
  stableTaskId: string,
): AssistantTaskCardInput {
  return {
    taskId: stableTaskId,
    title: card.title,
    conclusion: card.summary,
    details: card.details,
    items: card.items,
    status: taskStatusFromResponse(response),
    notificationReason: notificationReasonFromResponse(response),
    primaryAction: card.primaryAction,
    secondaryActions: card.secondaryActions,
    workspace: response.workspace,
  };
}

export default function GlobalAssistant({
  page,
  persistenceScope,
  primaryEntry = false,
  compactMode = false,
  restore,
  kickoff,
  suppressForRightSidebar = false,
  onKickoffConsumed,
  onAction,
  onSessionRefresh,
}: Props) {
  const reduceMotion = usePrefersReducedMotion();
  const fadeTransition = { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.enter) / 1000, ease: lsMotion.ease.enter };
  const fadeExit = { opacity: 0, transition: { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.exit) / 1000, ease: lsMotion.ease.exit } };
  const spatialTransition = reduceMotion ? { duration: 0 } : { ...lsMotion.spring.standard, opacity: fadeTransition };
  const [mode, setMode] = useState<'breathing' | 'chat'>('breathing');
  const [panelView, setPanelView] = useState<AssistantPanelView>('chat');
  const [decisionTotal, setDecisionTotal] = useState<number | null>(null);
  const activeAgent = PRIMARY_ASSISTANT_THREAD;
  const [assistantTool, setAssistantTool] = useState<AssistantTool | null>(null);
  const [liveContext, setLiveContext] = useState<AssistantContext | null>(null);
  const [featureGuide, setFeatureGuide] = useState<(AssistantGuide & { id: string }) | null>(null);
  const [enterpriseGuideSeen, setEnterpriseGuideSeen] = useState(false);
  const [enterpriseContext, setEnterpriseContext] = useState('');
  const [performance, setPerformance] = useState<AssistantPerformance | null>(null);
  const [performanceHidden, setPerformanceHidden] = useState(false);
  const [performanceLineIndex, setPerformanceLineIndex] = useState(0);
  const [speechBubble, setSpeechBubble] = useState<AssistantSpeech | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  const featureGuideTimerRef = useRef<number | null>(null);
  const featureGuideHoverTimerRef = useRef<number | null>(null);
  const speechTimerRef = useRef<number | null>(null);
  const seenGuideIdsRef = useRef(new Set<string>());
  const lastGuideShownAtRef = useRef(0);
  const lastGuideTargetRef = useRef<HTMLElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement>(null);
  const launcherButtonRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());
  const assistantThreadHydrationStartedRef = useRef(false);
  const initialAssistantPageRef = useRef(page);
  const assistantThreadSaveQueuesRef = useRef(new Map<OrbitAgentId, AssistantThreadSaveQueue>());
  const uploadedAttachmentCacheRef = useRef(new WeakMap<File, UploadedAssistantAttachment>());
  const stablePersistenceScope = useMemo<AssistantJournalScope>(() => ({
    tenantId: persistenceScope.tenantId.trim(),
    userId: persistenceScope.userId.trim(),
  }), [persistenceScope.tenantId, persistenceScope.userId]);
  const persistenceScopeKey = `${stablePersistenceScope.tenantId}\u0000${stablePersistenceScope.userId}`;
  const persistenceFenceRef = useRef({ scopeKey: persistenceScopeKey, active: true });
  if (persistenceFenceRef.current.scopeKey !== persistenceScopeKey) {
    persistenceFenceRef.current.active = false;
    persistenceFenceRef.current = { scopeKey: persistenceScopeKey, active: true };
  }

  useEffect(() => {
    const fence = persistenceFenceRef.current;
    return () => {
      fence.active = false;
      abortRef.current?.abort();
      abortRef.current = null;
      for (const queue of assistantThreadSaveQueuesRef.current.values()) {
        queue.abortController?.abort();
        queue.abortController = null;
      }
    };
  }, [persistenceScopeKey]);

  const threads = useAssistantStore(state => state.threads);
  const setMessages = useAssistantStore(state => state.setMessages);
  const setDraftInput = useAssistantStore(state => state.setDraftInput);
  const setScrollPosition = useAssistantStore(state => state.setScrollPosition);
  const setUnreadCount = useAssistantStore(state => state.setUnreadCount);
  const setFollowingLatest = useAssistantStore(state => state.setFollowingLatest);
  const upsertTaskCard = useAssistantStore(state => state.upsertTaskCard);
  const focusTaskCard = useAssistantStore(state => state.focusTaskCard);
  const hydrateThread = useAssistantStore(state => state.hydrateThread);
  const setPersistenceMetadata = useAssistantStore(state => state.setPersistenceMetadata);

  const pageContext = useMemo(() => liveContext ?? DEFAULT_CONTEXT[pageKey(page)] ?? DEFAULT_CONTEXT.strategy, [liveContext, page]);
  const currentPageAgent = useMemo(() => orbitIdForPage(page), [page]);
  const activeContext = useMemo(() => contextForOrbit(currentPageAgent, pageContext), [currentPageAgent, pageContext]);
  const activeThread = threads[activeAgent];
  const focusedTaskCard = activeThread.focusedTaskId
    ? activeThread.taskCards[activeThread.focusedTaskId] ?? null
    : null;
  const focusedRunControl = assistantRunControl(focusedTaskCard);
  const todoItems = pageContext.todoItems ?? [];
  const activeTodoItems = todoItems.filter(item => !item.completed);
  const completedTodoItems = todoItems.filter(item => item.completed);
  const orderedTodoItems = [...activeTodoItems, ...completedTodoItems];
  const pendingCount = todoItems.length ? activeTodoItems.length : Math.max(0, Number(pageContext.pendingCount ?? 0));
  const activeAgentLabel = '灵小枢';
  const isCustomerTodoView = panelView === 'todo' && pageContext.agent === 'conversion';
  const panelTitle = assistantTool === 'knowledge-intake'
    ? '灵小枢 · 快速采集'
    : panelView === 'approvals'
      ? '待你决定'
      : panelView === 'decision' && focusedTaskCard
      ? focusedTaskCard.status === 'approval' || focusedTaskCard.status === 'needs_input'
        ? '需要你确认'
        : '任务结果'
      : isCustomerTodoView ? '今日待办' : activeAgentLabel;
  const panelSubtitle = assistantTool === 'knowledge-intake'
    ? '当前：智能客服规范'
    : panelView === 'approvals'
      ? '查看详情后再确认，不会在概要卡上直接执行'
      : panelView === 'decision' && focusedTaskCard
      ? focusedTaskCard.title
      : isCustomerTodoView ? '当前：我的客户' : `当前：${activeContext.label}`;
  const assistantPanelHeight = Math.max(120, Math.min(720, viewport.height - 96));
  const assistantPanelWidth = Math.min(assistantTool === 'knowledge-intake' ? 560 : 420, viewport.width - 32);
  const performanceLines = PERFORMANCE_LINES[performance?.phase || 'default'] || PERFORMANCE_LINES.default;
  const performanceMessage = performance?.message || performanceLines[performanceLineIndex % performanceLines.length];

  const persistThread = useCallback((
    agentId: OrbitAgentId,
    reason: AssistantPersistenceReason = 'change',
  ) => {
    const fence = persistenceFenceRef.current;
    const fenceIsCurrent = () => fence.active && persistenceFenceRef.current === fence;
    if (!fenceIsCurrent()) return;
    // Capture the authenticated scope once. A request from an old component
    // instance must never pick up a newly logged-in user's credentials.
    const scopedAuthHeaders = authHeader();
    const queues = assistantThreadSaveQueuesRef.current;
    const queue = queues.get(agentId) ?? {
      pending: null,
      running: false,
      retryAttempt: 0,
      retryTimer: null,
      abortController: null,
    };
    queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
    // The synchronous journal survives a pagehide that outlives keepalive.
    // It is bounded and credential-scrubbed and never contains auth tokens or
    // pending attachment bytes.
    writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, queue.pending);
    queues.set(agentId, queue);
    if (queue.running) return;
    if (reason === 'change' && queue.retryTimer !== null) return;
    if (reason !== 'change' && queue.retryTimer !== null) {
      window.clearTimeout(queue.retryTimer);
      queue.retryTimer = null;
    }
    if (reason !== 'lifecycle' && !assistantPersistenceCanRun()) return;
    queue.running = true;
    void (async () => {
      let conflicts = 0;
      let retryRequired = false;
      try {
        while (queue.pending && fenceIsCurrent()) {
          const snapshot = queue.pending;
          queue.pending = null;
          const expectedVersion = useAssistantStore.getState().threads[agentId].version;
          const requestBody = JSON.stringify({ ...snapshot, expectedVersion });
          const controller = new AbortController();
          queue.abortController = controller;
          const response = await fetch(`/api/overseas/assistant-threads/${agentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...scopedAuthHeaders },
            body: requestBody,
            signal: controller.signal,
            // A pagehide can race an already-running save. Keep every request
            // below the browser limit alive, not just the lifecycle-triggered
            // retry, so the in-flight winner is not cancelled on navigation.
            keepalive: new TextEncoder().encode(requestBody).byteLength <= ASSISTANT_PERSIST_KEEPALIVE_MAX_BYTES,
          });
          const payload = await response.json().catch(() => null) as ({
            version?: unknown;
            updatedAt?: unknown;
            current?: unknown;
          } & Record<string, unknown>) | null;
          if (queue.abortController === controller) queue.abortController = null;
          if (!fenceIsCurrent()) return;
          if (response.status === 409) {
            const latestLocal = useAssistantStore.getState().threads[agentId];
            const remote = persistedAssistantThread(payload?.current, latestLocal);
            if (!remote || conflicts >= 4) {
              queue.pending = cloneAssistantThread(latestLocal);
              retryRequired = true;
              break;
            }
            const merged = mergeAssistantThread(remote, latestLocal);
            hydrateThread(agentId, merged);
            queue.pending = cloneAssistantThread(merged);
            writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, merged);
            conflicts += 1;
            continue;
          }
          if (!response.ok) {
            queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
            retryRequired = true;
            break;
          }
          const savedVersion = Number(payload?.version);
          if (!Number.isSafeInteger(savedVersion) || savedVersion <= expectedVersion) {
            queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
            retryRequired = true;
            break;
          }
          setPersistenceMetadata(
            agentId,
            savedVersion,
            typeof payload?.updatedAt === 'string' ? payload.updatedAt : '',
          );
          const latestAfterSave = useAssistantStore.getState().threads[agentId];
          if (!queue.pending && sameAssistantThreadJournalContent(snapshot, latestAfterSave)) {
            clearAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId);
          } else {
            queue.pending = cloneAssistantThread(latestAfterSave);
            writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, latestAfterSave);
          }
          conflicts = 0;
          queue.retryAttempt = 0;
        }
      } catch {
        if (!fenceIsCurrent()) return;
        queue.pending = cloneAssistantThread(useAssistantStore.getState().threads[agentId]);
        writeAssistantThreadJournal(window.localStorage, stablePersistenceScope, agentId, queue.pending);
        retryRequired = true;
      } finally {
        queue.abortController = null;
        queue.running = false;
        if (fenceIsCurrent() && queue.pending && retryRequired && queue.retryTimer === null && assistantPersistenceCanRun()) {
          const delay = assistantPersistenceRetryDelay(queue.retryAttempt);
          queue.retryAttempt = Math.min(queue.retryAttempt + 1, 4);
          queue.retryTimer = window.setTimeout(() => {
            queue.retryTimer = null;
            if (fenceIsCurrent()) persistThread(agentId, 'retry');
          }, delay);
        }
      }
    })();
  }, [hydrateThread, setPersistenceMetadata, stablePersistenceScope]);

  useEffect(() => {
    const retryPendingThreads = () => {
      if (!assistantPersistenceCanRun()) return;
      for (const [agentId, queue] of assistantThreadSaveQueuesRef.current) {
        if (!queue.pending || queue.running) continue;
        persistThread(agentId, 'retry');
      }
    };
    const flushPendingThreads = () => {
      const agentIds = new Set<OrbitAgentId>([
        PRIMARY_ASSISTANT_THREAD,
        ...assistantThreadSaveQueuesRef.current.keys(),
      ]);
      for (const agentId of agentIds) {
        persistThread(agentId, 'lifecycle');
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingThreads();
      else retryPendingThreads();
    };
    window.addEventListener('online', retryPendingThreads);
    window.addEventListener('pagehide', flushPendingThreads);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', retryPendingThreads);
      window.removeEventListener('pagehide', flushPendingThreads);
      document.removeEventListener('visibilitychange', handleVisibility);
      for (const queue of assistantThreadSaveQueuesRef.current.values()) {
        if (queue.retryTimer !== null) window.clearTimeout(queue.retryTimer);
        queue.retryTimer = null;
        queue.abortController?.abort();
        queue.abortController = null;
      }
    };
  }, [persistThread]);

  const openAgent = useCallback((routeAgent: OrbitAgentId, preferredView?: AssistantPanelView) => {
    const agentId = PRIMARY_ASSISTANT_THREAD;
    const nextView = preferredView ?? 'chat';
    void routeAgent;
    setAssistantTool(null);
    setPanelView(nextView);
    setUnreadCount(agentId, 0);
    setMode('chat');
    persistThread(agentId);
  }, [persistThread, setUnreadCount]);

  const openCurrentPageAgent = useCallback(() => {
    openAgent(currentPageAgent, 'chat');
  }, [currentPageAgent, openAgent]);

  const handleDecisionFeedChange = useCallback((feed: AssistantDecisionFeed) => {
    setDecisionTotal(Math.max(0, feed.total));
  }, []);

  const rememberGuide = useCallback((id: string, shownAt: number) => {
    seenGuideIdsRef.current.add(id);
    lastGuideShownAtRef.current = shownAt;
    try {
      const memory: GuideMemory = {
        seen: [...seenGuideIdsRef.current],
        lastShownAt: shownAt,
      };
      window.localStorage.setItem(GUIDE_MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // Storage can be unavailable in privacy mode; in-memory deduplication still works.
    }
  }, []);

  const showFeatureGuide = useCallback((id: string) => {
    const guide = ASSISTANT_GUIDES[id];
    if (!guide || seenGuideIdsRef.current.has(id)) return;
    const isEnterpriseGuide = page === 'enterprise' && id.startsWith('enterprise-');
    if (
      isEnterpriseGuide
      && (enterpriseGuideSeen || seenGuideIdsRef.current.has(ENTERPRISE_GUIDE_MEMORY_ID))
    ) return;
    const now = Date.now();
    if (now - lastGuideShownAtRef.current < GUIDE_COOLDOWN_MS) return;
    if (featureGuideTimerRef.current) window.clearTimeout(featureGuideTimerRef.current);
    if (isEnterpriseGuide) {
      seenGuideIdsRef.current.add(ENTERPRISE_GUIDE_MEMORY_ID);
      setEnterpriseGuideSeen(true);
    }
    rememberGuide(id, now);
    setFeatureGuide({ ...guide, id });
    featureGuideTimerRef.current = window.setTimeout(() => setFeatureGuide(null), GUIDE_VISIBLE_MS);
  }, [enterpriseGuideSeen, page, rememberGuide]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(GUIDE_MEMORY_KEY);
      if (!stored) return;
      const memory = JSON.parse(stored) as Partial<GuideMemory>;
      if (Array.isArray(memory.seen)) {
        seenGuideIdsRef.current = new Set(memory.seen.filter(id => typeof id === 'string'));
        setEnterpriseGuideSeen(
          seenGuideIdsRef.current.has(ENTERPRISE_GUIDE_MEMORY_ID)
          || [...seenGuideIdsRef.current].some(id => id.startsWith('enterprise-')),
        );
      }
      if (typeof memory.lastShownAt === 'number') lastGuideShownAtRef.current = memory.lastShownAt;
    } catch {
      // Ignore malformed or unavailable storage and start with a clean guide memory.
    }
  }, []);

  useEffect(() => {
    if (compactMode || mode !== 'breathing') {
      setFeatureGuide(null);
      return;
    }
    const findTarget = (event: Event) => {
      const target = event.target;
      return target instanceof Element ? target.closest<HTMLElement>('[data-lingshu-guide]') : null;
    };
    const cancelPendingHover = () => {
      if (featureGuideHoverTimerRef.current) window.clearTimeout(featureGuideHoverTimerRef.current);
      featureGuideHoverTimerRef.current = null;
    };
    const showFromEvent = (event: Event) => {
      const target = findTarget(event);
      if (!target) return;
      const id = target.dataset.lingshuGuide;
      if (!id) return;
      if (event.type === 'pointerover') {
        const related = (event as PointerEvent).relatedTarget;
        if (related instanceof Node && target.contains(related)) return;
        if (lastGuideTargetRef.current === target) return;
        cancelPendingHover();
        lastGuideTargetRef.current = target;
        featureGuideHoverTimerRef.current = window.setTimeout(() => {
          if (lastGuideTargetRef.current === target) showFeatureGuide(id);
        }, GUIDE_HOVER_DELAY_MS);
        return;
      }
      cancelPendingHover();
      lastGuideTargetRef.current = target;
      showFeatureGuide(id);
    };
    const clearPointerTarget = (event: Event) => {
      const target = findTarget(event);
      if (!target) return;
      const related = (event as PointerEvent).relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      if (lastGuideTargetRef.current === target) {
        lastGuideTargetRef.current = null;
        cancelPendingHover();
      }
    };
    document.addEventListener('pointerover', showFromEvent, true);
    document.addEventListener('pointerout', clearPointerTarget, true);
    document.addEventListener('focusin', showFromEvent, true);
    document.addEventListener('click', showFromEvent, true);
    return () => {
      cancelPendingHover();
      document.removeEventListener('pointerover', showFromEvent, true);
      document.removeEventListener('pointerout', clearPointerTarget, true);
      document.removeEventListener('focusin', showFromEvent, true);
      document.removeEventListener('click', showFromEvent, true);
    };
  }, [compactMode, mode, showFeatureGuide]);

  useEffect(() => () => {
    if (featureGuideTimerRef.current) window.clearTimeout(featureGuideTimerRef.current);
    if (featureGuideHoverTimerRef.current) window.clearTimeout(featureGuideHoverTimerRef.current);
  }, []);

  const executeAssistantAction = useCallback(async (
    agentId: OrbitAgentId,
    request: AssistantActionRequest,
    options?: { deterministicActionId?: AssistantActionId },
  ): Promise<AssistantActionResponse | null> => {
    const actionFailure = (
      message: string,
      errorCode = 'assistant_action_unavailable',
      httpStatus?: number,
    ): AssistantActionResponse => {
      const missingInput = httpStatus === 422 || /(?:^|_)(?:goal|required|missing)(?:_|$)/.test(errorCode);
      const staleAction = httpStatus === 409 || /(?:stale|conflict)/.test(errorCode);
      const status: AssistantActionResponse['status'] = missingInput
        ? 'missing_required_input'
        : staleAction ? 'stale_action' : 'failed';
      return {
        status,
        actionId: request.actionId ?? options?.deterministicActionId ?? 'delegate_to_agent',
        requestId: request.requestId,
        card: {
          kind: missingInput ? 'decision' : 'operation_result',
          title: missingInput ? '还需要补充信息' : staleAction ? '页面信息已更新' : '操作没有完成',
          summary: message,
          details: ['原任务和已填写内容均已保留，可以稍后重试。'],
        },
        notification: { reason: missingInput ? 'missing_required_input' : 'failure', message },
        errorCode,
      };
    };
    try {
      const response = await fetch(`/api/overseas/assistant-threads/${agentId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => null) as (AssistantActionResponse & { error?: string; message?: string }) | null;
      if (payload?.requestId && payload.card && payload.status) return payload;
      if (!response.ok) {
        return actionFailure(
          payload?.message || '助手操作暂时不可用。',
          payload?.error,
          response.status,
        );
      }
      return actionFailure('操作接口未返回可确认的结果。', 'assistant_action_invalid_response');
    } catch (error) {
      // Never make a failed deterministic route look like a successful
      // generic conversation. Only an explicit delegated/not_handled
      // response is allowed to fall through to the normal chat endpoint.
      return actionFailure(error instanceof Error ? error.message : '助手操作暂时不可用。');
    }
  }, []);

  const presentActionResponse = useCallback((
    agentId: OrbitAgentId,
    request: AssistantActionRequest,
    response: AssistantActionResponse,
  ) => {
    const existingCards = useAssistantStore.getState().threads[agentId].taskCards;
    const stableTaskId = actionResponseCardId(request, response, existingCards);
    const displayResponse = responseWithoutCrossObjectActions(request, response);
    upsertTaskCard(agentId, actionCardToTaskCard(displayResponse.card, displayResponse, stableTaskId));
    const refreshCurrentStatus = () => {
      const mutationSucceeded = response.status === 'accepted' || response.status === 'completed';
      const workflowMutated = response.actionId !== 'delegate_to_agent'
        && WORKFLOW_MUTATION_ACTIONS.has(response.actionId);
      // The mutation endpoint deliberately returns only actions for the
      // mutated object. Always re-read status after a successful workflow
      // mutation so a newly-created next decision is fetched independently.
      if (!workflowMutated || !mutationSucceeded) return;
      const threadAfterMutation = useAssistantStore.getState().threads[agentId];
      const statusRequest: AssistantActionRequest = {
        source: 'button',
        requestId: requestId(),
        actionId: 'view_status',
        page,
      };
      void executeAssistantAction(agentId, statusRequest).then(statusResponse => {
        if (
          useAssistantStore.getState().threads[agentId] !== threadAfterMutation
          || !statusResponse
          || statusResponse.status === 'not_handled'
          || statusResponse.status === 'delegated'
          || statusResponse.status === 'failed'
          || statusResponse.status === 'stale_action'
        ) return;
        upsertTaskCard(
          agentId,
          actionCardToTaskCard(statusResponse.card, statusResponse, CURRENT_STATUS_TASK_ID),
        );
        focusTaskCard(agentId, CURRENT_STATUS_TASK_ID);
        setPanelView('chat');
        setMode('chat');
        persistThread(agentId);
      });
    };
    const notificationReason = notificationReasonFromResponse(response);
    if (!shouldNotifyAssistant(notificationReason)) {
      // This callback handles direct user actions. Keep routine success silent
      // (no unread badge or speech bubble), but keep the signed task card as a
      // summary bubble in the conversation so the user chooses when to open it.
      focusTaskCard(agentId, stableTaskId);
      setPanelView('chat');
      setMode('chat');
      refreshCurrentStatus();
      return;
    }
    focusTaskCard(agentId, stableTaskId);
    setPanelView('chat');
    setMode('chat');
    if (response.notification) {
      const current = useAssistantStore.getState().threads[agentId];
      setUnreadCount(agentId, current.unreadCount + 1);
      setSpeechBubble({ id: Date.now(), message: response.notification.message });
    }
    refreshCurrentStatus();
  }, [executeAssistantAction, focusTaskCard, page, persistThread, setUnreadCount, upsertTaskCard]);

  const send = useCallback(async (
    text: string,
    routeAgent = currentPageAgent,
    forcedContext?: AssistantContext,
    uploadedAttachments: UploadedAssistantAttachment[] = [],
  ) => {
    const userText = text.trim();
    if ((!userText && !uploadedAttachments.length) || loading) return;
    const requestFence = persistenceFenceRef.current;
    const requestToken = getToken();
    const currentScope = () => (
      requestFence.active
      && persistenceFenceRef.current === requestFence
      && requestToken === getToken()
    );
    const visibleText = userText || '请基于这次附件继续处理。';
    const visibleAttachmentSummary = uploadedAttachments.length
      ? `\n\n附件（已保存到我的素材）：${uploadedAttachments.map(item => item.name).join('、')}`
      : '';
    const visibleMessage = `${visibleText}${visibleAttachmentSummary}`;

    const threadAgent = PRIMARY_ASSISTANT_THREAD;
    const thread = useAssistantStore.getState().threads[threadAgent];
    const context = forcedContext ?? contextForOrbit(routeAgent, pageContext);
    const strategyRequest = agentForOrbit(routeAgent) === 'strategy';
    const enterpriseBrief = compactText(enterpriseContext);
    const conversationContext = selectAssistantConversationContext(mergeConsecutiveAssistant(thread.messages));
    const historyForApi = conversationContext.messages;
    const nextVisible = [...mergeConsecutiveAssistant(thread.messages), { role: 'user' as const, content: visibleMessage }];
    setMessages(threadAgent, nextVisible);
    setDraftInput(threadAgent, '');
    setFollowingLatest(threadAgent, true);
    setLoading(true);
    openAgent(routeAgent, 'chat');

    const focusedCard = thread.focusedTaskId ? thread.taskCards[thread.focusedTaskId] ?? null : null;
    // Attachments deliberately bypass the deterministic action router. The
    // router accepts only server-signed business object/version inputs; a
    // newly uploaded material must never be guessed into those parameters.
    const focusedMutationActionId = uploadedAttachments.length ? undefined : focusedNaturalLanguageActionId(visibleText);
    const focusedActionInput = focusedMutationActionId
      ? focusedNaturalLanguageActionInput(focusedCard, focusedMutationActionId)
      : undefined;
    const signedFocusedMutationActionId = focusedActionInput ? focusedMutationActionId : undefined;

    const deterministicRequest: AssistantActionRequest = {
      source: 'natural_language',
      requestId: requestId(),
      text: visibleText,
      page,
      ...(signedFocusedMutationActionId ? { actionId: signedFocusedMutationActionId } : {}),
      ...(focusedActionInput ?? {}),
    };
    const actionResponse = uploadedAttachments.length
      ? null
      : await executeAssistantAction(
        threadAgent,
        deterministicRequest,
        signedFocusedMutationActionId ? { deterministicActionId: signedFocusedMutationActionId } : undefined,
      );
    if (!currentScope()) return;
    if (actionResponse && actionResponse.status !== 'delegated' && actionResponse.status !== 'not_handled') {
      presentActionResponse(threadAgent, deterministicRequest, actionResponse);
      setLoading(false);
      persistThread(threadAgent);
      onSessionRefresh?.();
      return;
    }

    const liveIntegrationFacts = strategyRequest ? '' : await loadLiveIntegrationFacts();
    if (!currentScope()) return;
    const apiMessages: Message[] = [
      ...historyForApi,
      {
        role: 'user',
        content: [
          `【当前页面导航提示${strategyRequest ? '，未经后端核验，不得作为经营事实' : ''}】${context.summary}`,
          `【当前模块】${context.label}`,
          `【当前时间】${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。未注明年份时，“当前/最新/近期/今年”均指当前年份；不得把 2024 年或更早的公开数据表述为当前数据。`,
          ...(!strategyRequest ? [
            enterpriseBrief ? `【企业中心摘要】${enterpriseBrief}` : '【企业中心摘要】当前未读取到企业中心资料。',
            `【实时接入事实】\n${liveIntegrationFacts}`,
          ] : []),
          uploadedAttachments.length
            ? [
              '【本次附件】以下文件已通过真实“我的素材”上传接口完成租户内持久化：',
              ...uploadedAttachments.map(item => `- ${item.name}｜${item.kind}｜${item.size} bytes｜material:${item.materialId}${item.materialUrl ? `｜${item.materialUrl}` : ''}`),
              '【附件事实边界】本轮只确认文件名、类型、大小、素材编号和链接；除非下游能力真实读取并返回证据，否则不得声称已经看见、听见或分析附件内容。',
            ].join('\n')
            : '',
          strategyRequest
            ? '【经营事实要求】经营事实以服务端当前租户核验数据为准；历史聊天、页面导航提示和历史助手回答均不是已核验经营事实。明确引用用户提供的事实时说明来源。缺少后端证据表示本次未核验到，不代表业务未发生或数量为零。描述、MOQ、价格、交期、认证和语种不得猜测。'
            : '【经营事实要求】描述、脚本、卖点、市场、客户、MOQ、价格、交期、认证、联系方式和语种，只能使用企业中心摘要、用户明确输入或当前页面真实素材证据。语种必须沿用企业中心主要业务语言/首选输出语言，禁止根据地区自行推断。没有来源的经营细节直接省略，不要用示例补齐。',
          '【联网要求】涉及外贸行业趋势、目标市场、平台规则、竞品或品类机会时，请联网检索公开来源，并在回答中保留可核验来源；不要把假设当成事实。',
          '【连续对话要求】承接已提供的对话和真实数据。证据不足或过期时，直接说明哪些结论无法确认，并给出可执行的核验步骤；区分事实、建议与待确认事项，禁止编造完成状态或数字。',
          renderAssistantConversationBoundary(conversationContext),
          `【回答与操作规范】\n${ASSISTANT_RESPONSE_CONTRACT}\n${ASSISTANT_NOTIFICATION_POLICY}`,
          `用户问题：${visibleText}`,
        ].join('\n'),
      },
    ];

    let assistantStarted = false;
    const ensureAssistant = () => {
      if (!currentScope()) return;
      if (assistantStarted) return;
      assistantStarted = true;
      const current = useAssistantStore.getState().threads[threadAgent].messages;
      setMessages(threadAgent, [...current, { role: 'assistant', content: '' }]);
      setLoading(false);
    };
    const patchAssistant = (patch: (msg: Message) => Message) => {
      if (!currentScope()) return;
      ensureAssistant();
      if (!assistantStarted) return;
      const current = [...useAssistantStore.getState().threads[threadAgent].messages];
      current[current.length - 1] = patch(current[current.length - 1]);
      setMessages(threadAgent, current);
    };

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const resp = await fetch(API_PATH[agentForOrbit(routeAgent)], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          messages: apiMessages,
          deepThinking: false,
          ...(strategyRequest ? {
            userQuestion: visibleText,
            pageContext: { label: context.label, summary: compactText(context.summary, 2000) },
            conversationContext: {
              omittedTurns: conversationContext.omittedTurns,
              retainedUserInstructions: conversationContext.retainedUserInstructions,
            },
          } : {}),
        }),
        signal: controller.signal,
      });
      if (!currentScope()) return;
      if (!resp.ok) throw new Error(await responseErrorMessage(resp));
      if (!resp.body) throw new Error('模型响应为空，请稍后重试。');
      ensureAssistant();
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consumeLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const obj = JSON.parse(payload) as { text?: string; sources?: { title: string; uri: string }[]; error?: string };
          if (obj.text) patchAssistant(msg => ({ ...msg, content: msg.content + obj.text }));
          else if (obj.sources?.length) patchAssistant(msg => ({ ...msg, sources: obj.sources }));
          else if (obj.error) patchAssistant(msg => ({ ...msg, content: msg.content || `模型连接断开：${obj.error}` }));
        } catch {
          // Ignore malformed stream chunks.
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
      }
      if (buffer.trim()) consumeLine(buffer);
    } catch (err: any) {
      if (!currentScope()) return;
      const message = err?.name === 'AbortError' ? '这次响应已停止。' : (err?.message || '请求失败，请稍后重试。');
      if (assistantStarted) patchAssistant(msg => ({ ...msg, content: msg.content ? `${msg.content}\n\n${message}` : message }));
      else setMessages(threadAgent, [...useAssistantStore.getState().threads[threadAgent].messages, { role: 'assistant', content: message }]);
    } finally {
      if (currentScope()) {
        setLoading(false);
        abortRef.current = null;
        persistThread(threadAgent);
        onSessionRefresh?.();
      }
    }
  }, [currentPageAgent, enterpriseContext, executeAssistantAction, loading, onSessionRefresh, openAgent, page, pageContext, persistThread, presentActionResponse, setDraftInput, setFollowingLatest, setMessages]);

  const sendComposerMessage = useCallback(async () => {
    if (loading || attachmentUploading) return;
    const draft = activeThread.draftInput;
    const files = [...pendingAttachments];
    if (!draft.trim() && !files.length) return;
    if (!files.length) {
      void send(draft);
      return;
    }

    setAttachmentError('');
    setAttachmentUploading(true);
    try {
      const uploaded: UploadedAssistantAttachment[] = [];
      for (const file of files) {
        const cached = uploadedAttachmentCacheRef.current.get(file);
        if (cached) {
          uploaded.push(cached);
          continue;
        }
        const kind = assistantAttachmentKind(file);
        if (!kind) throw new Error(`${file.name} 不是可上传的图片、视频或音频。`);
        const result = await studioApi.uploadMaterialFile(file, {
          folder: 'assistant',
          type: kind,
          sourceType: 'assistant-chat',
        });
        if (!result.ok || !result.material?.id) {
          throw new Error(result.error || `${file.name} 上传失败，请重试。`);
        }
        const attachment: UploadedAssistantAttachment = {
          name: file.name,
          size: file.size,
          kind,
          materialId: result.material.id,
          ...(result.material.url ? { materialUrl: result.material.url } : {}),
        };
        uploadedAttachmentCacheRef.current.set(file, attachment);
        uploaded.push(attachment);
      }
      setPendingAttachments([]);
      setAttachmentUploading(false);
      void send(draft, currentPageAgent, undefined, uploaded);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件上传失败，请重试。');
      setAttachmentUploading(false);
    }
  }, [activeThread.draftInput, attachmentUploading, currentPageAgent, loading, pendingAttachments, send]);

  const handleTaskCardAction = useCallback(async (
    card: AssistantTaskCard,
    action: NonNullable<AssistantTaskCard['primaryAction']>,
  ) => {
    if (action.disabled) return;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-action', {
      detail: { agentId: activeAgent, taskId: card.taskId, actionId: action.id },
    }));
    if (action.actionId) {
      const parameters = action.parameters;
      const request: AssistantActionRequest = {
        source: 'button',
        requestId: requestId(),
        actionId: action.actionId,
        page,
        target: action.target,
        ...(parameters ? { parameters } : {}),
      };
      setLoading(true);
      const response = await executeAssistantAction(activeAgent, request);
      setLoading(false);
      if (response) {
        presentActionResponse(activeAgent, request, response);
        persistThread(activeAgent);
        onSessionRefresh?.();
      }
      return;
    }
    if (action.prompt) {
      setPanelView('chat');
      void send(action.prompt, currentPageAgent);
      return;
    }
    if (action.href) window.location.assign(action.href);
  }, [activeAgent, currentPageAgent, executeAssistantAction, onSessionRefresh, page, persistThread, presentActionResponse, send]);

  const persistRecoveredThread = useCallback(() => {
    persistThread(PRIMARY_ASSISTANT_THREAD, 'retry');
  }, [persistThread]);

  useEffect(() => {
    if (assistantThreadHydrationStartedRef.current) return undefined;
    assistantThreadHydrationStartedRef.current = true;
    let cancelled = false;
    const journal = readAssistantThreadJournal(
      window.localStorage,
      stablePersistenceScope,
      PRIMARY_ASSISTANT_THREAD,
    );
    // A keyed component instance starts from an empty scoped thread, then
    // recovers only the matching tenant + user + agent journal. This prevents
    // Zustand state from a prior login/support scope flashing into this one.
    hydrateThread(PRIMARY_ASSISTANT_THREAD, journal ?? emptyAssistantThread());
    const threadBeforeRequest = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
    fetch('/api/overseas/assistant-threads', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(async data => {
        if (cancelled) return;
        const localChangedWhileLoading = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD] !== threadBeforeRequest;
        const latestLocal = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
        if (!Array.isArray(data?.items)) {
          if (journal) persistRecoveredThread();
          return;
        }
        const item = data.items.find((candidate: { agentId?: unknown } | null) => candidate?.agentId === PRIMARY_ASSISTANT_THREAD);
        const remote = item ? persistedAssistantThread({
          version: Number.isSafeInteger(Number(item.version)) ? Number(item.version) : 0,
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
          messages: Array.isArray(item.messages) ? item.messages : [],
          draftInput: typeof item.draftInput === 'string' ? item.draftInput : '',
          scrollPosition: Number(item.scrollPosition ?? 0),
          unreadCount: Number(item.unreadCount ?? 0),
          isFollowingLatest: typeof item.isFollowingLatest === 'boolean' ? item.isFollowingLatest : true,
          paused: typeof item.paused === 'boolean' ? item.paused : false,
          taskCards: item.taskCards && typeof item.taskCards === 'object' ? item.taskCards : {},
          focusedTaskId: typeof item.focusedTaskId === 'string' ? item.focusedTaskId : null,
        }, emptyAssistantThread()) : null;
        const merged = remote
          ? (journal || localChangedWhileLoading ? mergeAssistantThread(remote, latestLocal) : remote)
          : latestLocal;
        hydrateThread(PRIMARY_ASSISTANT_THREAD, merged);
        const hydratedThread = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD];
        const persistedFocusedTaskId = hydratedThread.focusedTaskId;

        if (journal) persistRecoveredThread();

        // Thread storage intentionally keeps presentation state only. Re-read
        // the authoritative workspace after hydration and place its freshly
        // signed actions on a dedicated current-status card. Never bind an
        // arbitrary current decision to the ID of a possibly stale old card.
        if (!persistedFocusedTaskId) return;
        const request: AssistantActionRequest = {
          source: 'button',
          requestId: requestId(),
          actionId: 'view_status',
          page: initialAssistantPageRef.current,
        };
        const response = await executeAssistantAction(PRIMARY_ASSISTANT_THREAD, request);
        if (
          cancelled
          || useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD] !== hydratedThread
          || !response
          || response.status === 'not_handled'
          || response.status === 'delegated'
          || response.status === 'failed'
          || response.status === 'stale_action'
        ) return;
        upsertTaskCard(
          PRIMARY_ASSISTANT_THREAD,
          actionCardToTaskCard(response.card, response, CURRENT_STATUS_TASK_ID),
        );
        focusTaskCard(PRIMARY_ASSISTANT_THREAD, CURRENT_STATUS_TASK_ID);
      })
      .catch(() => {
        if (!cancelled && journal) persistRecoveredThread();
      });
    return () => {
      cancelled = true;
    };
  }, [executeAssistantAction, focusTaskCard, hydrateThread, persistRecoveredThread, stablePersistenceScope, upsertTaskCard]);

  useEffect(() => {
    let cancelled = false;
    const requestFence = persistenceFenceRef.current;
    const requestToken = getToken();
    const currentScope = () => (
      !cancelled
      && requestFence.active
      && persistenceFenceRef.current === requestFence
      && requestToken === getToken()
    );
    setEnterpriseContext('');
    fetch('/api/overseas/enterprise/context', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (currentScope() && typeof data?.context === 'string') setEnterpriseContext(data.context);
      })
      .catch(() => { if (currentScope()) setEnterpriseContext(''); });
    return () => { cancelled = true; };
  }, [persistenceScopeKey]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AssistantContext>>).detail;
      if (!detail?.agent || !detail.label || !detail.summary) return;
      setLiveContext({
        agent: detail.agent,
        label: detail.label,
        summary: detail.summary,
        suggestions: detail.suggestions?.length ? detail.suggestions : DEFAULT_CONTEXT[pageKey(page)]?.suggestions ?? DEFAULT_CONTEXT.strategy.suggestions,
        pendingCount: typeof detail.pendingCount === 'number' ? detail.pendingCount : undefined,
        todoItems: Array.isArray(detail.todoItems) ? detail.todoItems : undefined,
      });
    };
    window.addEventListener('lingshu-assistant-context', handler);
    return () => window.removeEventListener('lingshu-assistant-context', handler);
  }, [page]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        agentId?: OrbitAgentId;
        agent?: AgentType;
        card?: AssistantTaskCardInput;
      }>).detail;
      if (!detail?.card?.taskId) return;
      const targetAgent = PRIMARY_ASSISTANT_THREAD;
      upsertTaskCard(targetAgent, detail.card);
      if (!shouldNotifyAssistant(detail.card.notificationReason)) return;
      focusTaskCard(targetAgent, detail.card.taskId);
      const thread = useAssistantStore.getState().threads[targetAgent];
      setUnreadCount(targetAgent, thread.unreadCount + 1);
      setSpeechBubble({ id: Date.now(), message: detail.card.conclusion });
      if (mode !== 'chat') setMode('breathing');
    };
    window.addEventListener('lingshu-assistant-card', handler);
    return () => window.removeEventListener('lingshu-assistant-card', handler);
  }, [focusTaskCard, mode, setUnreadCount, upsertTaskCard]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        active?: boolean;
        phase?: string;
        message?: string;
        reason?: AssistantNotificationReason;
      }>).detail;
      if (!detail?.active) {
        setPerformance(null);
        setPerformanceHidden(false);
        setPerformanceLineIndex(0);
        return;
      }
      const reason = detail.reason ?? 'routine';
      if (!shouldNotifyAssistant(reason)) {
        setPerformance(null);
        setPerformanceHidden(false);
        setPerformanceLineIndex(0);
        return;
      }
      setPerformance({ phase: detail.phase || 'default', message: detail.message?.trim() || undefined, reason });
      setPerformanceHidden(false);
      setPerformanceLineIndex(0);
    };
    window.addEventListener('lingshu-assistant-performance', handler);
    return () => window.removeEventListener('lingshu-assistant-performance', handler);
  }, []);

  useEffect(() => {
    if (!performance || performance.message) return;
    const timer = window.setInterval(() => setPerformanceLineIndex(index => index + 1), 3_800);
    return () => window.clearInterval(timer);
  }, [performance]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        message?: string;
        durationMs?: number;
        reason?: AssistantNotificationReason;
      }>).detail;
      const message = detail?.message?.trim();
      if (!message) return;
      if (!shouldNotifyAssistant(detail.reason ?? 'routine')) return;
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
      setSpeechBubble({ id: Date.now(), message });
      setMode('breathing');
      const durationMs = Math.max(2_500, Math.min(15_000, Number(detail.durationMs || 7_000)));
      speechTimerRef.current = window.setTimeout(() => setSpeechBubble(null), durationMs);
    };
    window.addEventListener('lingshu-assistant-say', handler);
    return () => {
      window.removeEventListener('lingshu-assistant-say', handler);
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!primaryEntry || compactMode) return;
    try {
      if (window.localStorage.getItem(ASSISTANT_PRIMARY_ENTRY_SEEN_KEY) === 'true') return;
      window.localStorage.setItem(ASSISTANT_PRIMARY_ENTRY_SEEN_KEY, 'true');
    } catch {
      // Storage is optional; the primary entry remains usable without it.
    }
    setSpeechBubble({ id: Date.now(), message: '告诉灵小枢你想完成什么，我会把目标变成计划并陪你推进。' });
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    speechTimerRef.current = window.setTimeout(() => setSpeechBubble(null), 12_000);
  }, [compactMode, primaryEntry]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; assistantText?: string; context?: Partial<AssistantContext>; tool?: AssistantTool }>).detail;
      let targetContext = pageContext;
      if (detail?.context?.agent && detail.context.label && detail.context.summary) {
        targetContext = {
          agent: detail.context.agent,
          label: detail.context.label,
          summary: detail.context.summary,
          suggestions: detail.context.suggestions?.length ? detail.context.suggestions : pageContext.suggestions,
          pendingCount: typeof detail.context.pendingCount === 'number' ? detail.context.pendingCount : pageContext.pendingCount,
          todoItems: Array.isArray(detail.context.todoItems) ? detail.context.todoItems : pageContext.todoItems,
        };
        setLiveContext(targetContext);
      }
      const routeAgent = orbitIdForAgent(targetContext.agent, currentPageAgent);
      openAgent(routeAgent, 'chat');
      if (detail?.tool === 'knowledge-intake') setAssistantTool('knowledge-intake');
      const assistantText = detail?.assistantText?.trim();
      if (assistantText) {
        const current = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
        setMessages(PRIMARY_ASSISTANT_THREAD, [...current, { role: 'assistant', content: assistantText }]);
      }
      const text = detail?.text?.trim();
      if (text) window.setTimeout(() => void send(text, routeAgent, targetContext), 0);
    };
    window.addEventListener('lingshu-assistant-open', handler);
    return () => window.removeEventListener('lingshu-assistant-open', handler);
  }, [currentPageAgent, openAgent, pageContext, send]);

  useEffect(() => {
    if (!kickoff || handledKickoffs.current.has(kickoff.key)) return;
    handledKickoffs.current.add(kickoff.key);
    void send(kickoff.text, orbitIdForAgent(kickoff.agent, currentPageAgent));
    onKickoffConsumed?.();
  }, [currentPageAgent, kickoff, onKickoffConsumed, send]);

  useEffect(() => {
    if (!restore || handledRestores.current.has(restore.key)) return;
    handledRestores.current.add(restore.key);
    const routeAgent = orbitIdForAgent(restore.agent, currentPageAgent);
    setMessages(PRIMARY_ASSISTANT_THREAD, mergeConsecutiveAssistant(restore.messages));
    openAgent(routeAgent, 'chat');
  }, [currentPageAgent, openAgent, restore, setMessages]);

  useEffect(() => {
    if (mode !== 'chat' || panelView !== 'chat') return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = messageScrollRef.current;
      if (!scroller) return;
      if (!activeThread.isFollowingLatest) scroller.scrollTop = activeThread.scrollPosition;
      else scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAgent, mode, panelView]);

  useEffect(() => {
    if (mode !== 'chat' || panelView !== 'chat' || !activeThread.isFollowingLatest) return;
    const scroller = messageScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [activeThread.isFollowingLatest, activeThread.messages, mode, panelView]);

  useEffect(() => {
    if (mode !== 'chat') return;
    const frame = window.requestAnimationFrame(() => document.getElementById('global-assistant-panel')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    const input = assistantInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 88)}px`;
  }, [activeAgent, activeThread.draftInput, mode, panelView]);

  useEffect(() => {
    setLiveContext(null);
    setDecisionTotal(null);
  }, [page]);

  useEffect(() => {
    if (page === 'enterprise' || assistantTool !== 'knowledge-intake') return;
    setAssistantTool(null);
    setMode('breathing');
  }, [assistantTool, page]);

  useEffect(() => {
    if (mode !== 'chat') return;
    const timer = window.setTimeout(() => persistThread(activeAgent), 500);
    return () => window.clearTimeout(timer);
  }, [activeAgent, activeThread.draftInput, activeThread.focusedTaskId, activeThread.isFollowingLatest, activeThread.messages, activeThread.paused, activeThread.scrollPosition, activeThread.taskCards, activeThread.unreadCount, mode, persistThread]);

  const closeAssistant = useCallback(() => {
    persistThread(activeAgent);
    setAssistantTool(null);
    setPanelView('chat');
    setMode('breathing');
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus());
  }, [activeAgent, persistThread]);

  const returnToConversation = useCallback(() => {
    const thread = useAssistantStore.getState().threads[activeAgent];
    setPanelView('chat');
    window.requestAnimationFrame(() => {
      const scroller = messageScrollRef.current;
      if (!scroller) return;
      if (!thread.isFollowingLatest) scroller.scrollTop = thread.scrollPosition;
      else scroller.scrollTop = scroller.scrollHeight;
    });
  }, [activeAgent]);

  const toggleTaskPaused = useCallback(async () => {
    if (!focusedRunControl || loading) return;
    const paused = focusedRunControl.actionId === 'pause_task';
    const request: AssistantActionRequest = {
      source: 'button',
      requestId: requestId(),
      actionId: focusedRunControl.actionId,
      page,
      target: focusedRunControl.target,
    };
    setLoading(true);
    const response = await executeAssistantAction(activeAgent, request);
    setLoading(false);
    if (!response) return;
    presentActionResponse(activeAgent, request, response);
    const accepted = response.status === 'accepted' || response.status === 'completed';
    if (!accepted) {
      persistThread(activeAgent);
      return;
    }
    if (paused) abortRef.current?.abort();
    window.dispatchEvent(new CustomEvent('lingshu-assistant-task-control', {
      detail: { agentId: activeAgent, taskId: focusedRunControl.target.objectId, paused },
    }));
    persistThread(activeAgent);
    onSessionRefresh?.();
  }, [activeAgent, executeAssistantAction, focusedRunControl, loading, onSessionRefresh, page, persistThread, presentActionResponse]);

  const handleLauncherClick = () => {
    if (mode === 'chat') {
      closeAssistant();
      return;
    }
    if (assistantTool === 'knowledge-intake') {
      setMode('chat');
      return;
    }
    openCurrentPageAgent();
  };

  useEffect(() => {
    if (mode !== 'chat' && assistantTool !== 'knowledge-intake') return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      closeAssistant();
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [assistantTool, closeAssistant, mode]);

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (suppressForRightSidebar) return null;

  return (
    <div
      data-global-assistant="root"
      className={`fixed right-4 z-[75] md:bottom-5 md:right-5 ${page === 'conversion' ? 'bottom-[calc(env(safe-area-inset-bottom)+8rem)]' : 'bottom-[calc(env(safe-area-inset-bottom)+1rem)]'}`}
    >
      <AnimatePresence>
        {mode === 'breathing' && performance && shouldNotifyAssistant(performance.reason) && !performanceHidden && (
          <motion.div
            key={`performance-${performance.phase}`}
            data-assistant-surface="floating-reminder"
            data-lingshu-assistant-performance={performance.phase}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={fadeExit}
            transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-30 w-[248px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{
              width: Math.min(248, viewport.width - 104),
              maxWidth: 'calc(100vw - 176px)',
            }}
          >
            <button
              type="button"
              onClick={() => setPerformanceHidden(true)}
              className="absolute right-2 top-2 rounded-md p-1 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
              aria-label="隐藏灵小枢等待提示"
              title="先隐藏"
            >
              <X size={13} />
            </button>
            <p className="ls-type-label-medium pr-6 text-accent">灵小枢陪你等</p>
            <p className="ls-type-body-small mt-1 text-text-secondary">{performanceMessage}</p>
            <span className="ls-type-label-medium mt-2 inline-flex items-center gap-1.5 text-accent"><Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />处理中</span>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'breathing' && (!performance || performanceHidden || !shouldNotifyAssistant(performance.reason)) && speechBubble && (
          <motion.div
            key={`speech-${speechBubble.id}`}
            data-assistant-surface="floating-reminder"
            data-lingshu-assistant-speech="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={fadeExit}
            transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-30 w-[248px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{
              width: Math.min(248, viewport.width - 104),
              maxWidth: 'calc(100vw - 176px)',
            }}
          >
            <p className="ls-type-label-medium text-accent">灵小枢</p>
            <p className="ls-type-body-small mt-1 text-text-secondary">{speechBubble.message}</p>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'breathing' && (!performance || performanceHidden || !shouldNotifyAssistant(performance.reason)) && !speechBubble && featureGuide && (
          <motion.div
            key={featureGuide.id}
            data-assistant-surface="floating-reminder"
            data-lingshu-guide-bubble={featureGuide.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={fadeExit}
            transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-20 w-[236px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{
              width: Math.min(236, viewport.width - 104),
              maxWidth: 'calc(100vw - 176px)',
            }}
          >
            <button type="button" onClick={() => setFeatureGuide(null)} className="absolute right-2.5 top-2.5 rounded-lg p-1 text-text-muted hover:bg-surface-2" aria-label="关闭用法提示">
              <X size={13} />
            </button>
            <div className="pr-6">
              <p className="ls-type-label-medium text-accent">{featureGuide.title}</p>
              <p className="ls-type-body-small mt-1 text-text-secondary">{featureGuide.message}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const agentId = orbitIdForAgent(featureGuide.agent, currentPageAgent);
                setFeatureGuide(null);
                openAgent(agentId);
              }}
              className="ls-type-label-medium mt-2 text-accent hover:text-accent-dim"
            >
              问问灵小枢 →
            </button>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {page === 'enterprise' && mode === 'breathing' && enterpriseGuideSeen && !featureGuide && !speechBubble && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={fadeExit}
            transition={fadeTransition}
            onClick={openCurrentPageAgent}
            className="ls-type-label-medium absolute bottom-2 right-[calc(100%+8px)] z-10 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-accent shadow-sm hover:border-accent/30 hover:bg-accent-glow"
          >
            要补资料？点我
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(mode === 'chat' || assistantTool === 'knowledge-intake') && (
          <motion.section
            data-global-assistant="panel"
            id="global-assistant-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby="global-assistant-panel-title"
            aria-describedby="global-assistant-panel-description"
            tabIndex={-1}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={mode === 'chat' ? { opacity: 1, y: 0 } : { opacity: 0, y: reduceMotion ? 0 : 8 }}
            exit={{ y: reduceMotion ? 0 : 8, opacity: 0, transition: { ...spatialTransition, opacity: fadeExit.transition } }}
            transition={spatialTransition}
            className={`absolute bottom-14 right-0 z-10 flex max-h-[calc(100dvh-env(safe-area-inset-bottom)-96px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl outline-none ${assistantTool === 'knowledge-intake' ? 'w-[560px]' : 'w-[420px]'} ${mode === 'chat' ? 'pointer-events-auto visible' : 'pointer-events-none invisible'}`}
            style={{
              height: assistantPanelHeight,
              width: assistantPanelWidth,
              maxWidth: 'calc(100vw - 32px)',
            }}
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-gradient-to-r from-blue-50 via-violet-50 to-pink-50 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (assistantTool === 'knowledge-intake') {
                      setAssistantTool(null);
                      returnToConversation();
                    } else if (panelView !== 'chat') returnToConversation();
                    else closeAssistant();
                  }}
                  className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={assistantTool === 'knowledge-intake' || panelView !== 'chat' ? '返回灵小枢对话' : '收起灵小枢对话'}
                  title={assistantTool === 'knowledge-intake' || panelView !== 'chat' ? '返回灵小枢对话' : '收起灵小枢对话'}
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p id="global-assistant-panel-title" className="ls-type-title-small truncate text-text-primary">{panelTitle}</p>
                  <p id="global-assistant-panel-description" className="ls-type-body-small truncate text-text-muted">{panelSubtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!assistantTool && panelView === 'decision' && focusedRunControl && (
                  <button
                    type="button"
                    onClick={() => void toggleTaskPaused()}
                    disabled={loading}
                    className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title={focusedRunControl.actionId === 'resume_task' ? '继续当前任务' : '暂停当前任务'}
                    aria-label={focusedRunControl.actionId === 'resume_task' ? '继续当前任务' : '暂停当前任务'}
                  >
                    {focusedRunControl.actionId === 'resume_task' ? <Play size={15} /> : <Pause size={15} />}
                  </button>
                )}
                <button type="button" onClick={closeAssistant} className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" title="关闭窗口（任务继续）" aria-label="关闭灵枢助手窗口，任务继续运行">
                  <X size={15} />
                </button>
              </div>
            </header>

            {assistantTool === 'knowledge-intake' ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-3">
                <KnowledgeIntakePanel
                  mode="center"
                  compact
                  onApplied={(profile: AppliedProfile) => {
                    window.dispatchEvent(new CustomEvent('lingshu:knowledge-intake-applied', { detail: { profile } }));
                    onSessionRefresh?.();
                  }}
                />
              </div>
            ) : panelView === 'approvals' ? (
              <motion.div
                data-assistant-surface="decision"
                data-assistant-page="decision-detail"
                initial={{ opacity: 0, x: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={spatialTransition}
                className="min-h-0 flex-1 overflow-y-auto bg-surface-2 p-4"
              >
                <AssistantDecisionCenter
                  page={page}
                  key={`${persistenceScopeKey}:${page}:detail`}
                  active={mode === 'chat'}
                  onOpenChat={returnToConversation}
                  onFeedChange={handleDecisionFeedChange}
                  variant="detail"
                />
              </motion.div>
            ) : panelView === 'decision' && focusedTaskCard ? (
              <div
                data-assistant-surface="decision"
                className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-4 py-4"
              >
                <article className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="ls-type-label-medium text-accent">灵小枢已整理</p>
                      <h3 className="ls-type-title-medium mt-1 text-text-primary">{focusedTaskCard.title}</h3>
                    </div>
                    <span className="ls-type-label-medium shrink-0 rounded-full border border-border bg-surface-2 px-2 py-1 text-text-secondary">
                      {taskStatusLabel(focusedTaskCard)}
                    </span>
                  </div>

                  <p className="ls-type-body-medium mt-4 font-semibold text-text-primary">{focusedTaskCard.conclusion}</p>
                  {focusedTaskCard.details.length > 0 && (
                    <ul className="mt-3 space-y-2 border-l-2 border-accent/30 pl-3">
                      {focusedTaskCard.details.map(detail => (
                        <li key={detail} className="ls-type-body-small text-text-secondary">{detail}</li>
                      ))}
                    </ul>
                  )}

                  {focusedTaskCard.items.length > 0 && (
                    <div className="mt-4 space-y-2" aria-label="待调整视频">
                      {focusedTaskCard.items.map(item => (
                        <div key={item.id} className="flex min-w-0 gap-3 rounded-md border border-border bg-surface-2 p-2.5">
                          <div className="h-16 w-12 shrink-0 overflow-hidden rounded bg-surface-3">
                            {item.thumbnailUrl ? (
                              <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="ls-type-label-small flex h-full items-center justify-center px-1 text-center text-text-muted">暂无缩略图</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="ls-type-label-medium line-clamp-2 text-text-primary">{item.title}</p>
                            {item.accountLabel && <p className="ls-type-body-small mt-1 truncate text-text-muted">{item.accountLabel}</p>}
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {item.transition && <span className="ls-type-label-small rounded bg-accent-glow px-1.5 py-0.5 text-accent">{item.transition}</span>}
                              {item.note && <span className="ls-type-label-small rounded bg-surface px-1.5 py-0.5 text-text-secondary">{item.note}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(focusedTaskCard.primaryAction || focusedTaskCard.secondaryActions.length > 0) && (
                    <div className="mt-5 grid gap-2">
                      {focusedTaskCard.primaryAction && (
                        <button
                          type="button"
                          disabled={focusedTaskCard.primaryAction.disabled || loading}
                          onClick={() => void handleTaskCardAction(focusedTaskCard, focusedTaskCard.primaryAction!)}
                          className="btn-primary ls-type-label-large w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                        >
                          {focusedTaskCard.primaryAction.label}
                        </button>
                      )}
                      {focusedTaskCard.secondaryActions.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {focusedTaskCard.secondaryActions.map(action => (
                            <button
                              key={action.id}
                              type="button"
                              disabled={action.disabled || loading}
                              onClick={() => void handleTaskCardAction(focusedTaskCard, action)}
                              className="ls-type-label-medium rounded-md border border-border bg-surface px-3 py-2 text-text-secondary hover:border-accent/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {focusedTaskCard.workspace && (
                    <a
                      href={focusedTaskCard.workspace.href}
                      className="ls-type-label-medium mt-4 block rounded-md border border-border bg-surface-2 px-3 py-2 text-center text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {focusedTaskCard.workspace.label}
                    </a>
                  )}
                </article>
                <button
                  type="button"
                  onClick={returnToConversation}
                  className="ls-type-label-medium mt-3 w-full rounded-md px-3 py-2 text-text-muted hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  返回对话
                </button>
              </div>
            ) : isCustomerTodoView ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-3">
                  <div className="border-l-2 border-amber bg-amber-dim p-4">
                    <p className="ls-type-title-small text-text-primary">今日待办（{pendingCount}）</p>
                    <p className="ls-type-body-medium mt-2 text-text-secondary">
                      {pendingCount > 0 ? '需要你处理和确认的客户已按优先级排好。' : '今天的待办已处理完。'}
                    </p>
                    <button
                      type="button"
                      onClick={returnToConversation}
                      className="btn-primary ls-type-label-medium mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      客户助手
                    </button>
                  </div>

                  {orderedTodoItems.length > 0 ? (
                    <div className="space-y-2">
                      {orderedTodoItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('lingshu:select-customer', { detail: { id: item.id } }));
                            returnToConversation();
                          }}
                          className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${todoToneClass(item.tone, item.completed)}`}
                        >
                          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${todoDotClass(item.tone, item.completed)}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="ls-type-title-small truncate text-text-primary">{item.name}</span>
                              {item.completed && (
                                <span className="ls-type-label-medium inline-flex shrink-0 items-center gap-1 border-l-2 border-green bg-green/5 px-2 py-0.5 text-green">
                                  <CheckCircle2 size={11} /> 已完成
                                </span>
                              )}
                            </span>
                            <span className="ls-type-label-medium mt-1 block truncate opacity-80">{item.headline}</span>
                            <span className="ls-type-body-small mt-1 block line-clamp-2 text-text-secondary">{item.reason}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="ls-type-body-small rounded-lg border border-border bg-surface-2 px-3 py-4 text-center text-text-muted">
                      暂无今日待办
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div
                  ref={messageScrollRef}
                  data-assistant-surface="conversation"
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                  onScroll={event => {
                    const scroller = event.currentTarget;
                    setScrollPosition(activeAgent, scroller.scrollTop);
                    setFollowingLatest(
                      activeAgent,
                      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24,
                    );
                  }}
                >
                  <div className="space-y-4">
                    {!activeThread.messages.length && (
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>
                        <div className="ls-messenger-bubble ls-messenger-bubble--inbound">
                          <p className="font-semibold text-text-primary">我是{activeAgentLabel}</p>
                          <p className="mt-1 text-text-secondary">我会结合当前页面上下文继续帮你处理。</p>
                        </div>
                      </div>
                    )}

                    {activeThread.messages.map((msg, index) => (
                      <div key={index} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                        {msg.role === 'assistant' && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>}
                        <div className={msg.role === 'user'
                          ? 'ls-messenger-bubble ls-messenger-bubble--outbound whitespace-pre-line'
                          : 'ls-messenger-bubble ls-messenger-bubble--inbound'}>
                          {msg.role === 'assistant'
                            ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : <span className="opacity-40">...</span>)
                            : msg.content}
                        </div>
                      </div>
                    ))}

                    {loading && (
                      <div className="flex gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Loader2 size={13} className="motion-safe:animate-spin" /></div>
                        <div className="ls-messenger-bubble ls-messenger-bubble--inbound text-text-muted">思考中...</div>
                      </div>
                    )}

                    {focusedTaskCard && (
                      <div className="flex items-start gap-2" data-assistant-summary="task-card">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>
                        <button
                          type="button"
                          className="assistant-decision-summary min-w-0 flex-1"
                          onClick={() => {
                            focusTaskCard(activeAgent, focusedTaskCard.taskId);
                            setPanelView('decision');
                          }}
                          aria-label={`查看任务详情：${focusedTaskCard.title}`}
                        >
                          <span className="assistant-decision-summary__icon" aria-hidden="true"><Bot size={18} /></span>
                          <span className="assistant-decision-summary__content">
                            <span className="assistant-decision-summary__eyebrow">
                              <span>{focusedTaskCard.status === 'approval' || focusedTaskCard.status === 'needs_input' ? '待你决定' : '灵小枢已整理'}</span>
                              <span>{taskStatusLabel(focusedTaskCard)}</span>
                            </span>
                            <strong>{focusedTaskCard.title}</strong>
                            <span className="assistant-decision-summary__description">{focusedTaskCard.conclusion}</span>
                          </span>
                          <ArrowRight className="assistant-decision-summary__arrow" size={18} aria-hidden="true" />
                        </button>
                      </div>
                    )}

                    <div className="pl-9" data-assistant-summary="decision-feed">
                      <AssistantDecisionCenter
                        page={page}
                        key={`${persistenceScopeKey}:${page}:summary`}
                        active={mode === 'chat' && panelView === 'chat'}
                        onOpenChat={returnToConversation}
                        onOpenDetail={() => setPanelView('approvals')}
                        onFeedChange={handleDecisionFeedChange}
                        variant="summary"
                      />
                    </div>
                  </div>
                </div>

                {!activeThread.isFollowingLatest && (
                  <div className="flex shrink-0 justify-center border-t border-border/60 bg-surface px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const scroller = messageScrollRef.current;
                        if (scroller) scroller.scrollTop = scroller.scrollHeight;
                        setFollowingLatest(activeAgent, true);
                        setScrollPosition(activeAgent, scroller?.scrollHeight ?? activeThread.scrollPosition);
                      }}
                      className="ls-type-label-small inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-accent hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label="回到最新消息"
                    >
                      <ArrowDown size={12} /> 回到最新消息
                    </button>
                  </div>
                )}

                <AssistantComposer
                  ref={assistantInputRef}
                  draft={activeThread.draftInput}
                  files={pendingAttachments}
                  disabled={loading}
                  uploading={attachmentUploading}
                  error={attachmentError}
                  onDraftChange={value => setDraftInput(activeAgent, value)}
                  onFilesChange={files => {
                    setPendingAttachments(files);
                    if (!files.length) setAttachmentError('');
                  }}
                  onValidationError={setAttachmentError}
                  onSubmit={() => void sendComposerMessage()}
                />
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <Badge count={decisionTotal ?? pendingCount} overflowCount={9} size="small">
        <Button
          ref={launcherButtonRef}
          htmlType="button"
          shape="round"
          size="large"
          data-global-assistant="launcher"
          aria-label={mode === 'chat' ? '收起灵小枢对话' : '询问灵小枢'}
          aria-haspopup="dialog"
          aria-expanded={mode === 'chat'}
          aria-controls="global-assistant-panel"
          onClick={handleLauncherClick}
          icon={(
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm" style={{ background: 'var(--ls-action-gradient)' }} aria-hidden="true">
              <Bot size={15} />
            </span>
          )}
          className="!flex !h-11 !w-11 !gap-0 !border-border !bg-surface !px-2 !text-text-primary shadow-sm transition-colors hover:!border-accent/40 hover:!bg-accent-glow focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-accent focus-visible:!ring-offset-2 sm:!w-auto sm:!gap-2 sm:!px-3.5"
          title={mode === 'chat' ? '收起灵小枢对话' : '询问灵小枢'}
        >
          <span className="ls-type-label-large hidden whitespace-nowrap sm:inline">询问灵小枢</span>
        </Button>
      </Badge>
    </div>
  );
}
