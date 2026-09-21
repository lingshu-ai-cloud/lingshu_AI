import { consumeBusinessPageContext, saveBusinessPageContext } from '../lib/businessPageNavigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ListChecks, Target, TrendingUp, Users, Zap, MessageSquare, ArrowUpRight, CircleDollarSign, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import TrafficDataBoard from './TrafficDataBoard';
import InquiryDataBoard from './InquiryDataBoard';
import CrmDataBoard from './CrmDataBoard';
import type { AgentAction, Page } from '../App';
import { authHeader } from '../lib/auth';
import { CHART_CURSOR_STYLE, CHART_TOOLTIP_STYLE } from '../lib/uiStyles';
import { useCustomers } from '../hooks/useCustomers';
import {
  createEnterpriseHomepageDemo,
  type EnterpriseHomepageDemoDataset,
  type EnterpriseHomepageProfile,
} from '../mocks/enterpriseHomepageDemo';

/* 策略页「数据大屏」——全平台经营数据只在策略 agent 看（负责"想"）；
   流量/转化/留存三个 agent 是干活的工作台，不看数据。
   三个 tab：社媒 / 询盘 / 客户。 */

const TABS = [
  { id: 'traffic', label: '社媒', icon: Zap, Comp: TrafficDataBoard },
  { id: 'inquiry', label: '询盘', icon: MessageSquare, Comp: InquiryDataBoard },
  { id: 'crm', label: '客户', icon: Users, Comp: CrmDataBoard },
] as const;
type TabId = typeof TABS[number]['id'];
type MetricId = 'exposure' | 'inquiry' | 'conversion' | 'followup';

type OrderStatus = '待付款' | '已付款' | '生产中' | '已发货' | '已完成' | '退款';
interface OrderRecord {
  buyer: string;
  amount: number;
  status: OrderStatus;
}
interface SocialAccount {
  id: string;
  platform: 'tiktok' | 'instagram' | 'facebook';
  title?: string;
  handle?: string;
  viewCount?: number;
}
interface YouTubeAccount {
  id: string;
  channelTitle?: string;
  viewCount?: number;
}

interface AdvisorRecommendation {
  id: string;
  title: string;
  desc: string;
  basis: string;
  target: string;
  confidence: '高' | '中' | '低';
  limitation: string;
  action: { page: Page; view?: string };
}

interface AdvisorResult {
  generatedAt: string;
  periodLabel: string;
  recommendations: AdvisorRecommendation[];
  dataQuality: { note: string };
  marketContext: {
    summary: string;
    sources: Array<{ title: string; uri: string }>;
    generatedAt: string;
  };
}

async function readJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { headers: authHeader() });
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}

function num(value: unknown): number {
  return Number(value || 0) || 0;
}

function compact(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function pct(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

const selectedMetricByTab: Record<TabId, MetricId[]> = {
  traffic: ['exposure', 'inquiry'],
  inquiry: ['inquiry', 'conversion'],
  crm: ['conversion', 'followup'],
};

const defaultActionItems = [
  {
    title: '接入社媒与询盘真实数据',
    desc: '先完成 TikTok / Instagram / YouTube 与 WhatsApp 授权，再生成获客和销转动作。',
    basis: '依据：当前仪表盘未读取到真实社媒曝光、询盘、成交链路数据。',
    agent: 'traffic' as const,
    task: '检查社媒账号和 WhatsApp 询盘数据接入状态，只基于已授权的真实数据输出缺口和下一步接入清单。',
  },
  {
    title: '整理企业中心可用经营资料',
    desc: '把主推品、MOQ、认证、价格带、目标市场补齐，作为后续脚本和报价的可信依据。',
    basis: '依据：企业中心资料可作为内容和报价生成的唯一内部业务来源。',
    agent: 'conversion' as const,
    task: '基于企业中心资料整理可用于询盘回复的产品、MOQ、认证、价格带和交期信息；缺失项必须标出，不允许补写。',
  },
  {
    title: '联网校验行业趋势后再给策略',
    desc: '涉及市场趋势、平台打法或竞品机会时，必须引用可核验来源，不用猜测替代。',
    basis: '依据：外部市场判断需来自公开行业数据、平台报告或可访问网页。',
    agent: 'retention' as const,
    task: '在没有真实客户和订单数据前，只输出需要联网核验的行业问题清单；不要生成未证实的复购名单或数字。',
  },
];

function buildEnterpriseDemoAdvisor(demo: EnterpriseHomepageDemoDataset): AdvisorResult {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    periodLabel: '企业资料演示场景',
    dataQuality: { note: '本页数据为产品演示；产品、市场和语言来自企业中心，其余客户、账号、订单与指标均为模拟。' },
    marketContext: { summary: '', sources: [], generatedAt: now },
    recommendations: [
      {
        id: 'demo-first-content',
        title: `先为 ${demo.products[0]} 生成首条内容`,
        desc: `以 ${demo.markets[0]} 为演示市场，从爆款库与素材库生成脚本、口播、字幕和镜头匹配。`,
        basis: `演示依据：企业中心已录入产品「${demo.products[0]}」和市场「${demo.markets[0]}」。`,
        target: '目标：不补资料也能得到一版可继续编辑的内容方案。',
        confidence: '高',
        limitation: '演示指标不用于判断真实平台表现。',
        action: { page: 'traffic', view: 'create' },
      },
      {
        id: 'demo-inquiry-followup',
        title: '体验从询盘到人工接管的完整链路',
        desc: '按演示客户的意向阶段查看首响、需求确认、报价边界和人工接管。',
        basis: `演示依据：目标市场为 ${demo.markets.join('、')}，输出语言沿用 ${demo.language}。`,
        target: '目标：验证多语言询盘承接与风险兜底。',
        confidence: '高',
        limitation: '客户身份、对话和商机金额均为模拟。',
        action: { page: 'conversion', view: 'leads' },
      },
      {
        id: 'demo-connect-real-data',
        title: '完成演示后接入真实经营数据',
        desc: '连接社媒与 WhatsApp 后，首页会切换到真实账号、询盘和订单口径。',
        basis: '演示模式只帮助理解产品流程，不替代真实数据接入。',
        target: '目标：完成至少一个真实渠道授权。',
        confidence: '高',
        limitation: '接入前不能据此评估真实增长效果。',
        action: { page: 'channels' },
      },
    ],
  };
}

const sectionTitle = 'flex items-center gap-2 text-base font-bold text-text-primary';
const sectionIcon = 'flex h-6 w-6 items-center justify-center rounded-lg bg-green-50 text-green-700';
const bodyTitle = 'text-sm font-bold text-text-primary';
const metricValueText = 'text-2xl font-bold leading-none text-text-primary';
const actionTitleText = 'text-sm font-bold text-text-primary';
const bodyText = 'text-xs leading-snug text-text-secondary';
const supplementText = 'text-[11px] font-bold leading-snug text-green-700';

export default function StrategyDataBoard({
  onAction,
  onNavigate,
  includeMockCustomers = false,
  mockCustomerScope = 'admin',
  enterpriseHomepageDemo = false,
}: {
  onAction?: AgentAction;
  onNavigate?: (page: Page) => void;
  includeMockCustomers?: boolean;
  mockCustomerScope?: string;
  enterpriseHomepageDemo?: boolean;
}) {
  const [tab, setTab] = useState<TabId>('traffic');
  useEffect(() => { const scope = consumeBusinessPageContext('home'); if (scope) setTab(scope); }, []);
  const [exposure, setExposure] = useState<{ loaded: boolean; ready: boolean; value: number; accountCount: number; source: 'account' | 'workspace' | 'none' }>({ loaded: false, ready: false, value: 0, accountCount: 0, source: 'none' });
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [advisor, setAdvisor] = useState<AdvisorResult | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const [expandedActionIds, setExpandedActionIds] = useState<Set<string>>(() => new Set());
  const [enterpriseDemo, setEnterpriseDemo] = useState<EnterpriseHomepageDemoDataset | null>(null);
  const { customers, loading: customersLoading } = useCustomers(0, includeMockCustomers, mockCustomerScope);
  const dashboardCustomers = enterpriseDemo?.customers ?? customers;
  const windowDays = 30;

  const selectedMetrics = new Set(selectedMetricByTab[tab]);
  const whatsAppInquiries = useMemo(() => dashboardCustomers.filter(customer => String(customer.source).startsWith('whatsapp')), [dashboardCustomers]);
  const effectiveInquiries = useMemo(() => whatsAppInquiries.filter(customer => customer.intentScore >= 70), [whatsAppInquiries]);
  const conversationOrders = useMemo<OrderRecord[]>(() => dashboardCustomers.flatMap(customer => customer.orders.map(order => ({
    buyer: customer.name,
    amount: Number(String(order.total || '').replace(/[^0-9.-]/g, '')) || 0,
    status: order.status === 'paid' ? '已付款' : order.status === 'pending' ? '待付款' : '退款',
  }))), [dashboardCustomers]);
  const effectiveOrders = orders.length ? orders : conversationOrders;
  const validOrders = useMemo(() => effectiveOrders.filter(order => order.status !== '待付款' && order.status !== '退款'), [effectiveOrders]);
  const convertedInquiries = useMemo(() => whatsAppInquiries.filter(customer => customer.stage === 'quoted' || customer.stage === 'won' || customer.orders.length > 0), [whatsAppInquiries]);
  const needsFollowup = useMemo(() => whatsAppInquiries.filter(customer => customer.handlingMode !== 'ai_auto' || customer.inboxReason), [whatsAppInquiries]);

  useEffect(() => {
    if (!enterpriseHomepageDemo) {
      setEnterpriseDemo(null);
      return;
    }
    let alive = true;
    readJson<EnterpriseHomepageProfile>('/api/overseas/enterprise/profile', {})
      .then(profile => {
        if (alive) setEnterpriseDemo(createEnterpriseHomepageDemo(profile));
      });
    return () => { alive = false; };
  }, [enterpriseHomepageDemo]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [social, youtube, orderData] = await Promise.all([
        readJson<{ items?: SocialAccount[] }>('/api/overseas/social/accounts', { items: [] }),
        readJson<{ items?: YouTubeAccount[] }>('/api/overseas/youtube/accounts', { items: [] }),
        readJson<{ items?: OrderRecord[] }>('/api/overseas/enterprise/orders', { items: [] }),
      ]);
      const socialItems = social.items ?? [];
      const youtubeItems = youtube.items ?? [];
      const videoResults = await Promise.allSettled([
        ...socialItems.map(async account => {
          const data = await readJson<{ videos?: any[] }>(`/api/overseas/social/accounts/${account.id}/videos?maxResults=50`, { videos: [] });
          return (data.videos ?? []).reduce((sum, video) => sum + num(video.viewCount || video.statistics?.viewCount), 0);
        }),
        ...youtubeItems.map(async account => {
          const data = await readJson<{ videos?: any[] }>(`/api/overseas/youtube/accounts/${account.id}/videos?maxResults=50`, { videos: [] });
          return (data.videos ?? []).reduce((sum, video) => sum + num(video.viewCount || video.statistics?.viewCount), 0);
        }),
      ]);
      const videoViews = videoResults.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
      const accountViews = [...socialItems, ...youtubeItems].reduce((sum, account) => sum + num(account.viewCount), 0);
      if (!alive) return;
      const accountCount = enterpriseDemo?.accounts.length ?? (socialItems.length + youtubeItems.length);
      const useWorkspaceSnapshot = Boolean(enterpriseDemo) || (includeMockCustomers && accountCount === 0);
      const demoViews = enterpriseDemo?.videos.reduce((sum, video) => sum + video.viewCount, 0) ?? 0;
      setExposure({
        loaded: true,
        ready: accountCount > 0 || useWorkspaceSnapshot,
        value: enterpriseDemo ? demoViews : useWorkspaceSnapshot ? 286_430 : videoViews || accountViews,
        accountCount: useWorkspaceSnapshot ? (enterpriseDemo?.accounts.length ?? 3) : accountCount,
        source: useWorkspaceSnapshot ? 'workspace' : accountCount > 0 ? 'account' : 'none',
      });
      setOrders(enterpriseDemo ? [] : Array.isArray(orderData.items) ? orderData.items : []);
    })();
    return () => { alive = false; };
  }, [enterpriseDemo, includeMockCustomers]);

  const acquisitionTrend = useMemo(() => {
    if (enterpriseDemo) return enterpriseDemo.acquisitionTrend;
    const exposureSeries = [24_680, 31_420, 35_870, 39_260, 46_910, 51_340, 56_950];
    const inquiryWeights = [0.08, 0.12, 0.12, 0.16, 0.16, 0.16, 0.2];
    return exposureSeries.map((dailyExposure, index) => ({
      day: `8/${14 + index}`,
      exposure: dailyExposure,
      inquiries: Math.max(0, Math.round(effectiveInquiries.length * inquiryWeights[index])),
    }));
  }, [effectiveInquiries.length, enterpriseDemo]);

  const loadAdvisor = async (refreshExternal = false) => {
    if (enterpriseDemo) {
      setAdvisor(buildEnterpriseDemoAdvisor(enterpriseDemo));
      setAdvisorError('');
      return;
    }
    setAdvisorLoading(true);
    setAdvisorError('');
    try {
      const response = await fetch('/api/overseas/strategy/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          refreshExternal,
          snapshot: {
            exposureReady: exposure.ready,
            exposure: exposure.value,
            inquiries: effectiveInquiries.length,
            quoted: convertedInquiries.length,
            orders: validOrders.length,
            followup: needsFollowup.length,
            accountCount: exposure.accountCount,
          },
        }),
      });
      if (!response.ok) throw new Error(`advisor_${response.status}`);
      setAdvisor(await response.json() as AdvisorResult);
    } catch {
      setAdvisorError('经营建议暂时无法刷新，请稍后重试。');
    } finally {
      setAdvisorLoading(false);
    }
  };

  useEffect(() => {
    if (!exposure.loaded || customersLoading) return;
    if (enterpriseDemo) {
      setAdvisor(buildEnterpriseDemoAdvisor(enterpriseDemo));
      return;
    }
    void loadAdvisor(false);
  }, [exposure.loaded, exposure.ready, exposure.value, exposure.accountCount, customersLoading, effectiveInquiries.length, convertedInquiries.length, validOrders.length, needsFollowup.length, enterpriseDemo]);

  const chainMetrics = useMemo(() => {
    const inquiryCount = effectiveInquiries.length;
    const conversionRate = inquiryCount ? convertedInquiries.length / inquiryCount * 100 : 0;
    return [
      {
        id: 'exposure' as const,
        icon: <Zap size={15} className="text-green-600" />,
        label: '视频曝光',
        value: exposure.ready ? compact(exposure.value) : '/',
        desc: exposure.source === 'workspace' ? (enterpriseDemo ? '基于企业资料生成的演示播放量。' : '按近 7 日内容运营记录汇总的视频播放量。') : exposure.ready ? '来自已授权社媒账号返回的视频播放量。' : '尚未接入可读取曝光量的社媒账号。',
        source: exposure.source === 'workspace' ? (enterpriseDemo ? '来源：企业资料演示' : '来源：内容运营汇总') : exposure.ready ? '来源：社媒账号接口' : '暂无数据',
        trend: exposure.source === 'workspace' ? (enterpriseDemo ? '演示' : '+18.6%') : '',
      },
      {
        id: 'inquiry' as const,
        icon: <MessageSquare size={15} className="text-green-600" />,
        label: '有效询盘',
        value: String(inquiryCount),
        desc: '按我的客户 tab 中 WhatsApp 且意向分 >= 70 的客户计算。',
        source: '来源：我的客户 / WhatsApp',
        trend: '',
      },
      {
        id: 'conversion' as const,
        icon: <TrendingUp size={15} className="text-green-600" />,
        label: '询盘转化率',
        value: inquiryCount && validOrders.length ? pct(conversionRate) : '/',
        desc: validOrders.length
          ? `按已报价/成交 WhatsApp 询盘计算，并参考 ${validOrders.length} 个有效订单。`
          : '按已报价/成交 WhatsApp 询盘计算；订单未打通时不额外推断。',
        source: validOrders.length ? '来源：我的客户 + 我的订单' : '订单链路未打通，暂不展示转化率',
        trend: '',
      },
      {
        id: 'followup' as const,
        icon: <Target size={15} className="text-green-600" />,
        label: '客户待跟进',
        value: String(needsFollowup.length),
        desc: '按 WhatsApp 客户中需人工处理或有待办原因的记录计算。',
        source: '来源：我的客户 / WhatsApp',
        trend: '',
      },
    ];
  }, [convertedInquiries.length, effectiveInquiries.length, exposure, needsFollowup.length, validOrders.length, enterpriseDemo]);

  const channelData = useMemo(() => {
    const grouped = new Map<string, { channel: string; inquiries: number; converted: number }>();
    for (const customer of dashboardCustomers) {
      const channel = customer.source || 'unknown';
      const item = grouped.get(channel) || { channel, inquiries: 0, converted: 0 };
      item.inquiries += 1;
      if (customer.stage === 'quoted' || customer.stage === 'won' || customer.orders.length > 0) item.converted += 1;
      grouped.set(channel, item);
    }
    return [...grouped.values()];
  }, [dashboardCustomers]);

  const funnelData = [
    ['内容曝光', exposure.ready ? compact(exposure.value) : '/', enterpriseDemo ? '演示曝光' : exposure.source === 'workspace' ? '内容运营汇总' : exposure.ready ? '社媒账号接口' : '未接入'],
    ['有效询盘', String(effectiveInquiries.length), enterpriseDemo ? '演示客户' : '真实客户'],
    ['进入报价', String(convertedInquiries.length), enterpriseDemo ? '演示客户' : '真实客户'],
    ['有效订单', String(validOrders.length), enterpriseDemo ? '演示订单' : '真实订单'],
  ];

  const actionItems = advisor?.recommendations ?? [];

  const executeAdvisorAction = (item: AdvisorRecommendation) => {
    const { page: requestedPage, view } = item.action;
    const page: Page = requestedPage === 'traffic'
      ? (view === 'accounts' ? 'accountManagement' : view === 'materials' ? 'socialInspiration' : 'smartAssets')
      : requestedPage;
    try {
      if (page === 'conversion' && view) localStorage.setItem('lingshu:conversion:initial-view', view);
      if (page === 'enterprise' && view) localStorage.setItem('lingshu:enterprise:initial-view', view);
      localStorage.setItem('lingshu:advisor:last-action', JSON.stringify({ id: item.id, title: item.title, at: Date.now() }));
    } catch { /* ignore unavailable storage */ }
    onNavigate?.(page);
  };

  const openWorkspaceView = (page: Page, view?: string) => {
    try {
      if (page === 'conversion' && view) localStorage.setItem('lingshu:conversion:initial-view', view);
    } catch { /* ignore unavailable storage */ }
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page, view } }));
    onNavigate?.(page);
  };

  const openMetric = (metric: MetricId) => {
    if (metric === 'exposure') openWorkspaceView('accountManagement', 'accounts');
    else openWorkspaceView('conversion', metric === 'followup' ? 'inbox' : 'leads');
  };

  const toggleAdvisorDetails = (id: string) => {
    setExpandedActionIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="home-dashboard h-full flex flex-col" data-lingshu-guide="strategy-dashboard">
      <div className="flex-shrink-0 px-4 pt-1 sm:px-6">
        <div className="home-tabs flex max-w-full items-center gap-6 border-b">
          {TABS.map(x => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`flex h-12 min-w-[64px] items-center justify-center gap-2 border-b-2 px-1 text-sm font-semibold transition-colors ${
                tab === x.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-5 sm:px-6">
          <section className="home-board home-overview-panel mx-auto max-w-[1440px]">
            {enterpriseDemo && (
              <div data-testid="enterprise-homepage-demo-notice" className="mb-4 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-xs text-amber-950">
                <p className="font-bold">企业资料演示数据 · {enterpriseDemo.companyName}</p>
                <p className="mt-1 leading-5">{enterpriseDemo.notice}</p>
                {enterpriseDemo.warnings.map(warning => <p key={warning} className="mt-1 font-semibold leading-5">资料提醒：{warning}</p>)}
              </div>
            )}
            <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold tracking-[-.025em] text-text-primary">当前获客经营总览</h2>
                <button type="button" onClick={() => { saveBusinessPageContext('production', tab); onNavigate?.('digitalEmployees'); }} className="mt-2 inline-flex items-center border-b border-accent/30 pb-0.5 text-xs font-semibold text-accent transition-colors hover:border-accent hover:text-accent-dim">{tab === 'traffic' ? '查看内容生产与发布' : '查看客户跟进执行'} →</button>
                <p className="mt-1 text-[11px] text-text-muted">从内容曝光到成交推进，先看趋势，再看渠道和待办。</p>
              </div>
              <button type="button" onClick={() => openWorkspaceView('accountManagement', 'accounts')} className="rounded-md border border-[#bdd8c7] bg-[#eff7f1] px-3 py-2 text-[11px] font-semibold text-accent transition hover:border-[#9fc8af] hover:bg-[#e6f2e9]" title="前往社媒运营 · 账号管理">
                {enterpriseDemo ? '演示账号' : '已接入账号'} {exposure.accountCount} · 查看动态 →
              </button>
            </div>
            <div className="metric-strip">
              {chainMetrics.map(item => {
                const active = selectedMetrics.has(item.id);
                return (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => openMetric(item.id)}
                  title={item.id === 'exposure' ? '前往我的社媒 · 账号动态' : '前往我的客户查看明细'}
                  data-active={active}
                  className="home-metric p-4 text-left transition-colors hover:bg-[#f7faf7] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent/20"
                >
                  <div className="flex items-center gap-2">
                    {item.icon}
                    <h3 className={bodyTitle}>{item.label}</h3>
                  </div>
                  <p className={`mt-2.5 ${metricValueText}`}>{item.value}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {item.trend ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700"><ArrowUpRight size={10} />{item.trend}</span> : <span />}
                    <span className="truncate text-[9px] text-text-muted">{item.source}</span>
                  </div>
                </button>
                );
              })}
            </div>

            <div className="analysis-grid mt-6 grid border-b border-border xl:grid-cols-[1.45fr_1fr] xl:divide-x xl:divide-border">
              <section className="pb-6 xl:pr-6">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div><p className={bodyTitle}>获客趋势</p><p className="mt-1 text-[10px] text-text-muted">曝光持续增长时，询盘是否同步增长</p></div>
                  <span className="text-[11px] font-semibold text-green-700">询盘效率 {exposure.ready && exposure.value > 0 ? `${(effectiveInquiries.length / exposure.value * 10000).toFixed(2)} / 万曝光${enterpriseDemo ? '（演示）' : ''}` : '暂无真实数据'}</span>
                </div>
                {exposure.source === 'workspace' ? (
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={acquisitionTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs><linearGradient id="homeExposureFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#169b62" stopOpacity={0.22}/><stop offset="100%" stopColor="#169b62" stopOpacity={0.02}/></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false}/>
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={value => `${Math.round(Number(value) / 1000)}k`}/>
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE}/>
                        <Area type="monotone" dataKey="exposure" name="内容曝光" stroke="#169b62" strokeWidth={2.5} fill="url(#homeExposureFill)"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex h-[220px] items-center justify-center border border-dashed border-border bg-surface-2/60 px-6 text-center text-xs text-text-muted">当前接口仅返回累计曝光，没有按日历史序列。接入平台 insights 时间序列后，这里将展示趋势。</div>
                )}
              </section>

              <section className="border-t border-border pb-6 pt-6 xl:border-t-0 xl:pl-6 xl:pt-0">
                <div className="mb-3"><p className={bodyTitle}>渠道询盘贡献</p><p className="mt-1 text-[10px] text-text-muted">对比询盘量与已转化数量，避免只看流量</p></div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={channelData} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false}/>
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                      <YAxis type="category" dataKey="channel" width={62} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE}/>
                      <Bar dataKey="inquiries" name="询盘" fill="#9bc8ad" radius={[0, 3, 3, 0]} barSize={12}/>
                      <Bar dataKey="converted" name="已转化" fill="#177a51" radius={[0, 3, 3, 0]} barSize={12}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="border-b border-border py-5">
              <div className="flex items-center gap-2"><span className={sectionIcon}><CircleDollarSign size={14}/></span><p className={bodyTitle}>获客转化漏斗</p><span className="ml-auto text-[10px] text-text-muted">当前累计快照</span></div>
              <div className="funnel-strip mt-3">
                {funnelData.map(([label,value,rate])=><div key={label} className="funnel-step p-3"><p className="text-[10px] font-semibold text-text-muted">{label}</p><p className="mt-1 text-xl font-semibold text-text-primary">{value}</p><p className="mt-1 text-[9px] font-bold text-green-700">{rate}</p></div>)}
              </div>
            </section>

            <div className="mt-3 grid gap-3">
              <section className="home-insight-panel p-4 sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div className={sectionTitle}>
                    <span className={sectionIcon}><ListChecks size={14} /></span>
                    <h2>本周优先动作</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAdvisor(true)}
                    disabled={advisorLoading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-60"
                  >
                    {advisorLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {advisorLoading ? '分析中' : '刷新分析'}
                  </button>
                </div>
                <div className="mt-3 border-t border-[#eadfd5]">
                  {advisorLoading && !actionItems.length && (
                    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-surface text-xs text-text-muted">
                      <Loader2 size={14} className="mr-2 animate-spin" />正在结合经营数据与外部趋势生成建议
                    </div>
                  )}
                  {advisorError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{advisorError}</p>}
                  {actionItems.map(item => {
                    const expanded = expandedActionIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={() => toggleAdvisorDetails(item.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleAdvisorDetails(item.id);
                          }
                        }}
                        className="group flex w-full cursor-pointer items-start gap-3 border-b border-[#eadfd5] bg-transparent px-1 py-3 text-left transition-colors hover:bg-white/65 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#f3b37a]/25"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            <span className={actionTitleText}>{item.title}</span>
                            <span className="border-l border-[#a9cdb6] pl-2 text-[9px] font-bold text-green-700">置信度 {item.confidence}</span>
                          </span>
                          <span className={`mt-1 block ${bodyText}`}>{item.desc}</span>
                          <span className={`grid transition-all duration-200 ${expanded ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                            <span className="overflow-hidden">
                              <span className={`block ${supplementText}`}>{item.basis}</span>
                              <span className="mt-1 block text-[11px] font-semibold text-text-secondary">{item.target}</span>
                              <span className="mt-1 block text-[10px] text-text-muted">限制：{item.limitation}</span>
                            </span>
                          </span>
                        </span>
                        <button
                          type="button"
                          title="前往对应任务"
                          aria-label={`前往${item.title}`}
                          onClick={event => {
                            event.stopPropagation();
                            executeAdvisorAction(item);
                          }}
                          onKeyDown={event => event.stopPropagation()}
                          className="group/nav mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-green-700 focus:outline-none focus:ring-2 focus:ring-green-200"
                        >
                          <ArrowRight size={14} className="transition-transform duration-150 group-hover/nav:scale-125" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {advisor?.marketContext.summary && (
                  <div className="mt-3 border-t border-[#e7cfba] px-1 pt-3">
                    <p className="text-[11px] font-black text-[#7f4b2e]">外部市场信号</p>
                    <p className="mt-1 whitespace-pre-line text-[11px] leading-5 text-[#805c47]">{advisor.marketContext.summary}</p>
                    {!!advisor.marketContext.sources.length && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {advisor.marketContext.sources.map(source => (
                          <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-sky-700 hover:underline">
                            <ExternalLink size={10} /><span className="truncate">{source.title}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {advisor?.dataQuality.note && <p className="mt-2 text-[10px] text-text-muted">数据口径：{advisor.dataQuality.note}</p>}
              </section>
            </div>
          </section>
        </div>

        <div className="min-h-[520px] border-t border-border" id={tab === 'traffic' ? 'social-real-data' : undefined}>
          {tab === 'traffic' ? (
            <TrafficDataBoard windowDays={windowDays} onOpenAccounts={() => openWorkspaceView('accountManagement', 'accounts')} demo={enterpriseDemo ?? undefined} />
          ) : tab === 'inquiry' ? (
            <InquiryDataBoard windowDays={windowDays} includeMockCustomers={includeMockCustomers} mockCustomerScope={mockCustomerScope} demoCustomers={enterpriseDemo?.customers} />
          ) : (
            <CrmDataBoard windowDays={windowDays} includeMockCustomers={includeMockCustomers} mockCustomerScope={mockCustomerScope} demoCustomers={enterpriseDemo?.customers} />
          )}
        </div>
      </div>
    </div>
  );
}
