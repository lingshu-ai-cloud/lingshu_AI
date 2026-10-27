import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { beijingDay } from '../lib/businessOverviewPresentation';
import { applySmartBusinessShowcaseData, smartBusinessShowcaseAds } from './smartBusinessShowcaseData';
import type { AccountOperatingScoreDimension } from '../components/smartBusiness/accountOperatingScore';

export const BUSINESS_OVERVIEW_SAMPLE_PARAM = 'overviewSample';

/** Explicit, loopback-only visual preview; never changes persisted business state. */
export function isBusinessOverviewSampleEnabled(input: { dev?: boolean; hostname?: string; search?: string } = {}): boolean {
  const dev = input.dev ?? Boolean(import.meta.env?.DEV);
  const hostname = (input.hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname)).toLowerCase();
  const search = input.search ?? (typeof window === 'undefined' ? '' : window.location.search);
  return dev && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
    && new URLSearchParams(search).get(BUSINESS_OVERVIEW_SAMPLE_PARAM) === '1';
}

const socialSeries = [
  { views: 18_400, interactions: 1_490 },
  { views: 24_900, interactions: 1_965 },
  { views: 28_600, interactions: 2_334 },
  { views: 33_800, interactions: 2_890 },
  { views: 39_100, interactions: 3_585 },
  { views: 36_500, interactions: 3_290 },
  { views: 34_500, interactions: 3_192 },
] as const;

function shiftedDay(now: Date, offset: number): string {
  return beijingDay(new Date(now.getTime() + offset * 86_400_000));
}

export function businessOverviewSample(data: DigitalEmployeeOverview, now = new Date()) {
  const day = beijingDay(now);
  const startsAt = shiftedDay(now, -6);
  const overview = applySmartBusinessShowcaseData(data, true);
  const snapshot = overview.businessSnapshot!;
  const generatedAt = now.toISOString();
  const dailyTrend = socialSeries.map((item, index) => ({ date: shiftedDay(now, index - 6), ...item }));
  const discussionTitles = [
    ['工厂透明生产：哪道质检最能建立信任？', 'TikTok 热议灌装过程、抽检镜头与生产透明度'],
    ['包装打样时，材质与高辨识色彩怎么选？', 'Instagram 讨论包装打样与品牌视觉的平衡'],
    ['低 MOQ 定制，怎样兼顾交期与成本？', 'Facebook 采购社区关注小单起订与交付节奏'],
  ] as const;
  const topics = overview.industryTrends?.signals.map((signal, index) => ({
    ...signal,
    title: discussionTitles[index]?.[0] || signal.title,
    summary: discussionTitles[index]?.[1] || signal.summary,
    observedAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
  })) || [];
  const displayData: DigitalEmployeeOverview = {
    ...overview,
    config: overview.config ? { ...overview.config, companyName: '澄光美研（环球校区）' } : overview.config,
    industryTrends: overview.industryTrends ? { ...overview.industryTrends, signals: topics } : undefined,
    businessSnapshot: {
      ...snapshot,
      generatedAt,
      range: { startsAt, endsAt: day, timeZone: 'Asia/Shanghai' },
      social: { ...snapshot.social, dailyTrend },
      ads: snapshot.ads ? { ...snapshot.ads, latestReportedAt: generatedAt } : undefined,
    },
  };
  const adPlans = smartBusinessShowcaseAds(startsAt, day, true)!;
  const scoreDimension = (
    key: AccountOperatingScoreDimension['key'], label: string, points: number, summary: string,
    criteria: Array<[string, number, string, string, string]>,
  ): AccountOperatingScoreDimension => ({
    key, label, points, maxPoints: 25, score: points * 4, summary,
    criteria: criteria.map(([criterionLabel, score, current, evidence, action]) => ({ label: criterionLabel, score, current, evidence, action })),
  });
  return {
    displayData,
    today: { views: dailyTrend[6]!.views, interactions: dailyTrend[6]!.interactions, inbound: 12, outreach: 18 },
    customer: {
      inbound: 126,
      quoted: 43,
      won: 9,
      lead: 48,
      funnel: [126, 94, 71, 43, 28],
      tags: [['美妆品牌采购', 52], ['高意向', 43], ['低 MOQ', 36], ['北美市场', 29], ['包装定制', 22]] as Array<[string, number]>,
    },
    score: { totalScore: 82, evaluatedCriteria: 12, totalCriteria: 12, dimensions: [
      scoreDimension('setup', '搭账号', 22, '账号身份、定位和更新计划已经基本搭好。', [
        ['账号资料与连接完整', 92, '主要账号均已连接，资料完成度较高', '核对账号授权、目标受众、主推产品、内容方向、栏目和行动引导。', '补齐少量缺失的主页资料。'],
        ['账号定位清晰', 88, '目标受众与内容方向已经配置', '目标受众和内容方向同时配置才算完成定位。', '统一各平台的受众与内容定位。'],
        ['周更计划已设置', 84, '全部账号已设置周更目标', '按账号保存周更数量，临时发布不代替稳定计划。', '检查下周排期是否存在连续空档。'],
      ]),
      scoreDimension('conversion', '提转化', 19, '产品、内容和行动引导已经具备基础，验收仍有提升空间。', [
        ['主推产品与行动引导完整', 82, '主推产品和 CTA 已配置', '内容同时具备明确产品和转化去向。', '补齐少数内容的产品绑定。'],
        ['内容栏目与卖点方向明确', 76, '已形成 3 个稳定内容栏目', '栏目形式与卖点方向都存在才计入。', '统一各栏目的卖点证据。'],
        ['成片按流程完成验收', 70, '仍有 3 条成片等待验收', '只统计留下明确验收结果的成片。', '先处理等待验收的成片。'],
      ]),
      scoreDimension('traffic', '扩流量', 23, '更新节奏稳定，发布流程整体可靠。', [
        ['按计划稳定更新', 95, '近 4 周持续更新，无整周空档', '同时检查更新数量与发布日分布。', '保持当前更新节奏。'],
        ['内容栏目持续配置', 90, '核心栏目均有连续选题', '至少配置一个可持续执行的内容栏目。', '为新账号补充首个稳定栏目。'],
        ['发布流程稳定', 91, '绝大多数内容获得成功发布回执', '只使用平台真实发布回执，不以排期代替。', '复核少量失败发布。'],
      ]),
      scoreDimension('inquiries', '接询盘', 18, '承接入口已接通，回复时效和来源留痕需要继续加强。', [
        ['询盘承接渠道可用', 80, 'WhatsApp 已连接，部分账号待补 Messenger', '检查账号对应的真实承接渠道连接状态。', '完成剩余账号的 Messenger 订阅。'],
        ['客户消息及时回复', 72, '多数新消息在目标时限内首次回复', '按首次响应时长对照已确认的回复时限。', '优先处理超时未回复会话。'],
        ['询盘来源有留痕', 64, '仍有部分询盘缺少来源账号', '只有会话或 CRM 明确保留来源时才计入。', '补齐缺失的账号与渠道来源。'],
      ]),
    ] },
    weekly: { waitingReview: 3, plannedVideos: 32, durationSeconds: 1_080, budgetMin: 300, budgetMax: 360, estimatedCost: 320, settledCost: 180, startsAt, endsAt: day },
    adPlans,
  };
}
