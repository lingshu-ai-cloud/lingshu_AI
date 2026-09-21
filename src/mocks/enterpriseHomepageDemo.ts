import type { CustomerProfile } from '../types/customer';

export const ENTERPRISE_HOMEPAGE_DEMO_ACCOUNT = 'lingshu-admin@local.test';

export interface EnterpriseHomepageProfile {
  company?: {
    name?: string;
    industry?: string;
    mainMarkets?: string;
    primaryLanguages?: string;
  };
  products?: {
    categories?: string;
    items?: Array<{ name?: string; category?: string }>;
  };
  brand?: { preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
}

export interface EnterpriseHomepageDemoVideo {
  id: string;
  platform: 'tiktok' | 'instagram' | 'facebook' | 'youtube';
  account: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export interface EnterpriseHomepageDemoAccount {
  id: string;
  platform: EnterpriseHomepageDemoVideo['platform'];
  name: string;
  followers: number;
  videos: number;
  views: number;
  status: 'demo';
}

export interface EnterpriseHomepageDemoDataset {
  synthetic: true;
  label: '企业资料演示数据';
  notice: string;
  companyName: string;
  industry: string;
  products: string[];
  markets: string[];
  language: string;
  warnings: string[];
  customers: CustomerProfile[];
  accounts: EnterpriseHomepageDemoAccount[];
  videos: EnterpriseHomepageDemoVideo[];
  acquisitionTrend: Array<{ day: string; exposure: number; inquiries: number }>;
}

export function isEnterpriseHomepageDemoAccount(email: unknown): boolean {
  return String(email || '').trim().toLowerCase() === ENTERPRISE_HOMEPAGE_DEMO_ACCOUNT;
}

function splitList(value: unknown): string[] {
  return String(value || '')
    .split(/[\n,，;；、|/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}

function stableSeed(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function demoCustomer(input: {
  index: number;
  product: string;
  market: string;
  language: string;
  targetProfile: string;
  stage: CustomerProfile['stage'];
  source: CustomerProfile['source'];
  intentScore: number;
  lastActive: string;
  daysAgo: number;
  order?: boolean;
}): CustomerProfile {
  const letter = String.fromCharCode(65 + input.index);
  const stageLabel: Record<CustomerProfile['stage'], string> = {
    lead: '首次咨询',
    inquiry: '需求确认',
    quoted: '报价沟通',
    won: '成交复购',
    silent30: '沉默唤醒',
    silent60: '长期沉默',
  };
  const orderTotal = 12_000 + input.index * 4_500;
  const buyerMessage = `我们正在评估 ${input.product}，请先提供适用场景、起订条件和下一步需要确认的资料。`;
  return {
    id: `enterprise-home-demo-${input.index + 1}`,
    name: `演示买家 ${letter} · ${input.market}`,
    avatar: letter,
    countryName: input.market,
    language: input.language,
    languageLocked: true,
    source: input.source,
    product: input.product,
    outboundProduct: input.product,
    estimatedValue: input.order ? `演示订单 US$${orderTotal.toLocaleString('en-US')}` : '演示商机 · 待人工确认',
    stage: input.stage,
    intentScore: input.intentScore,
    intentSignals: [stageLabel[input.stage], `关注 ${input.product}`, input.targetProfile || '目标客户场景'],
    handlingMode: input.stage === 'quoted' || input.stage === 'won' ? 'human_needed' : 'ai_draft',
    handlingReason: `演示场景：根据企业资料中的产品与市场生成，不代表真实客户状态。`,
    priority: input.intentScore,
    inboxReason: input.stage === 'quoted' || input.stage === 'won' ? 'call' : 'reply',
    lastActive: input.lastActive,
    lastActiveAt: Date.now() - input.daysAgo * 24 * 60 * 60 * 1000,
    localTime: '演示',
    orders: input.order ? [{
      id: `enterprise-home-demo-order-${input.index + 1}`,
      status: 'paid',
      total: `US$${orderTotal.toLocaleString('en-US')}`,
      createdAt: isoDaysAgo(input.daysAgo).slice(0, 10),
      items: [{ name: input.product, qty: input.index + 1 }],
    }] : [],
    tags: ['演示数据', input.market, input.product],
    summary: `${input.market} 的${input.targetProfile || '潜在买家'}正在评估 ${input.product}，当前处于${stageLabel[input.stage]}阶段。`,
    nextStep: input.stage === 'quoted' || input.stage === 'won'
      ? '由人工核对价格、交期和承诺后再推进'
      : '先确认使用场景、数量、规格和采购时间，不补写企业资料外的承诺',
    hasUnread: input.stage !== 'won',
    isReal: false,
    isMock: true,
    simulation: {
      checkpoint: `首页演示 · ${stageLabel[input.stage]}`,
      goal: '展示从社媒获客到 WhatsApp 承接的产品流程。',
      expectedBehavior: '仅用于产品体验，不得发送给真实客户或用于经营结论。',
      memoryApplied: [input.product, input.market, input.targetProfile].filter(Boolean),
    },
    timeline: [{
      id: `enterprise-home-demo-message-${input.index + 1}`,
      type: 'whatsapp',
      actor: 'buyer',
      title: '演示客户消息',
      body: buyerMessage,
      time: isoDaysAgo(input.daysAgo),
      timestamp: Date.now() - input.daysAgo * 24 * 60 * 60 * 1000,
    }],
  };
}

export function createEnterpriseHomepageDemo(profile: EnterpriseHomepageProfile): EnterpriseHomepageDemoDataset {
  const companyName = String(profile.company?.name || '').trim() || '当前企业';
  const industry = String(profile.company?.industry || '').trim() || '未配置行业';
  const products = unique([
    ...splitList(profile.strategy?.focusProducts),
    ...(profile.products?.items || []).map(item => String(item.name || item.category || '')),
    ...splitList(profile.products?.categories),
  ]).slice(0, 4);
  if (!products.length) products.push('企业主营产品');
  const markets = unique([
    ...splitList(profile.strategy?.focusMarkets),
    ...splitList(profile.company?.mainMarkets),
  ]).slice(0, 4);
  if (!markets.length) markets.push('目标市场待补充');
  const language = splitList(profile.brand?.preferredLanguages || profile.company?.primaryLanguages)[0] || '企业首选语言待补充';
  const targetProfile = splitList(profile.customers?.targetProfiles)[0] || '目标客户';
  const companyCategories = unique([industry, ...splitList(profile.products?.categories)]).filter(item => item !== '未配置行业');
  const warnings = (profile.products?.items || []).flatMap(item => {
    const itemName = String(item.name || '').trim();
    const itemCategory = String(item.category || '').trim();
    if (!itemName || !itemCategory || !companyCategories.length || companyCategories.includes(itemCategory)) return [];
    return [`企业中心的产品「${itemName}」品类为「${itemCategory}」，与企业行业/主营品类「${companyCategories.join('、')}」不一致；演示仍按已录入字段展示，请在企业中心核对。`];
  });
  const seed = stableSeed(`${companyName}|${industry}|${products.join('|')}|${markets.join('|')}`);
  const scenarios: Array<Pick<Parameters<typeof demoCustomer>[0], 'stage' | 'source' | 'intentScore' | 'lastActive' | 'daysAgo' | 'order'>> = [
    { stage: 'lead', source: 'whatsapp_from_tiktok', intentScore: 62, lastActive: '刚刚', daysAgo: 0 },
    { stage: 'inquiry', source: 'whatsapp_from_youtube', intentScore: 76, lastActive: '8分钟前', daysAgo: 0 },
    { stage: 'inquiry', source: 'whatsapp_from_instagram', intentScore: 82, lastActive: '35分钟前', daysAgo: 0 },
    { stage: 'quoted', source: 'whatsapp_from_facebook', intentScore: 91, lastActive: '2小时前', daysAgo: 0 },
    { stage: 'won', source: 'whatsapp_from_youtube', intentScore: 94, lastActive: '2天前', daysAgo: 2, order: true },
    { stage: 'silent30', source: 'whatsapp_from_facebook', intentScore: 58, lastActive: '31天前', daysAgo: 31 },
  ];
  const customers = scenarios.map((scenario, index) => demoCustomer({
    ...scenario,
    index,
    product: products[index % products.length],
    market: markets[index % markets.length],
    language,
    targetProfile,
  }));
  const platforms: EnterpriseHomepageDemoVideo['platform'][] = ['tiktok', 'youtube', 'instagram'];
  const accounts = platforms.map((platform, index) => ({
    id: `enterprise-home-demo-account-${platform}`,
    platform,
    name: `${companyName} · ${platform} 演示账号`,
    followers: 860 + ((seed >> (index * 3)) % 1_900),
    videos: 8 + index * 3,
    views: 48_000 + ((seed >> (index * 4)) % 42_000),
    status: 'demo' as const,
  }));
  const videos = Array.from({ length: 6 }, (_, index) => {
    const platform = platforms[index % platforms.length];
    const account = accounts.find(item => item.platform === platform)!;
    return {
      id: `enterprise-home-demo-video-${index + 1}`,
      platform,
      account: account.name,
      title: `演示选题｜${products[index % products.length]} · ${markets[index % markets.length]}`,
      publishedAt: isoDaysAgo(index + 1),
      viewCount: 9_800 + ((seed >> index) % 18_000),
      likeCount: 320 + ((seed >> (index + 2)) % 1_300),
      commentCount: 18 + ((seed >> (index + 3)) % 120),
      shareCount: 8 + ((seed >> (index + 4)) % 70),
    };
  });
  const dailyBase = 14_000 + seed % 6_000;
  const inquiryWeights = [0, 1, 1, 2, 3, 4, 6];
  const acquisitionTrend = inquiryWeights.map((inquiries, index) => ({
    day: `第 ${index + 1} 天`,
    exposure: dailyBase + index * 2_300 + ((seed >> index) % 1_400),
    inquiries,
  }));
  return {
    synthetic: true,
    label: '企业资料演示数据',
    notice: `以下客户、账号、订单和经营指标均为基于「${companyName}」企业资料生成的产品演示，不代表真实经营结果。`,
    companyName,
    industry,
    products,
    markets,
    language,
    warnings,
    customers,
    accounts,
    videos,
    acquisitionTrend,
  };
}
