import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { beijingDay } from '../lib/businessOverviewPresentation';
import { applySmartBusinessShowcaseData, smartBusinessShowcaseAds } from './smartBusinessShowcaseData';

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
    score: { score: 82, criteria: [
      { label: '账号连接', score: 90 }, { label: '发布活跃度', score: 86 },
      { label: '内容互动', score: 81 }, { label: '客户承接', score: 77 }, { label: '资料完整度', score: 76 },
    ] },
    weekly: { waitingReview: 3, plannedVideos: 32, durationSeconds: 1_080, budgetMin: 300, budgetMax: 360, estimatedCost: 320, settledCost: 180, startsAt, endsAt: day },
    adPlans,
  };
}
