import type { AdReport } from '../lib/adOverview';
import type { PlatformAdTask } from '../lib/platformAds';
import type { OrderStatus } from '../../shared/orderLifecycle';

export const FOREIGN_TRADE_MOCK_PREFIX = 'mock-ft-';
export const FOREIGN_TRADE_FACTORY = '浙江海拓智能装备有限公司';

export function isLocalForeignTradeMockEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
}

const isoDaysFromNow = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString();
};

const dateDaysFromNow = (offset: number) => isoDaysFromNow(offset).slice(0, 10);

export interface ForeignTradeMockOrder {
  id: string;
  orderNo: string;
  buyer: string;
  market: string;
  channel: string;
  product: string;
  quantity: number;
  amount: number;
  cost: number;
  status: OrderStatus;
  orderDate: string;
  owner: string;
  source: string;
  sourceRef: string;
  sourcePostId?: string;
  customerId?: string;
  importedAt?: string;
  updatedAt?: string;
}

export function createForeignTradeMockOrders(): ForeignTradeMockOrder[] {
  return [
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}order-saudi-packaging`,
      orderNo: 'HT-2026-SA-0921',
      buyer: 'Faisal Al-Rashid · Riyadh Foods',
      market: '中东',
      channel: 'WhatsApp',
      product: '高速装箱码垛线（首期 6 条）',
      quantity: 6,
      amount: 420000,
      cost: 294000,
      status: '生产中',
      orderDate: dateDaysFromNow(-7),
      owner: 'Mia',
      source: 'Arabic TikTok → WhatsApp',
      sourceRef: '30% 预付款已核对 · PI-HT-SA-0921',
      sourcePostId: 'tt-ar-packaging-roi-03',
      customerId: 'mock-export-big-order-saudi-packaging',
      importedAt: isoDaysFromNow(-7),
      updatedAt: isoDaysFromNow(-1),
    },
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}order-poland-press`,
      orderNo: 'HT-2026-PL-0924',
      buyer: 'Piotr Nowak · AutoForm Polska',
      market: '欧洲',
      channel: 'Facebook',
      product: 'LX-Press 伺服压装检测单元',
      quantity: 2,
      amount: 102000,
      cost: 70400,
      status: '待付款',
      orderDate: dateDaysFromNow(-4),
      owner: 'Leo',
      source: 'Meta Lead Ad → WhatsApp',
      sourceRef: '正式报价 HT-Q-260924 · 等待 PO',
      sourcePostId: 'fb-pl-press-fit-case-02',
      customerId: 'mock-export-quote-poland-press',
      importedAt: isoDaysFromNow(-4),
      updatedAt: isoDaysFromNow(-1),
    },
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}order-mexico-medical`,
      orderNo: 'HT-2026-MX-0916',
      buyer: 'Sofía Ramírez · MedNova México',
      market: '拉美',
      channel: 'Instagram',
      product: 'LX-Clean 医疗器械装配工作站',
      quantity: 1,
      amount: 86500,
      cost: 61800,
      status: '已发货',
      orderDate: dateDaysFromNow(-12),
      owner: 'Ana',
      source: 'Instagram Reels → WhatsApp',
      sourceRef: '尾款到账 · 提单 MX260916',
      sourcePostId: 'ig-es-cleanroom-fat-05',
      customerId: 'mock-export-solution-mexico-medical',
      importedAt: isoDaysFromNow(-12),
      updatedAt: isoDaysFromNow(-2),
    },
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}order-germany-battery`,
      orderNo: 'HT-2026-DE-0908',
      buyer: 'Anna Keller · VoltWerk GmbH',
      market: '欧洲',
      channel: 'YouTube',
      product: 'LX-Trace 电池模组试点装配线',
      quantity: 1,
      amount: 218000,
      cost: 156000,
      status: '已付款',
      orderDate: dateDaysFromNow(-20),
      owner: 'Leo',
      source: 'YouTube 案例 → 官网表单',
      sourceRef: '首付款 SWIFT-DE-7781',
      sourcePostId: 'yt-de-battery-changeover-01',
      customerId: 'mock-export-inquiry-germany-battery',
      importedAt: isoDaysFromNow(-20),
      updatedAt: isoDaysFromNow(-3),
    },
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}order-indonesia-repeat`,
      orderNo: 'HT-2026-ID-0828',
      buyer: 'Rina Prasetyo · Nusantara Fulfilment',
      market: '东南亚',
      channel: 'WhatsApp',
      product: 'LX-Pack 柔性装箱单元（二期）',
      quantity: 3,
      amount: 210000,
      cost: 143000,
      status: '已完成',
      orderDate: dateDaysFromNow(-31),
      owner: 'Mia',
      source: '老客户复购',
      sourceRef: '二期 SAT 已签字 · ID-SAT-0828',
      customerId: 'mock-export-won-indonesia-logistics',
      importedAt: isoDaysFromNow(-31),
      updatedAt: isoDaysFromNow(-5),
    },
  ];
}

function configuration(days: number, dailyBudget: number, audience: string) {
  return {
    startsAt: isoDaysFromNow(-days),
    endsAt: isoDaysFromNow(14),
    dailyBudget,
    audience,
    placements: 'Advantage+ 自动版位；Reels / Feed / Shorts 优先',
  };
}

export function createForeignTradeMockAdTasks(): PlatformAdTask[] {
  const updatedAt = isoDaysFromNow(0);
  return [
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}ad-saudi-packaging`,
      name: '沙特食品工厂 · 阿语装箱线获客',
      video: '6 条包装线 ROI 对比 · 阿语字幕版',
      goal: '提升网站访问',
      market: '沙特阿拉伯 / 阿联酋',
      budget: 4200,
      currency: 'USD',
      channels: ['Facebook', 'Instagram'],
      status: 'active',
      createdAt: isoDaysFromNow(-21),
      updatedAt,
      version: 3,
      creationSource: 'platform_import',
      managementMode: 'manual',
      configuration: configuration(21, 200, '食品、日化包装工厂的 COO、工厂经理与设备采购负责人'),
      authorization: null,
    },
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}ad-germany-battery`,
      name: '德国电池模组 · 换型效率案例',
      video: '55 分钟换型如何降至 12 分钟 · 英文案例',
      goal: '获取线索或转化',
      market: '德国 / 波兰 / 捷克',
      budget: 3600,
      currency: 'USD',
      channels: ['YouTube'],
      status: 'active',
      createdAt: isoDaysFromNow(-18),
      updatedAt,
      version: 2,
      creationSource: 'platform_import',
      managementMode: 'manual',
      configuration: configuration(18, 180, '汽车与新能源工厂的自动化经理、生产工程师'),
      authorization: null,
    },
    {
      id: `${FOREIGN_TRADE_MOCK_PREFIX}ad-mexico-medical`,
      name: '墨西哥医疗器械 · FAT 追溯方案',
      video: '洁净装配与扭矩追溯 · 西语工程师讲解',
      goal: '提升有效视频观看',
      market: '墨西哥 / 哥伦比亚',
      budget: 2800,
      currency: 'USD',
      channels: ['Facebook', 'Instagram'],
      status: 'paused',
      createdAt: isoDaysFromNow(-14),
      updatedAt,
      version: 4,
      creationSource: 'platform_import',
      managementMode: 'manual',
      configuration: configuration(14, 160, '医疗器械工厂的质量经理、制造工程经理'),
      authorization: null,
    },
  ];
}

const reportShape: Record<string, { spend: number[]; clicks: number[]; impressions: number[] }> = {
  [`${FOREIGN_TRADE_MOCK_PREFIX}ad-saudi-packaging`]: {
    spend: [148, 166, 174, 182, 196, 203, 211],
    clicks: [94, 107, 116, 123, 137, 145, 151],
    impressions: [12840, 14110, 14980, 15820, 16940, 17620, 18340],
  },
  [`${FOREIGN_TRADE_MOCK_PREFIX}ad-germany-battery`]: {
    spend: [126, 132, 141, 149, 158, 164, 171],
    clicks: [61, 65, 72, 76, 82, 88, 93],
    impressions: [7840, 8210, 8860, 9340, 9820, 10410, 10890],
  },
  [`${FOREIGN_TRADE_MOCK_PREFIX}ad-mexico-medical`]: {
    spend: [92, 101, 108, 114, 121, 128, 136],
    clicks: [73, 81, 86, 92, 99, 105, 111],
    impressions: [9680, 10520, 11160, 11840, 12510, 13280, 14020],
  },
};

export function isForeignTradeMockId(id: string): boolean {
  return id.startsWith(FOREIGN_TRADE_MOCK_PREFIX);
}

export function foreignTradeMockAdReport(taskId: string): AdReport | null {
  const values = reportShape[taskId];
  if (!values) return null;
  const daily = values.spend.map((spend, index) => ({
    date: dateDaysFromNow(index - 6),
    spend,
    clicks: values.clicks[index],
    impressions: values.impressions[index],
  }));
  return {
    source: 'provider_snapshot',
    stale: false,
    currency: 'USD',
    reportedAt: isoDaysFromNow(0),
    dataNote: '本地外贸工厂演示快照，仅用于界面和流程检查。',
    window: { since: daily[0].date, until: daily[daily.length - 1].date },
    spend: daily.reduce((sum, row) => sum + row.spend, 0),
    clicks: daily.reduce((sum, row) => sum + row.clicks, 0),
    impressions: daily.reduce((sum, row) => sum + row.impressions, 0),
    daily,
  };
}

export const foreignTradeBusinessMock = {
  factory: FOREIGN_TRADE_FACTORY,
  accountCount: 8,
  inquiries: 37,
  wonCustomers: 3,
  adSpend: 5840,
  queue: 14,
  completed: 9,
  waiting: 3,
  activeAgents: 4,
  platformCoverage: { youtube: 4, tiktok: 3, instagram: 5, facebook: 4 },
  agentTasks: {
    business: '复盘德国与中东市场询盘成本，调整下周预算',
    director: '分析阿语包装线案例的前三秒与询价钩子',
    content: '制作墨西哥医疗器械 FAT 西语视频',
    customer: '跟进 6 个高意向询盘，准备 2 份多语言报价草稿',
  },
} as const;
