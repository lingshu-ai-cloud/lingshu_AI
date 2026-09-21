import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Bot,
  CheckCircle2,
  Clapperboard,
  Compass,
  Loader2,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import type { AgentAction, AgentType, Message, Page } from '../App';
import { authHeader } from '../lib/auth';
import { ASSISTANT_GUIDES, type AssistantGuide } from '../lib/assistantGuides';
import { ORBIT_AGENT_IDS, type OrbitAgentId, useAssistantStore } from '../stores/assistantStore';
import AgentReply from './AgentReply';
import KnowledgeIntakePanel, { type AppliedProfile } from './enterprise/KnowledgeIntakePanel';

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

const GUIDE_MEMORY_KEY = 'lingshu-feature-guides-human-v1';
const GUIDE_HOVER_DELAY_MS = 900;
const GUIDE_COOLDOWN_MS = 45_000;
const GUIDE_VISIBLE_MS = 6_000;
const ASSISTANT_AUTO_RETRACT_MS = 5_000;
const ENTERPRISE_GUIDE_MEMORY_ID = '__enterprise-guide-shown__';
const ASSISTANT_POSITION_KEY = 'lingshu-global-assistant-position-v1';
const ASSISTANT_LAUNCHER_WIDTH = 60;
const ASSISTANT_LAUNCHER_HEIGHT = 72;
const ASSISTANT_VIEWPORT_GAP = 8;
const ASSISTANT_DRAG_THRESHOLD = 6;

type AssistantPerformance = { phase: string; message?: string };
type AssistantSpeech = { id: number; message: string };

const PERFORMANCE_LINES: Record<string, string[]> = {
  script: ['我正在把卖点排成能拍的镜头，马上就好。', '好内容值得多想几秒，我先帮你把逻辑捋顺。', '别急，我正在检查每个镜头能不能真正执行。'],
  storyboard: ['分镜正在排队出场，我先来一段热身。', '镜头衔接交给我，我会把节奏接顺。', '正在逐镜检查，避免成片时才发现问题。'],
  voice: ['正在逐句处理配音，不会漏掉后面的台词。', '我在给每句话找合适的停顿和节奏。', '配音还在生成，我陪你等一小会儿。'],
  material: ['我正在替每个分镜挑合适的素材。', '素材匹配中，先看动作，再看画面是否真的能用。', '稍等，我正在把重复镜头和不合适的素材筛掉。'],
  render: ['成片正在合成，我先替进度条加加油。', '最后几步通常最费功夫，马上就能看成片。', '正在把画面、字幕和声音稳稳地合在一起。'],
  default: ['任务正在处理中，我会一直在这里陪你。', '稍等一下，好结果正在路上。', '我先表演一个原地小跳，进度交给后台继续跑。'],
};

type GuideMemory = {
  seen: string[];
  lastShownAt: number;
};

type AssistantPosition = { x: number; y: number };

function clampAssistantPosition(position: AssistantPosition, viewportWidth: number, viewportHeight: number): AssistantPosition {
  const maxX = Math.max(ASSISTANT_VIEWPORT_GAP, viewportWidth - ASSISTANT_LAUNCHER_WIDTH - ASSISTANT_VIEWPORT_GAP);
  const maxY = Math.max(ASSISTANT_VIEWPORT_GAP, viewportHeight - ASSISTANT_LAUNCHER_HEIGHT - ASSISTANT_VIEWPORT_GAP);
  return {
    x: Math.min(maxX, Math.max(ASSISTANT_VIEWPORT_GAP, position.x)),
    y: Math.min(maxY, Math.max(ASSISTANT_VIEWPORT_GAP, position.y)),
  };
}

function clampViewportStart(preferred: number, size: number, viewportSize: number, gap: number): number {
  const maxStart = Math.max(gap, viewportSize - size - gap);
  return Math.min(maxStart, Math.max(gap, preferred));
}

function readAssistantPosition(): AssistantPosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ASSISTANT_POSITION_KEY) || 'null') as Partial<AssistantPosition> | null;
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return clampAssistantPosition({ x: Number(parsed.x), y: Number(parsed.y) }, window.innerWidth, window.innerHeight);
  } catch {
    return null;
  }
}

interface Props {
  page: Page;
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
    agent: 'traffic', label: '智能素材', summary: '当前在智能素材，适合生成脚本、画面、口播和成片。',
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

const SKILL_AGENTS: Array<{
  id: OrbitAgentId;
  label: string;
  agentType: AgentType;
  Icon: typeof Compass;
  position: { x: number; y: number };
}> = [
  { id: 'business', label: '经营 Agent', agentType: 'strategy', Icon: BarChart3, position: { x: 0, y: -1 } },
  { id: 'director', label: '编导 Agent', agentType: 'traffic', Icon: Clapperboard, position: { x: -0.5, y: -0.866 } },
  { id: 'content', label: '内容 Agent', agentType: 'traffic', Icon: WandSparkles, position: { x: -0.866, y: -0.5 } },
  { id: 'customer', label: '客服 Agent', agentType: 'conversion', Icon: Users, position: { x: -1, y: 0 } },
];

const ORBIT_AGENT_IDLE_STYLE = { color: '#53695F', borderColor: '#9AAEA4', backgroundColor: '#F1F6F2' };
const ORBIT_AGENT_ACTIVE_STYLE = { color: '#117F51', borderColor: '#117F51', backgroundColor: '#E7F6EE' };

const AGENT_DISPLAY_NAME: Record<OrbitAgentId, string> = {
  business: '经营 Agent',
  director: '编导 Agent',
  content: '内容 Agent',
  customer: '客服 Agent',
};

function pageKey(page: Page) {
  if (page === 'youtube' || page === 'channels') return 'plugins';
  if (page === 'retention') return 'conversion';
  return page;
}

type AssistantExpression = 'happy' | 'wink' | 'thinking' | 'excited';
const PAGE_EXPRESSION: Record<Page, AssistantExpression> = {
  digitalEmployees: 'excited',
  agentMonitor: 'thinking',
  strategy: 'happy',
  traffic: 'excited',
  socialInspiration: 'excited',
  scriptLibrary: 'thinking',
  smartAssets: 'excited', socialMonitoring: 'thinking', accountManagement: 'thinking',
  adsOverview: 'thinking', adsPlans: 'excited', adsCreatives: 'thinking', adsManaged: 'thinking',
  conversion: 'thinking', wecomCustomerService: 'thinking',
  retention: 'happy',
  orders: 'wink',
  enterprise: 'thinking',
  agentMemory: 'thinking',
  plugins: 'excited',
  scheduled: 'wink',
  admin: 'thinking',
  adminDelivery: 'thinking', contentFormulaAdmin: 'thinking',
  channels: 'excited',
  youtube: 'excited',
  organizationPermissions: 'thinking',
};

const LAUNCHER_MASCOT_CROP_LEFT: Record<AssistantExpression, number> = {
  happy: -26,
  wink: -97,
  thinking: -169,
  excited: -241,
};

function AssistantLauncherMascot({ expression }: { expression: AssistantExpression }) {
  return (
    <span className="pointer-events-none relative block h-[72px] w-[60px] select-none overflow-hidden" aria-hidden="true">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={expression}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.9, rotate: -3 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.92, rotate: 3 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <img
            src="/lingshu-expressions-body-transparent.png"
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-[-36px] h-auto max-w-none select-none drop-shadow-[0_5px_8px_rgba(52,196,113,0.14)]"
            style={{ left: LAUNCHER_MASCOT_CROP_LEFT[expression], width: 329 }}
          />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function orbitIdForPage(page: Page): OrbitAgentId {
  if (page === 'socialInspiration' || page === 'scriptLibrary' || page === 'contentFormulaAdmin') return 'director';
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
  return SKILL_AGENTS.find(agent => agent.id === id)?.agentType ?? 'strategy';
}

function contextForOrbit(id: OrbitAgentId, fallback: AssistantContext): AssistantContext {
  if (id === 'director') {
    return {
      ...DEFAULT_CONTEXT.socialInspiration,
      label: '编导工作区',
      summary: '当前由编导 Agent 负责爆款参考、内容结构、脚本、口播、字幕和导演方案。',
    };
  }
  if (id === 'content') return { ...DEFAULT_CONTEXT.smartAssets, label: '内容工作区' };
  if (id === 'customer') return DEFAULT_CONTEXT.conversion;
  return { ...fallback, agent: 'strategy' };
}

function compactText(text: string, maxLength = 900) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

async function loadLiveIntegrationFacts(): Promise<string> {
  const readItems = async (path: string): Promise<Record<string, unknown>[]> => {
    try {
      const response = await fetch(path, { headers: authHeader() });
      if (!response.ok) return [];
      const data = await response.json() as { items?: Record<string, unknown>[] };
      return Array.isArray(data.items) ? data.items : [];
    } catch {
      return [];
    }
  };

  const readVideoInventory = async (): Promise<number> => {
    try {
      const response = await fetch('/api/overseas/videos?page=1&perPage=1&contentFormat=video', { headers: authHeader() });
      if (!response.ok) return 0;
      const data = await response.json() as { inventoryTotalItems?: number; totalItems?: number };
      return Math.max(0, Number(data.inventoryTotalItems ?? data.totalItems ?? 0));
    } catch {
      return 0;
    }
  };

  const [socialAccounts, youtubeAccounts, customers, collectedVideos] = await Promise.all([
    readItems('/api/overseas/social/accounts'),
    readItems('/api/overseas/youtube/accounts'),
    readItems('/api/overseas/customers'),
    readVideoInventory(),
  ]);
  const socialPlatforms = Array.from(new Set(socialAccounts
    .map(item => String(item.platform || item.provider || '').trim())
    .filter(Boolean)));
  // `/customers` returns customer profiles imported from WhatsApp. A profile is
  // not itself an inquiry event, so keep that distinction explicit in the
  // grounding context supplied to the model.
  const whatsappCustomers = customers.filter(item => String(item.source || '').toLowerCase() === 'whatsapp');
  const accountViews = [...socialAccounts, ...youtubeAccounts].reduce(
    (sum, item) => sum + Math.max(0, Number(item.viewCount ?? item.views ?? 0)),
    0,
  );
  const confirmed: string[] = [];
  if (socialAccounts.length) confirmed.push(`社媒账号 ${socialAccounts.length} 个${socialPlatforms.length ? `（${socialPlatforms.join('、')}）` : ''}`);
  if (youtubeAccounts.length) confirmed.push(`YouTube 账号 ${youtubeAccounts.length} 个`);
  if (collectedVideos > 0) confirmed.push(`已采集视频 ${collectedVideos} 条`);
  if (accountViews > 0) confirmed.push(`账号内容曝光 ${accountViews.toLocaleString('zh-CN')}`);
  if (whatsappCustomers.length) confirmed.push(`WhatsApp 客户档案 ${whatsappCustomers.length} 条`);
  return [
    `核验时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
    `已确认接入/真实数据：${confirmed.length ? confirmed.join('；') : '本次实时接口未返回可确认项目'}`,
    `客户档案总数：${customers.length} 条；其中 WhatsApp 来源客户档案：${whatsappCustomers.length} 条。`,
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

function apiHistory(list: Message[]): Message[] {
  return mergeConsecutiveAssistant(list)
    .filter(msg => {
      const text = msg.content.trim();
      return text && text !== '请求失败，请稍后重试。' && text !== 'API error';
    })
    .slice(-8)
    .map(msg => ({
      ...msg,
      content: compactText(msg.content, msg.role === 'assistant' ? 1200 : 800),
    }));
}

async function responseErrorMessage(resp: Response): Promise<string> {
  const data = await resp.json().catch(() => null) as {
    error?: string;
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
  if (data?.error) return data.error;
  return `请求失败（HTTP ${resp.status}），请稍后重试。`;
}

function quickQuestions(context: AssistantContext) {
  return context.suggestions.length ? context.suggestions : DEFAULT_CONTEXT.strategy.suggestions;
}

function todoToneClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'border-accent/20 bg-accent-glow text-accent';
  if (tone === 'red') return 'border-red/20 bg-red/5 text-red';
  if (tone === 'amber') return 'border-amber/20 bg-amber-dim text-amber';
  if (tone === 'blue') return 'border-accent/20 bg-accent-glow text-accent';
  return 'border-border bg-surface text-text-secondary';
}

function todoDotClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'bg-accent';
  if (tone === 'red') return 'bg-red';
  if (tone === 'amber') return 'bg-amber';
  if (tone === 'blue') return 'bg-accent';
  return 'bg-border-bright';
}

export default function GlobalAssistant({
  page,
  restore,
  kickoff,
  suppressForRightSidebar = false,
  onKickoffConsumed,
  onAction,
  onSessionRefresh,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<'breathing' | 'expanded' | 'chat'>('breathing');
  const [launcherRetracted, setLauncherRetracted] = useState(false);
  const [panelView, setPanelView] = useState<'todo' | 'chat'>('chat');
  const [activeAgent, setActiveAgent] = useState<OrbitAgentId>('business');
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
  const [assistantPosition, setAssistantPosition] = useState<AssistantPosition | null>(readAssistantPosition);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  const [launcherDragging, setLauncherDragging] = useState(false);
  const longPressRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const launcherDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const nativeLauncherDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const featureGuideTimerRef = useRef<number | null>(null);
  const featureGuideHoverTimerRef = useRef<number | null>(null);
  const speechTimerRef = useRef<number | null>(null);
  const seenGuideIdsRef = useRef(new Set<string>());
  const lastGuideShownAtRef = useRef(0);
  const lastGuideTargetRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const assistantRootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledKickoffs = useRef(new Set<string>());
  const handledRestores = useRef(new Set<string>());

  const threads = useAssistantStore(state => state.threads);
  const setMessages = useAssistantStore(state => state.setMessages);
  const setDraftInput = useAssistantStore(state => state.setDraftInput);
  const setScrollPosition = useAssistantStore(state => state.setScrollPosition);
  const setUnreadCount = useAssistantStore(state => state.setUnreadCount);
  const hydrateThread = useAssistantStore(state => state.hydrateThread);

  const pageContext = useMemo(() => liveContext ?? DEFAULT_CONTEXT[pageKey(page)] ?? DEFAULT_CONTEXT.strategy, [liveContext, page]);
  const currentPageAgent = useMemo(() => orbitIdForPage(page), [page]);
  const assistantExpression = PAGE_EXPRESSION[page];
  const activeContext = useMemo(() => contextForOrbit(activeAgent, pageContext), [activeAgent, pageContext]);
  const activeThread = threads[activeAgent];
  const todoItems = pageContext.todoItems ?? [];
  const activeTodoItems = todoItems.filter(item => !item.completed);
  const completedTodoItems = todoItems.filter(item => item.completed);
  const orderedTodoItems = [...activeTodoItems, ...completedTodoItems];
  const pendingCount = todoItems.length ? activeTodoItems.length : Math.max(0, Number(pageContext.pendingCount ?? 0));
  const pendingBadge = pendingCount > 9 ? '9+' : String(pendingCount);
  const activeAgentLabel = SKILL_AGENTS.find(agent => agent.id === activeAgent)?.label ?? '灵枢助手';
  const isCustomerTodoView = panelView === 'todo' && activeAgent === 'customer' && pageContext.agent === 'conversion';
  const panelTitle = assistantTool === 'knowledge-intake' ? '灵小枢 · 快速采集' : isCustomerTodoView ? '今日待办' : activeAgentLabel;
  const panelSubtitle = assistantTool === 'knowledge-intake' ? '当前：智能客服规范' : isCustomerTodoView ? '当前：我的客户' : `当前：${activeContext.label}`;
  const radius = 110;
  const dockOnLeft = assistantPosition ? assistantPosition.x < viewport.width / 2 : false;
  const dockOnTop = assistantPosition ? assistantPosition.y + ASSISTANT_LAUNCHER_HEIGHT / 2 < viewport.height / 2 : false;
  const launcherAtEdge = mode === 'breathing' && launcherRetracted && !assistantPosition;
  const assistantPanelHeight = assistantPosition
    ? Math.max(120, Math.min(720, dockOnTop
      ? viewport.height - assistantPosition.y - ASSISTANT_LAUNCHER_HEIGHT - 16
      : assistantPosition.y - 16))
    : Math.min(720, viewport.height - 112);
  const assistantPanelWidth = Math.min(assistantTool === 'knowledge-intake' ? 560 : 420, viewport.width - 32);
  const positionedPopupLeft = (popupWidth: number, gap = 8) => {
    if (!assistantPosition) return undefined;
    const preferredViewportLeft = dockOnLeft
      ? assistantPosition.x + 72
      : assistantPosition.x - 12 - popupWidth;
    return clampViewportStart(preferredViewportLeft, popupWidth, viewport.width, gap) - assistantPosition.x;
  };
  const positionedPanelLeft = assistantPosition
    ? clampViewportStart(
      dockOnLeft ? assistantPosition.x : assistantPosition.x + ASSISTANT_LAUNCHER_WIDTH - assistantPanelWidth,
      assistantPanelWidth,
      viewport.width,
      16,
    ) - assistantPosition.x
    : undefined;
  const performanceLines = PERFORMANCE_LINES[performance?.phase || 'default'] || PERFORMANCE_LINES.default;
  const performanceMessage = performance?.message || performanceLines[performanceLineIndex % performanceLines.length];

  const persistThread = useCallback((agentId: OrbitAgentId) => {
    const thread = useAssistantStore.getState().threads[agentId];
    fetch(`/api/overseas/assistant-threads/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(thread),
    }).catch(() => {});
  }, []);

  const openAgent = useCallback((agentId: OrbitAgentId) => {
    setAssistantTool(null);
    setActiveAgent(agentId);
    setPanelView(agentId === 'customer' && pageContext.agent === 'conversion' && (pendingCount > 0 || todoItems.length > 0) ? 'todo' : 'chat');
    setUnreadCount(agentId, 0);
    setMode('chat');
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }), 60);
    persistThread(agentId);
  }, [pageContext.agent, pendingCount, persistThread, reduceMotion, setUnreadCount, todoItems.length]);

  const openCurrentPageAgent = useCallback(() => {
    openAgent(currentPageAgent);
  }, [currentPageAgent, openAgent]);

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
    if (mode !== 'breathing') {
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
  }, [mode, showFeatureGuide]);

  useEffect(() => () => {
    if (featureGuideTimerRef.current) window.clearTimeout(featureGuideTimerRef.current);
    if (featureGuideHoverTimerRef.current) window.clearTimeout(featureGuideHoverTimerRef.current);
  }, []);

  const send = useCallback(async (text: string, targetAgent = activeAgent, forcedContext?: AssistantContext) => {
    const visibleText = text.trim();
    if (!visibleText || loading) return;

    const thread = useAssistantStore.getState().threads[targetAgent];
    const context = forcedContext ?? contextForOrbit(targetAgent, pageContext);
    const enterpriseBrief = compactText(enterpriseContext);
    const historyForApi = apiHistory(thread.messages);
    const nextVisible = [...mergeConsecutiveAssistant(thread.messages), { role: 'user' as const, content: visibleText }];
    const liveIntegrationFacts = await loadLiveIntegrationFacts();
    const apiMessages: Message[] = [
      ...historyForApi,
      {
        role: 'user',
        content: [
          `【当前页面上下文】${context.summary}`,
          `【当前模块】${context.label}`,
          `【当前时间】${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。未注明年份时，“当前/最新/近期/今年”均指当前年份；不得把 2024 年或更早的公开数据表述为当前数据。`,
          enterpriseBrief ? `【企业中心摘要】${enterpriseBrief}` : '【企业中心摘要】当前未读取到企业中心资料。',
          `【实时接入事实】\n${liveIntegrationFacts}`,
          '【经营事实要求】描述、脚本、卖点、市场、客户、MOQ、价格、交期、认证、联系方式和语种，只能使用企业中心摘要、用户明确输入或当前页面真实素材证据。语种必须沿用企业中心主要业务语言/首选输出语言，禁止根据地区自行推断。没有来源的经营细节直接省略，不要用示例补齐。',
          '【联网要求】涉及外贸行业趋势、目标市场、平台规则、竞品或品类机会时，请联网检索公开来源，并在回答中保留可核验来源；不要把假设当成事实。',
          '【连续对话要求】请承接本窗口已有上下文回答，直接基于页面现有数据给出可执行结果；不要用“当前缺少数据”“无法判断”“无法筛选”开头。必要的数据范围说明放在结尾并保持中性简短。',
          `用户问题：${visibleText}`,
        ].join('\n'),
      },
    ];

    setMessages(targetAgent, nextVisible);
    setDraftInput(targetAgent, '');
    setLoading(true);
    openAgent(targetAgent);

    let assistantStarted = false;
    const ensureAssistant = () => {
      if (assistantStarted) return;
      assistantStarted = true;
      const current = useAssistantStore.getState().threads[targetAgent].messages;
      setMessages(targetAgent, [...current, { role: 'assistant', content: '' }]);
      setLoading(false);
    };
    const patchAssistant = (patch: (msg: Message) => Message) => {
      ensureAssistant();
      const current = [...useAssistantStore.getState().threads[targetAgent].messages];
      current[current.length - 1] = patch(current[current.length - 1]);
      setMessages(targetAgent, current);
    };

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const resp = await fetch(API_PATH[agentForOrbit(targetAgent)], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ messages: apiMessages, deepThinking: false }),
        signal: controller.signal,
      });
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
      const message = err?.name === 'AbortError' ? '这次响应已停止。' : (err?.message || '请求失败，请稍后重试。');
      if (assistantStarted) patchAssistant(msg => ({ ...msg, content: msg.content ? `${msg.content}\n\n${message}` : message }));
      else setMessages(targetAgent, [...useAssistantStore.getState().threads[targetAgent].messages, { role: 'assistant', content: message }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
      persistThread(targetAgent);
      onSessionRefresh?.();
    }
  }, [activeAgent, enterpriseContext, loading, onSessionRefresh, openAgent, pageContext, persistThread, setDraftInput, setMessages]);

  useEffect(() => {
    fetch('/api/overseas/assistant-threads', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (!Array.isArray(data?.items)) return;
        for (const item of data.items) {
          if (!ORBIT_AGENT_IDS.includes(item.agentId)) continue;
          hydrateThread(item.agentId, {
            messages: Array.isArray(item.messages) ? item.messages : [],
            draftInput: typeof item.draftInput === 'string' ? item.draftInput : '',
            scrollPosition: Number(item.scrollPosition ?? 0),
            unreadCount: Number(item.unreadCount ?? 0),
          });
        }
      })
      .catch(() => {});
    fetch('/api/overseas/enterprise/context', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        if (typeof data?.context === 'string') setEnterpriseContext(data.context);
      })
      .catch(() => setEnterpriseContext(''));
  }, [hydrateThread]);

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
      const detail = (event as CustomEvent<{ active?: boolean; phase?: string; message?: string }>).detail;
      if (!detail?.active) {
        setPerformance(null);
        setPerformanceHidden(false);
        setPerformanceLineIndex(0);
        return;
      }
      setPerformance({ phase: detail.phase || 'default', message: detail.message?.trim() || undefined });
      setPerformanceHidden(false);
      setPerformanceLineIndex(0);
      setLauncherRetracted(false);
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
      const detail = (event as CustomEvent<{ message?: string; durationMs?: number }>).detail;
      const message = detail?.message?.trim();
      if (!message) return;
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
      setSpeechBubble({ id: Date.now(), message });
      setLauncherRetracted(false);
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
      const targetAgent = orbitIdForAgent(targetContext.agent, currentPageAgent);
      openAgent(targetAgent);
      if (detail?.tool === 'knowledge-intake') setAssistantTool('knowledge-intake');
      const assistantText = detail?.assistantText?.trim();
      if (assistantText) {
        const current = useAssistantStore.getState().threads[targetAgent].messages;
        setMessages(targetAgent, [...current, { role: 'assistant', content: assistantText }]);
      }
      const text = detail?.text?.trim();
      if (text) window.setTimeout(() => void send(text, targetAgent, targetContext), 0);
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
    const targetAgent = orbitIdForAgent(restore.agent, currentPageAgent);
    setMessages(targetAgent, mergeConsecutiveAssistant(restore.messages));
    openAgent(targetAgent);
  }, [currentPageAgent, openAgent, restore, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [activeThread.messages, mode, reduceMotion]);

  useEffect(() => {
    setLiveContext(null);
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
  }, [activeAgent, activeThread.draftInput, activeThread.messages, activeThread.scrollPosition, activeThread.unreadCount, mode, persistThread]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rootRect = assistantRootRef.current?.getBoundingClientRect();
    if (!rootRect) return;
    if (event.pointerType !== 'mouse') {
      event.currentTarget.setPointerCapture(event.pointerId);
      launcherDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rootRect.left,
        originY: rootRect.top,
        moved: false,
      };
    }
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressedRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setMode('expanded');
    }, 300);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < ASSISTANT_DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      longPressedRef.current = false;
      if (longPressRef.current) window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
      setLauncherDragging(true);
      setLauncherRetracted(false);
      setMode('breathing');
    }
    setAssistantPosition(clampAssistantPosition(
      { x: drag.originX + deltaX, y: drag.originY + deltaY },
      viewport.width,
      viewport.height,
    ));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = launcherDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (drag.moved) {
        const next = clampAssistantPosition(
          { x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY },
          viewport.width,
          viewport.height,
        );
        setAssistantPosition(next);
        window.localStorage.setItem(ASSISTANT_POSITION_KEY, JSON.stringify(next));
        suppressLauncherClickRef.current = true;
      }
      launcherDragRef.current = null;
    }
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
    setLauncherDragging(false);
  };

  const handleNativeDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    const rootRect = assistantRootRef.current?.getBoundingClientRect();
    if (!rootRect) {
      event.preventDefault();
      return;
    }
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
    longPressedRef.current = false;
    nativeLauncherDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rootRect.left,
      originY: rootRect.top,
    };
    event.dataTransfer.effectAllowed = 'move';
    setLauncherDragging(true);
    setLauncherRetracted(false);
    setMode('breathing');
  };

  const handleNativeDrag = (event: ReactDragEvent<HTMLButtonElement>) => {
    const drag = nativeLauncherDragRef.current;
    if (!drag || (event.clientX === 0 && event.clientY === 0)) return;
    setAssistantPosition(clampAssistantPosition(
      { x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY },
      viewport.width,
      viewport.height,
    ));
  };

  const handleNativeDragEnd = (event: ReactDragEvent<HTMLButtonElement>) => {
    const drag = nativeLauncherDragRef.current;
    if (!drag) return;
    const next = event.clientX === 0 && event.clientY === 0
      ? assistantPosition ?? clampAssistantPosition({ x: drag.originX, y: drag.originY }, viewport.width, viewport.height)
      : clampAssistantPosition(
        { x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY },
        viewport.width,
        viewport.height,
      );
    setAssistantPosition(next);
    window.localStorage.setItem(ASSISTANT_POSITION_KEY, JSON.stringify(next));
    nativeLauncherDragRef.current = null;
    suppressLauncherClickRef.current = true;
    setLauncherDragging(false);
  };

  const handleLauncherClick = () => {
    if (suppressLauncherClickRef.current) {
      suppressLauncherClickRef.current = false;
      return;
    }
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (assistantTool === 'knowledge-intake') {
      setMode('chat');
      return;
    }
    if (mode === 'expanded') {
      openCurrentPageAgent();
      return;
    }
    else setMode('expanded');
  };

  useEffect(() => {
    if (mode !== 'expanded') return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (assistantRootRef.current?.contains(target)) return;
      setMode('breathing');
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'chat' && assistantTool !== 'knowledge-intake') return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setAssistantTool(null);
      setPanelView('chat');
      setMode('breathing');
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [assistantTool, mode]);

  useEffect(() => {
    setLauncherRetracted(false);
  }, [page]);

  useEffect(() => {
    const handleResize = () => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      setViewport(nextViewport);
      setAssistantPosition(current => {
        if (!current) return null;
        const next = clampAssistantPosition(current, nextViewport.width, nextViewport.height);
        window.localStorage.setItem(ASSISTANT_POSITION_KEY, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (assistantPosition || mode !== 'breathing' || (performance && !performanceHidden)) {
      setLauncherRetracted(false);
      return;
    }
    if (launcherRetracted) return;
    const timer = window.setTimeout(() => setLauncherRetracted(true), ASSISTANT_AUTO_RETRACT_MS);
    return () => window.clearTimeout(timer);
  }, [assistantPosition, launcherRetracted, mode, page, performance, performanceHidden]);

  if (suppressForRightSidebar) return null;

  return (
    <div
      ref={assistantRootRef}
      data-global-assistant="root"
      data-lingshu-assistant-dragged={assistantPosition ? 'true' : 'false'}
      className={`fixed ${page === 'digitalEmployees' && mode === 'breathing' ? 'z-[35]' : 'z-[75]'} ${launcherDragging ? '' : 'transition-[left,right,top,bottom] duration-300'} ${assistantPosition ? '' : dockOnLeft ? 'bottom-5 left-4 lg:left-[292px]' : launcherAtEdge ? 'bottom-5 right-0' : 'bottom-5 right-5'}`}
      style={assistantPosition ? { left: assistantPosition.x, top: assistantPosition.y } : undefined}
    >
      {mode === 'expanded' && (
        <button
          type="button"
          aria-label="收起灵枢助手"
          onClick={() => setMode('breathing')}
          className="fixed inset-0 z-0 cursor-default bg-transparent"
        />
      )}
      <AnimatePresence>
        {mode === 'breathing' && !launcherAtEdge && performance && !performanceHidden && (
          <motion.div
            key={`performance-${performance.phase}`}
            data-lingshu-assistant-performance={performance.phase}
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 7, scale: 0.96 }}
            className={`absolute z-30 w-[248px] max-w-[calc(100vw-104px)] rounded-lg border border-border bg-surface p-3 shadow-lg ${assistantPosition ? '' : dockOnLeft ? 'left-[72px]' : 'right-[72px]'} ${dockOnTop ? 'top-1' : 'bottom-1'}`}
            style={assistantPosition ? { left: positionedPopupLeft(Math.min(248, viewport.width - 104)) } : undefined}
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
            <p className="pr-6 text-[10px] font-black uppercase tracking-[0.14em] text-accent">灵小枢陪你等</p>
            <p className="mt-1 text-xs font-semibold leading-[1.65] text-text-secondary">{performanceMessage}</p>
            <div className="mt-2 flex gap-1"><span className="h-1 w-5 animate-pulse rounded-full bg-accent"/><span className="h-1 w-3 animate-pulse rounded-full bg-accent/55 [animation-delay:160ms]"/><span className="h-1 w-2 animate-pulse rounded-full bg-accent/25 [animation-delay:320ms]"/></div>
            <span className={`absolute h-4 w-4 rotate-45 border-border bg-surface ${dockOnLeft ? '-left-2 border-b border-l' : '-right-2 border-r border-t'} ${dockOnTop ? 'top-6' : 'bottom-6'}`} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'breathing' && !launcherAtEdge && (!performance || performanceHidden) && speechBubble && (
          <motion.div
            key={`speech-${speechBubble.id}`}
            data-lingshu-assistant-speech="true"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            className={`absolute z-30 w-[248px] max-w-[calc(100vw-104px)] rounded-lg border border-border bg-surface p-3 shadow-lg ${assistantPosition ? '' : dockOnLeft ? 'left-[72px]' : 'right-[72px]'} ${dockOnTop ? 'top-1' : 'bottom-1'}`}
            style={assistantPosition ? { left: positionedPopupLeft(Math.min(248, viewport.width - 104)) } : undefined}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-accent">灵小枢</p>
            <p className="mt-1 text-xs font-semibold leading-[1.65] text-text-secondary">{speechBubble.message}</p>
            <span className={`absolute h-4 w-4 rotate-45 border-border bg-surface ${dockOnLeft ? '-left-2 border-b border-l' : '-right-2 border-r border-t'} ${dockOnTop ? 'top-6' : 'bottom-6'}`} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'breathing' && !launcherAtEdge && (!performance || performanceHidden) && !speechBubble && featureGuide && (
          <motion.div
            key={featureGuide.id}
            data-lingshu-guide-bubble={featureGuide.id}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            className={`absolute z-20 w-[236px] max-w-[calc(100vw-104px)] rounded-lg border border-border bg-surface p-3 shadow-lg ${assistantPosition ? '' : dockOnLeft ? 'left-[72px]' : 'right-[72px]'} ${dockOnTop ? 'top-1' : 'bottom-1'}`}
            style={assistantPosition ? { left: positionedPopupLeft(Math.min(236, viewport.width - 104)) } : undefined}
          >
            <button type="button" onClick={() => setFeatureGuide(null)} className="absolute right-2.5 top-2.5 rounded-lg p-1 text-text-muted hover:bg-surface-2" aria-label="关闭用法提示">
              <X size={13} />
            </button>
            <div className="pr-6">
              <p className="text-xs font-black text-accent">{featureGuide.title}</p>
              <p className="mt-1 text-xs leading-[1.65] text-text-secondary">{featureGuide.message}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const agentId = orbitIdForAgent(featureGuide.agent, currentPageAgent);
                setFeatureGuide(null);
                openAgent(agentId);
              }}
              className="mt-2 text-[11px] font-black text-accent hover:text-accent-dim"
            >
              问问灵小枢 →
            </button>
            <span className={`absolute h-4 w-4 rotate-45 border-border bg-surface ${dockOnLeft ? '-left-2 border-b border-l' : '-right-2 border-r border-t'} ${dockOnTop ? 'top-6' : 'bottom-6'}`} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {page === 'enterprise' && mode === 'breathing' && enterpriseGuideSeen && !featureGuide && !speechBubble && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            onClick={openCurrentPageAgent}
            className={`absolute z-10 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-[11px] font-black text-accent shadow-sm hover:border-accent/30 hover:bg-accent-glow ${dockOnLeft ? 'left-[68px]' : 'right-[68px]'} ${dockOnTop ? 'top-5' : 'bottom-5'}`}
          >
            要补资料？点我
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'expanded' && (
          <motion.div
            className={`pointer-events-none absolute z-10 h-52 w-52 ${dockOnLeft ? 'left-0' : 'right-0'} ${dockOnTop ? 'top-0' : 'bottom-0'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className={`absolute h-36 w-36 rounded-full border border-dashed border-accent/25 ${dockOnLeft ? 'left-6' : 'right-6'} ${dockOnTop ? 'top-6' : 'bottom-6'}`} />
            <div className={`absolute h-24 w-24 rounded-full border border-dashed border-accent/15 ${dockOnLeft ? 'left-6' : 'right-6'} ${dockOnTop ? 'top-6' : 'bottom-6'}`} />
            {SKILL_AGENTS.map((agent, index) => {
              const Icon = agent.Icon;
              const unread = threads[agent.id].unreadCount;
              const current = agent.id === currentPageAgent;
              const x = (dockOnLeft ? -agent.position.x : agent.position.x) * radius;
              const y = (dockOnTop ? -agent.position.y : agent.position.y) * radius;
              return (
                <motion.button
                  key={agent.id}
                  type="button"
                  title={`${AGENT_DISPLAY_NAME[agent.id]}${current ? ' · 当前页面' : ''}`}
                  aria-label={`打开${AGENT_DISPLAY_NAME[agent.id]}`}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => openAgent(agent.id)}
                  className={`group pointer-events-auto absolute flex h-12 w-12 items-center justify-center rounded-full border bg-surface shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${dockOnLeft ? 'left-2' : 'right-2'} ${dockOnTop ? 'top-2' : 'bottom-2'}`}
                  style={current ? ORBIT_AGENT_ACTIVE_STYLE : ORBIT_AGENT_IDLE_STYLE}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0.72 }}
                  animate={{ x, y, opacity: 1, scale: 1 }}
                  exit={{ x: 0, y: 0, opacity: 0, scale: 0.72 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18, delay: index * 0.06 }}
                >
                  <Icon size={20} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-text-primary px-2.5 py-1 text-[11px] font-bold text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {AGENT_DISPLAY_NAME[agent.id]}{current ? ' · 当前页面' : ''}
                  </span>
                  {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red px-1 text-[11px] font-bold text-white">{unread}</span>}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(mode === 'chat' || assistantTool === 'knowledge-intake') && (
          <motion.section
            data-global-assistant="panel"
            role="dialog"
            aria-label={panelTitle}
            tabIndex={-1}
            layoutId={`assistant-${activeAgent}`}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={mode === 'chat' ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 18, scale: 0.96 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={reduceMotion ? { duration: 0.16 } : { type: 'spring', stiffness: 240, damping: 24 }}
            className={`absolute z-10 flex max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl outline-none ${assistantPosition ? '' : dockOnLeft ? 'left-0' : 'right-0'} ${dockOnTop ? 'top-14' : 'bottom-14'} ${assistantTool === 'knowledge-intake' ? 'w-[560px]' : 'w-[420px]'} ${mode === 'chat' ? 'pointer-events-auto visible' : 'pointer-events-none invisible'}`}
            style={{ height: assistantPanelHeight, ...(assistantPosition ? { left: positionedPanelLeft } : {}) }}
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (assistantTool === 'knowledge-intake') {
                      setAssistantTool(null);
                      setPanelView('chat');
                    } else if (isCustomerTodoView) setPanelView('chat');
                    else setMode('expanded');
                  }}
                  className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={assistantTool === 'knowledge-intake' ? '返回灵小枢对话' : isCustomerTodoView ? '返回客户助手' : '返回展开态'}
                  title={assistantTool === 'knowledge-intake' ? '返回灵小枢对话' : isCustomerTodoView ? '返回客户助手' : '返回展开态'}
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-text-primary">{panelTitle}</p>
                  <p className="truncate text-[11px] text-text-muted">{panelSubtitle}</p>
                </div>
              </div>
              <button type="button" onClick={() => { setAssistantTool(null); setPanelView('chat'); setMode('breathing'); }} className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" title="关闭" aria-label="关闭灵枢助手">
                <X size={15} />
              </button>
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
            ) : isCustomerTodoView ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-3">
                  <div className="border-l-2 border-amber bg-amber-dim p-4">
                    <p className="text-sm font-black text-text-primary">今日待办（{pendingCount}）</p>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                      {pendingCount > 0 ? '需要你处理和确认的客户已按优先级排好。' : '今天的待办已处理完。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPanelView('chat')}
                      className="mt-4 rounded-md bg-accent px-3 py-2 text-xs font-black text-white hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
                            setPanelView('chat');
                          }}
                          className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${todoToneClass(item.tone, item.completed)}`}
                        >
                          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${todoDotClass(item.tone, item.completed)}`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-xs font-black text-text-primary">{item.name}</span>
                              {item.completed && (
                                <span className="inline-flex shrink-0 items-center gap-1 border-l-2 border-accent bg-accent-glow px-2 py-0.5 text-[10px] font-black text-accent">
                                  <CheckCircle2 size={11} /> 已完成
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block truncate text-[11px] font-bold opacity-80">{item.headline}</span>
                            <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-text-secondary">{item.reason}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-surface-2 px-3 py-4 text-center text-xs font-bold text-text-muted">
                      暂无今日待办
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                  onScroll={event => setScrollPosition(activeAgent, event.currentTarget.scrollTop)}
                >
                  {!activeThread.messages.length ? (
                    <div className="flex h-full flex-col justify-center gap-4">
                      <div>
                        <p className="text-sm font-bold text-text-primary">我是{activeAgentLabel}</p>
                        <p className="mt-1 text-sm leading-relaxed text-text-muted">我会结合当前页面上下文继续帮你处理。</p>
                      </div>
                      <div className="grid gap-2">
                        {quickQuestions(activeContext).map(item => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => void send(item)}
                            className="rounded-md border border-border bg-surface px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:border-accent/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activeThread.messages.map((msg, index) => (
                        <div key={index} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                          {msg.role === 'assistant' && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Bot size={13} /></div>}
                          <div className={`max-w-[82%] rounded-lg px-3 py-2 text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-tr-sm bg-accent text-white whitespace-pre-line' : 'rounded-tl-sm border border-border bg-surface-2 text-text-primary'}`}>
                            {msg.role === 'assistant'
                              ? (msg.content ? <AgentReply content={msg.content} sources={msg.sources} onAction={onAction} /> : <span className="opacity-40">...</span>)
                              : msg.content}
                          </div>
                        </div>
                      ))}
                      {loading && (
                        <div className="flex gap-2">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-text-primary text-white"><Loader2 size={13} className="animate-spin" /></div>
                          <div className="rounded-lg rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">思考中...</div>
                        </div>
                      )}
                      <div ref={bottomRef} />
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-border p-3">
                  <div className="rounded-lg border border-border bg-surface-2 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/10">
                    <textarea
                      value={activeThread.draftInput}
                      onChange={event => setDraftInput(activeAgent, event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void send(activeThread.draftInput);
                        }
                      }}
                      rows={2}
                      placeholder="问灵枢助手..."
                      className="w-full resize-none bg-transparent px-3 pt-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
                    />
                    <div className="flex items-center justify-end px-2 pb-2">
                      <button type="button" onClick={() => void send(activeThread.draftInput)} disabled={!activeThread.draftInput.trim() || loading} className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40" aria-label="发送消息">
                        {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {mode !== 'chat' && launcherAtEdge && (
        <motion.button
          type="button"
          data-global-assistant="edge-launcher"
          aria-label="唤出灵小枢智能助手"
          title="唤出灵小枢智能助手"
          onClick={() => setLauncherRetracted(false)}
          initial={{ opacity: 0, x: 14, scale: 0.92 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 10, scale: 0.94 }}
          transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', stiffness: 320, damping: 24 }}
          className="relative z-10 flex h-10 w-8 items-center justify-center rounded-l-md border border-r-0 border-border bg-surface text-accent shadow-md outline-none hover:w-9 hover:bg-accent-glow focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <Bot size={16} />
          {pendingCount > 0 && <span className="absolute -left-1.5 -top-1 min-w-4 rounded-full bg-red px-1 text-[9px] font-black text-white">{pendingBadge}</span>}
        </motion.button>
      )}

      {mode !== 'chat' && !launcherAtEdge && (
        <div className="relative z-10 h-[72px] w-[60px]">
          <motion.button
            type="button"
            draggable
            data-global-assistant="launcher"
            aria-label={mode === 'expanded' ? `打开${AGENT_DISPLAY_NAME[currentPageAgent]}` : '拖动可移动，点击可展开灵枢助手'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDragStartCapture={handleNativeDragStart}
            onDragCapture={handleNativeDrag}
            onDragEndCapture={handleNativeDragEnd}
            onClick={handleLauncherClick}
            className={`absolute inset-0 flex touch-none items-center justify-center rounded-lg bg-transparent outline-none transition-transform focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${launcherDragging ? 'cursor-grabbing' : 'cursor-grab hover:-translate-y-0.5'}`}
            animate={performance && !reduceMotion
              ? { scale: [1, 1.08, 1], y: [0, -9, 0], rotate: [0, -5, 5, 0] }
              : mode === 'breathing' && pendingCount > 0 && !reduceMotion ? { scale: [1, 1.05, 1], y: [0, -2, 0] } : { scale: 1, y: 0 }}
            transition={{ duration: performance ? 1.55 : 2.4, ease: 'easeInOut', repeat: (performance || (mode === 'breathing' && pendingCount > 0)) && !reduceMotion ? Infinity : 0 }}
            title={mode === 'expanded' ? `打开${AGENT_DISPLAY_NAME[currentPageAgent]}` : '拖动可移动，点击可展开灵枢助手'}
          >
            <AssistantLauncherMascot expression={assistantExpression} />
            {pendingCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red px-1 text-[11px] font-black text-white">{pendingBadge}</span>}
          </motion.button>
        </div>
      )}
    </div>
  );
}
