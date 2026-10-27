import type { LocalBusinessPreview } from '../../shared/localBusinessPreview';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { MetaBusinessOverview } from '../../shared/metaBusinessOverview';
import type { AdDirectoryAccount } from '../../shared/adAccountDirectory';
import { applySmartBusinessShowcaseData } from './smartBusinessShowcaseData';
import { beijingDay } from '../lib/businessOverviewPresentation';
import { META_PERFORMANCE_FIELDS, type MetaMetricValues } from '../../shared/metaPerformance';
const dayOffset = (now: Date, days: number) => beijingDay(new Date(now.getTime() + days * 86400000));
export function fillLocalBusinessOverview(data: DigitalEmployeeOverview, library: LocalBusinessPreview | null, now = new Date()): DigitalEmployeeOverview {
  if (!library) return data;
  const fallback = applySmartBusinessShowcaseData(data, true);
  const source = data.businessSnapshot, seed = fallback.businessSnapshot;
  if (!source || !seed) return data;
  const products = library.products.slice(0, 5);
  const dailyTrend = source.social.dailyTrend.some(row => row.views !== null) ? source.social.dailyTrend : [1840, 2490, 2860, 3380, 3910, 3650, 3450].map((views, index) => ({ date: dayOffset(now, index - 6), views, interactions: Math.round(views * .075) }));
  const social = { ...source.social };
  for (const key of ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'profileViews', 'accountCount', 'platformCount'] as const) {
    if (social[key].status !== 'available' || social[key].value === null) social[key] = seed.social[key];
  }
  const realRanks = data.review?.summary.contentPerformance?.filter(item => item.performance.status === 'available') || [];
  const review = realRanks.length ? data.review : fallback.review ? { ...fallback.review, summary: { ...fallback.review.summary, contentPerformance: fallback.review.summary.contentPerformance?.map((item, index) => {
    const product = products[index % products.length];
    return { ...item, title: `${product.name} · ${['产品亮点与使用场景', '采购方最关心的三件事', '工厂质检与交付细节'][index % 3]}`, productId: product.id, productName: product.name, thumbnailUrl: product.imageUrl, hook: `${product.name}的产品特点与采购应用。` };
  }) } } : data.review;
  const topics = data.industryTrends?.signals.length ? data.industryTrends : fallback.industryTrends ? { ...fallback.industryTrends, status: 'available' as const, signals: fallback.industryTrends.signals.slice(0, 3).map((item, index) => ({ ...item, title: `${products[index % products.length].name} · 海外采购关注`, summary: `${library.companyName}面向${library.markets}，围绕${products[index % products.length].category}的产品应用、包装与供货展开内容。`, sourceUrl: `${typeof window === 'undefined' ? 'http://127.0.0.1:5398' : window.location.origin}/?page=enterprise`, observedAt: now.toISOString() })) } : data.industryTrends;
  return { ...data, config: data.config ? { ...data.config, companyName: data.config.companyName?.trim() || library.companyName } : data.config, review, industryTrends: topics,
    businessSnapshot: { ...source, social: { ...social, dailyTrend, platformBreakdown: source.social.platformBreakdown.some(row => row.views !== null) ? source.social.platformBreakdown : seed.social.platformBreakdown }, generatedAt: source.generatedAt || now.toISOString() } };
}
/** Merge only missing preview values. Keep real zero, spend, daily rows, videos and audiences intact. */
export function fillLocalMetaReport(real: MetaBusinessOverview | undefined, account: AdDirectoryAccount | undefined, library: LocalBusinessPreview | null, days: number, now = new Date()): MetaBusinessOverview | undefined {
  if (!library || !account) return real;
  const until = dayOffset(now, 0), since = dayOffset(now, -(days - 1));
  const base: MetaMetricValues = Object.fromEntries(Object.keys(META_PERFORMANCE_FIELDS).map(key => [key, null])) as MetaMetricValues;
  const fill: Partial<MetaMetricValues> = { spend: 486.8, impressions: 18420, clicks: 426, linkClicks: 268, messagingConversations: 36, instantFormLeads: 18, websiteLeads: 8, leads: 42, reach: 12860, frequency: 1.43, cpm: 26.43, cpc: 1.14, ctr: 2.31, linkCtr: 1.45, thruPlays: 2318, costPerThruPlay: .21, costPerLinkClick: 1.82, purchaseValue: 2860, purchaseRoas: 5.88 };
  const totals = { ...base, ...fill, ...Object.fromEntries(Object.entries(real?.totals || {}).filter(([, value]) => value !== null)) };
  // Fill goal-specific missing events conservatively when actual traffic is small.
  if (real?.totals?.linkClicks != null) for (const key of ['messagingConversations', 'instantFormLeads', 'websiteLeads', 'leads'] as const) if (real.totals[key] == null) totals[key] = Math.min(totals[key]!, real.totals.linkClicks);
  for (const [key, numerator, denominator, multiplier] of [['cpm', 'spend', 'impressions', 1000], ['cpc', 'spend', 'clicks', 1], ['ctr', 'clicks', 'impressions', 100], ['linkCtr', 'linkClicks', 'impressions', 100], ['costPerLinkClick', 'spend', 'linkClicks', 1], ['purchaseRoas', 'purchaseValue', 'spend', 1]] as const) if (real?.totals?.[key] == null) totals[key] = totals[denominator] ? Math.round(totals[numerator]! / totals[denominator]! * multiplier * 100) / 100 : null;
  const weights = Array.from({ length: days }, (_, index) => [.08, .12, .15, .18, .16, .14, .17][index % 7]);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let assignedImpressions = 0, assignedCents = 0;
  const daily = real?.daily.length ? real.daily : weights.map((weight, index) => {
    const impressions = index === days - 1 ? totals.impressions! - assignedImpressions : Math.round(totals.impressions! * weight / weightTotal);
    const cents = index === days - 1 ? Math.round(totals.spend! * 100) - assignedCents : Math.round(totals.spend! * 100 * weight / weightTotal);
    assignedImpressions += impressions; assignedCents += cents;
    return { ...base, date: dayOffset(now, index - days + 1), impressions, spend: cents / 100 };
  });
  const audiences = (['age', 'gender', 'country'] as const).map(dimension => {
    const actual = real?.audiences.find(item => item.dimension === dimension);
    if (actual?.available && actual.rows.length) return actual;
    const labels = dimension === 'age' ? ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] : dimension === 'gender' ? ['female', 'male', 'unknown'] : ['US', 'CA', 'AE', 'MY', 'SG'];
    const weights = dimension === 'age' ? [8, 37, 29, 16, 7, 3] : dimension === 'gender' ? [68, 29, 3] : [42, 21, 16, 13, 8];
    let assigned = 0;
    return { dimension, available: true, note: '', rows: labels.map((label, index) => { const impressions = index === labels.length - 1 ? totals.impressions! - assigned : Math.round(totals.impressions! * weights[index] / 100); assigned += impressions; return { label, impressions, clicks: Math.round(totals.clicks! * weights[index] / 100) }; }) };
  });
  const videos = [...(real?.topVideos || [])];
  while (videos.length < 3) {
    const index = videos.length, product = library.products[index % library.products.length];
    videos.push({ adId: `local-business-${product.id}`, name: `${product.name} · ${['产品应用', '供货与定制', '工厂质检'][index]}`, metrics: { ...base, spend: real?.topVideos.length ? 0 : Math.round(totals.spend! * [.46, .32, .22][index] * 100) / 100, impressions: real?.topVideos.length ? 0 : Math.round(totals.impressions! * [.48, .31, .21][index]), linkClicks: real?.topVideos.length ? 0 : Math.round(totals.linkClicks! * [.48, .31, .21][index]) }, asset: { accountId: account.accountId, adId: `local-business-${product.id}`, adName: product.name, creativeId: '', creativeName: product.name, configuredStatus: '', effectiveStatus: '', pageId: '', videoIds: [], imageHashes: [], thumbnailUrl: product.imageUrl, checkedAt: now.toISOString(), localSource: 'unverified' } });
  }
  return { source: 'local_preview', accountId: account.accountId, accountName: account.name, currency: real?.currency || account.currency, timezone: real?.timezone || 'Asia/Shanghai', window: real?.window || { since, until }, reportedAt: real?.reportedAt || now.toISOString(), actionReportTime: 'impression', useUnifiedAttributionSetting: true, totals, daily, audiences, topVideos: videos, videoRankingComplete: real?.videoRankingComplete ?? true, warnings: [] };
}
