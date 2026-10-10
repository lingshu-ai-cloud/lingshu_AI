import type { BusinessMetric, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { calendarDayKey } from '../../lib/calendarModel';
import type { ConnectedSocialPerformance } from '../../lib/socialPerformance';
import type { Page } from '../../pageRegistry';
import { scoreAccountHealth, type AccountHealthAccount, type AccountHealthMessengerPage } from './AccountHealthPanel';

export type HealthCriterionCoverageStatus = 'scored' | 'pending' | 'not_applicable';
export type HealthCriterion = {
  label: string;
  score: number | null;
  current: string;
  basis: string;
  /** Only set when a criterion is genuinely out of scope; missing evidence remains pending. */
  coverageStatus?: HealthCriterionCoverageStatus;
};
export type BusinessHealthDimension = {
  key: 'accounts' | 'inquiries' | 'content' | 'advertising';
  label: string;
  score: number | null;
  criteria: HealthCriterion[];
  action: string;
  page: Page;
};
export type BusinessHealthSources = {
  performance: ConnectedSocialPerformance | null;
  channelsLoaded: boolean;
  whatsappConnected: boolean;
  messengerPages: AccountHealthMessengerPage[];
};

export function availableMetric(metric?: BusinessMetric): number | null {
  return metric?.status === 'available' && typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0 ? metric.value : null;
}

export function meanKnownScores(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}

export function businessHealthStatus(score: number | null, covered: number, total: number): string {
  if (score === null) return '待补数据';
  if (covered < total) return '局部评分';
  return score >= 80 ? '基础稳健' : score >= 60 ? '持续建设' : '优先补齐';
}

export function healthCriterionCoverageStatus(criterion: HealthCriterion): HealthCriterionCoverageStatus {
  return criterion.coverageStatus || (criterion.score === null ? 'pending' : 'scored');
}

export function summarizeHealthCriteria(criteria: HealthCriterion[]) {
  const scored = criteria.filter(item => healthCriterionCoverageStatus(item) === 'scored').length;
  const pending = criteria.filter(item => healthCriterionCoverageStatus(item) === 'pending').length;
  const notApplicable = criteria.filter(item => healthCriterionCoverageStatus(item) === 'not_applicable').length;
  const applicable = scored + pending;
  return {
    scored,
    pending,
    notApplicable,
    applicable,
    total: criteria.length,
    coveragePercent: applicable ? Math.round(scored / applicable * 100) : null,
  };
}

const ratio = (numerator: number | null, denominator: number | null) => numerator !== null && denominator !== null && denominator > 0 && numerator <= denominator ? Math.round(numerator / denominator * 100) : null;
const count = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');

export function businessHealthAccounts(data: DigitalEmployeeOverview): AccountHealthAccount[] {
  const pack = data.plan?.businessPackage;
  const matrix = pack?.matrixPlan || [];
  const targets = data.config?.publishingTargets || [];
  // Only actual configured/planned account identities are included; never synthesize accounts.
  const identities = [...targets, ...matrix.filter(row => !targets.some(target => target.accountId === row.accountId && target.platform === row.platform)).map(row => ({ ...row, accountLabel: pack?.operatingContext?.accounts.find(item => item.accountId === row.accountId)?.accountLabel || row.accountId }))];
  return identities.map(target => {
    const row = matrix.find(item => item.accountId === target.accountId && item.platform === target.platform);
    const planned = pack?.operatingContext?.accounts.find(item => item.accountId === target.accountId);
    return {
      accountId: target.accountId, accountLabel: target.accountLabel, platform: target.platform,
      weeklyCount: row?.weeklyCount ?? planned?.contentCount ?? 0,
      // Assigning a publishing target is not proof of a valid platform connection.
      connected: false,
      audience: row?.audience || data.config?.customerProfile || '',
      productName: row?.productName || data.config?.focusProducts || '',
      contentDirection: row?.contentDirection || planned?.positioning || '',
      formats: row?.formats || [], cta: row?.cta || '',
    };
  });
}

export function buildBusinessHealthModel(data: DigitalEmployeeOverview, sources: BusinessHealthSources, selectedAccountId = '') {
  const snapshot = data.businessSnapshot;
  const timeZone = snapshot?.range.timeZone || 'Asia/Shanghai';
  const rangeDay = (value?: string) => {
    if (!value) return '';
    try { return calendarDayKey(value, timeZone); }
    catch { return value.slice(0, 10); }
  };
  const startsAt = snapshot?.range.startsAt ? rangeDay(snapshot.range.startsAt) : data.goal?.startsAt || '';
  const endsAt = snapshot?.range.endsAt ? rangeDay(snapshot.range.endsAt) : data.goal?.endsAt || '';
  const accounts = businessHealthAccounts(data).filter(account => !selectedAccountId || account.accountId === selectedAccountId);
  const accountHealth = accounts.map(account => {
    const connectionKnown = Boolean(sources.performance && !sources.performance.unavailable.some(item => !item.accountId && (item.platform === account.platform || item.platform === 'facebook' && account.platform !== 'youtube')));
    const connected = sources.performance?.accounts.some(item => item.id === account.accountId && item.platform === account.platform) === true;
    const result = scoreAccountHealth({ ...account, connected }, { ...sources, startsAt, endsAt, inquiryEvidence: snapshot?.interactionReview?.breakdown || [] });
    if (!connectionKnown) {
      const profile = result.dimensions.find(item => item.key === 'profile')!;
      profile.currentScore = null;
      profile.currentLabel = '账号连接状态待核验';
      result.currentScore = meanKnownScores(result.dimensions.map(item => item.currentScore));
      result.scoreCoverage = result.dimensions.filter(item => item.currentScore !== null).length;
      result.milestones[0] = { label: '核验连接与账号资料', complete: false };
    }
    return result;
  });
  const accountDimensions = accountHealth[0]?.dimensions || [
    { key: 'cadence', label: '更新数量与稳定频率' },
    { key: 'performance', label: '真实视频表现与触达' },
    { key: 'profile', label: '账号资料完整度' },
    { key: 'handoff', label: 'WhatsApp / Messenger 承接' },
    { key: 'inquiries', label: '询盘相关评论' },
  ];
  const accountCriteria: HealthCriterion[] = accountDimensions.map(({ key, label }) => {
    const dimensions = accountHealth.map(account => account.dimensions.find(item => item.key === key)!);
    const scored = dimensions.filter(item => item.currentScore !== null);
    return {
      label,
      score: meanKnownScores(dimensions.map(item => item.currentScore)),
      current: `${scored.length}/${accounts.length} 个账号可评估`,
      basis: dimensions[0]?.evidence || '配置真实账号并同步表现后评估。',
    };
  });
  const customerTotal = selectedAccountId ? null : availableMetric(snapshot?.customer?.total);
  const attributed = selectedAccountId ? null : availableMetric(snapshot?.customer?.attributed);
  const inquiryCriteria: HealthCriterion[] = [
    { label: '客户来源可追踪率', score: ratio(attributed, customerTotal), current: `${count(attributed)} / ${count(customerTotal)} 位客户`, basis: '已归因客户 ÷ 客户总数；没有客户样本时不评分。该项衡量归因完整度，不等于成交能力。' },
    { label: '响应时效', score: null, current: '待接入响应耗时与 SLA', basis: '缺少首次响应时间与目标时限，不使用待处理数量推算响应分。' },
    { label: '有效询盘目标达成', score: null, current: '待设置有效询盘目标', basis: '未确认有效询盘目标前，只展示真实询盘数量，不预设合格率或成交率。' },
  ];

  const production = snapshot?.content?.production;
  const projects = production?.status === 'available' && !selectedAccountId ? production.projects : null;
  const completed = projects ? projects.filter(project => project.completed).length : null;
  const approved = projects ? projects.filter(project => project.completed && project.approved).length : null;
  const published = selectedAccountId ? null : availableMetric(snapshot?.content?.publishedPosts);
  const failed = selectedAccountId ? null : availableMetric(snapshot?.content?.failedPosts);
  const publishedAttempts = published === null || failed === null ? null : published + failed;
  const contentCriteria: HealthCriterion[] = [
    { label: '制作完成率', score: ratio(completed, projects?.length ?? null), current: `${count(completed)} / ${count(projects?.length ?? null)} 个项目`, basis: '已完成项目 ÷ 当前统计范围内项目；衡量制作完成度，不等于发布效果。' },
    { label: '成片验收率', score: ratio(approved, completed), current: `${count(approved)} / ${count(completed)} 个已完成项目`, basis: '已完成且验收通过项目 ÷ 已完成项目；没有成片时不评分。' },
    { label: '平台发布成功率', score: ratio(published, publishedAttempts), current: `${count(published)} / ${count(publishedAttempts)} 次发布回执`, basis: '已发布 ÷（已发布 + 发布失败）；排期与草稿不计作已发布。' },
  ];
  const ads = snapshot?.ads;
  const spend = ads?.status === 'available' && !selectedAccountId ? ads.spendByCurrency.map(item => `${item.currency} ${item.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`).join(' · ') : '';
  const adCriteria: HealthCriterion[] = [
    { label: '转化目标达成', score: null, current: '待接入转化回执与目标', basis: '花费不代表效果。需要可归因转化和用户确认目标后，才能计算投流经营分。' },
    { label: '成本效率', score: null, current: spend ? `已核验花费 ${spend}` : '待同步投流花费', basis: '需同币种花费、归因转化及 CPA / ROAS 目标；不同币种不直接相加。' },
  ];
  const dimensions: BusinessHealthDimension[] = [
    { key: 'accounts', label: '账号健康度', score: meanKnownScores(accountHealth.map(account => account.currentScore)), criteria: accountCriteria, action: '完善账号资料与渠道连接', page: 'socialAccounts' },
    { key: 'inquiries', label: '询盘健康度', score: meanKnownScores(inquiryCriteria.map(item => item.score)), criteria: inquiryCriteria, action: selectedAccountId ? '补齐账号级询盘归因' : '核对客户来源与待跟进事项', page: 'conversion' },
    { key: 'content', label: '内容经营分', score: meanKnownScores(contentCriteria.map(item => item.score)), criteria: contentCriteria, action: '完成成片验收并核对发布结果', page: 'smartAssets' },
    { key: 'advertising', label: '投流经营分', score: null, criteria: adCriteria, action: '接入投流数据并配置转化目标', page: 'adsOverview' },
  ];
  const scoreCoverage = dimensions.filter(dimension => dimension.score !== null).length;
  return { startsAt, endsAt, accounts, accountHealth, dimensions, scoreCoverage, totalScore: meanKnownScores(dimensions.map(dimension => dimension.score)), generatedAt: snapshot?.generatedAt || '', selectedAccountId };
}
