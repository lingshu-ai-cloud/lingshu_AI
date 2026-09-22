export const PAGE_IDS = [
  'startupHub',
  'digitalEmployees',
  'agentMonitor',
  'strategy',
  'traffic',
  'socialInspiration',
  'scriptLibrary',
  'smartAssets',
  'socialMonitoring',
  'accountManagement',
  'adsOverview',
  'adsPlans',
  'adsCreatives',
  'adsManaged',
  'conversion',
  'wecomCustomerService',
  'retention',
  'orders',
  'enterprise',
  'plugins',
  'scheduled',
  'admin',
  'adminDelivery',
  'channels',
  'youtube',
  'agentMemory',
  'organizationPermissions',
] as const;

export type Page = typeof PAGE_IDS[number];

export type PageDefinition = {
  /** Stable text used by the primary navigation. */
  navLabel: string;
  /** The one canonical H1 for this product surface. */
  canonicalTitle: string;
  /** Visible navigation item highlighted for a compatible legacy route. */
  navParent?: Page;
};

export const PAGE_REGISTRY: Record<Page, PageDefinition> = {
  startupHub: { navLabel: '创业中台', canonicalTitle: '创业中台' },
  digitalEmployees: { navLabel: '智能经营', canonicalTitle: '智能经营' },
  agentMonitor: { navLabel: '运行监控', canonicalTitle: '运行监控' },
  strategy: { navLabel: '首页', canonicalTitle: '首页' },
  traffic: { navLabel: '发布与渠道', canonicalTitle: '发布与渠道' },
  socialInspiration: { navLabel: '灵感中心', canonicalTitle: '灵感中心' },
  scriptLibrary: { navLabel: '脚本库', canonicalTitle: '脚本库', navParent: 'smartAssets' },
  smartAssets: { navLabel: '内容制作', canonicalTitle: '内容制作' },
  socialMonitoring: { navLabel: '内容监控', canonicalTitle: '账号内容监控' },
  accountManagement: { navLabel: '渠道设置', canonicalTitle: '渠道与授权设置' },
  adsOverview: { navLabel: '投放总览', canonicalTitle: '投放总览' },
  adsPlans: { navLabel: '投放计划', canonicalTitle: '投放计划' },
  adsCreatives: { navLabel: '广告素材', canonicalTitle: '广告素材', navParent: 'adsPlans' },
  adsManaged: { navLabel: 'AI 托管', canonicalTitle: 'AI 托管' },
  conversion: { navLabel: '我的会话', canonicalTitle: '我的会话' },
  wecomCustomerService: { navLabel: '智能客服', canonicalTitle: '智能客服｜企业微信' },
  retention: { navLabel: '我的会话', canonicalTitle: '我的会话', navParent: 'conversion' },
  orders: { navLabel: '订单', canonicalTitle: '订单' },
  enterprise: { navLabel: '企业知识库', canonicalTitle: '企业知识库' },
  plugins: { navLabel: '集成中心', canonicalTitle: '集成中心' },
  scheduled: { navLabel: '定时任务', canonicalTitle: '定时任务' },
  admin: { navLabel: '账号总控', canonicalTitle: '账号总控' },
  adminDelivery: { navLabel: '客户运维', canonicalTitle: '客户运维' },
  channels: { navLabel: '渠道连接', canonicalTitle: '渠道连接', navParent: 'plugins' },
  youtube: { navLabel: 'YouTube 连接', canonicalTitle: 'YouTube 连接', navParent: 'plugins' },
  agentMemory: { navLabel: '智能体记忆', canonicalTitle: '智能体记忆' },
  organizationPermissions: { navLabel: '组织与权限', canonicalTitle: '组织与权限' },
} satisfies Record<Page, PageDefinition>;

/** Primary organic-content destinations. Account authorization stays in settings. */
export const PRIMARY_SOCIAL_NAV_PAGES = [
  'socialInspiration',
  'smartAssets',
  'traffic',
  'socialMonitoring',
] as const satisfies readonly Page[];

const PAGE_ID_SET: ReadonlySet<string> = new Set(PAGE_IDS);

export function isPage(value: unknown): value is Page {
  return typeof value === 'string' && PAGE_ID_SET.has(value);
}

/**
 * Accept old persisted/deep-link page IDs while routing renamed surfaces to
 * their current canonical destination. Keep this at the boundary so callers
 * never need to duplicate legacy handling.
 */
export function resolvePage(value: unknown): Page | null {
  if (!isPage(value)) return null;
  return value === 'retention' ? 'conversion' : value;
}

export type LegacyTrafficView = 'materials' | 'create' | 'publish' | 'accounts';

/** Preserve old umbrella-page links by forwarding each former tab. */
export function resolveNavigationPage(value: unknown, view?: unknown): Page | null {
  const page = resolvePage(value);
  if (page !== 'traffic') return page;
  if (view === 'materials') return 'socialInspiration';
  if (view === 'create') return 'smartAssets';
  if (view === 'accounts') return 'accountManagement';
  return page;
}
