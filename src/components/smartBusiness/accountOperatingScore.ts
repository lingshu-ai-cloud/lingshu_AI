import type { AccountHealthAccount, AccountHealthResult } from './AccountHealthPanel';
import type { BusinessHealthDimension, HealthCriterion } from './businessHealthModel';

export type AccountOperatingScoreKey = 'setup' | 'conversion' | 'traffic' | 'inquiries';

export type AccountOperatingCriterion = {
  label: string;
  score: number | null;
  current: string;
  evidence: string;
  action: string;
};

export type AccountOperatingScoreDimension = {
  key: AccountOperatingScoreKey;
  label: string;
  score: number | null;
  points: number | null;
  maxPoints: 25;
  summary: string;
  criteria: AccountOperatingCriterion[];
};

export type AccountOperatingScore = {
  totalScore: number | null;
  evaluatedCriteria: number;
  totalCriteria: number;
  dimensions: AccountOperatingScoreDimension[];
};

const meaningful = (value: string) => Boolean(value.trim() && !/^(?:待|未|暂无)/u.test(value.trim()));

function meanKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}

function ratioScore(complete: number, total: number): number | null {
  return total > 0 ? Math.round(complete / total * 100) : null;
}

function fromHealthCriterion(
  criterion: HealthCriterion | undefined,
  label: string,
  action: string,
): AccountOperatingCriterion {
  return {
    label,
    score: criterion?.score ?? null,
    current: criterion?.current || '待接入可核验数据',
    evidence: criterion?.basis || '有真实过程记录后再评分，不用结果指标代替。',
    action,
  };
}

function fromAccountDimension(
  accounts: AccountHealthResult[],
  key: AccountHealthResult['dimensions'][number]['key'],
  label: string,
  action: string,
): AccountOperatingCriterion {
  const rows = accounts.map(account => account.dimensions.find(item => item.key === key)).filter(Boolean);
  const scored = rows.filter(row => row?.currentScore !== null);
  return {
    label,
    score: meanKnown(rows.map(row => row?.currentScore ?? null)),
    current: rows.length ? `${scored.length}/${rows.length} 个账号已有过程证据` : '尚未配置经营账号',
    evidence: rows[0]?.evidence || '配置真实账号并同步过程记录后评估。',
    action,
  };
}

function configuredCriterion(
  accounts: AccountHealthAccount[],
  label: string,
  check: (account: AccountHealthAccount) => boolean,
  evidence: string,
  action: string,
): AccountOperatingCriterion {
  const complete = accounts.filter(check).length;
  return {
    label,
    score: ratioScore(complete, accounts.length),
    current: accounts.length ? `${complete}/${accounts.length} 个账号已配置` : '尚未配置经营账号',
    evidence,
    action,
  };
}

function makeDimension(
  key: AccountOperatingScoreKey,
  label: string,
  summary: string,
  criteria: AccountOperatingCriterion[],
): AccountOperatingScoreDimension {
  const score = meanKnown(criteria.map(item => item.score));
  return { key, label, summary, criteria, score, points: score === null ? null : Math.round(score / 4), maxPoints: 25 };
}

export function buildAccountOperatingScore(
  accounts: AccountHealthAccount[],
  accountHealth: AccountHealthResult[],
  businessDimensions: BusinessHealthDimension[],
): AccountOperatingScore {
  const healthCriterion = (dimensionKey: BusinessHealthDimension['key'], matcher: RegExp) => businessDimensions
    .find(dimension => dimension.key === dimensionKey)?.criteria.find(criterion => matcher.test(criterion.label));

  const dimensions = [
    makeDimension('setup', '搭账号', '先把账号身份、定位和稳定经营计划搭完整。', [
      fromAccountDimension(accountHealth, 'profile', '账号资料与连接完整', '补齐账号授权、目标受众、主推产品、内容方向、栏目和行动引导。'),
      configuredCriterion(accounts, '账号定位清晰', account => meaningful(account.audience) && meaningful(account.contentDirection), '目标受众和内容方向均已配置，才算完成定位。', '补齐目标受众和内容方向。'),
      configuredCriterion(accounts, '周更计划已设置', account => account.weeklyCount > 0, '配置每周计划更新数量，不用临时发布代替稳定计划。', '为每个经营账号设置周更数量。'),
    ]),
    makeDimension('conversion', '提转化', '检查产品、内容和行动引导是否具备承接转化的基础。', [
      configuredCriterion(accounts, '主推产品与行动引导完整', account => meaningful(account.productName) && meaningful(account.cta), '主推产品与 CTA 同时配置后，内容才有明确转化去向。', '补齐主推产品和行动引导。'),
      configuredCriterion(accounts, '内容栏目与卖点方向明确', account => Boolean(account.formats?.length) && meaningful(account.contentDirection), '栏目形式和内容方向均已配置，避免临时选题。', '补齐内容栏目和卖点方向。'),
      fromHealthCriterion(healthCriterion('content', /成片验收率/u), '成片按流程完成验收', '处理待验收内容，留下明确的通过或退回记录。'),
    ]),
    makeDimension('traffic', '扩流量', '用稳定更新、持续栏目和可靠发布扩大自然触达。', [
      fromAccountDimension(accountHealth, 'cadence', '按计划稳定更新', '补齐本周排期，优先消除连续空档。'),
      configuredCriterion(accounts, '内容栏目持续配置', account => Boolean(account.formats?.length), '至少配置一个可持续执行的内容栏目。', '为账号配置可持续更新的内容栏目。'),
      fromHealthCriterion(healthCriterion('content', /平台发布成功率/u), '发布流程稳定', '检查失败发布并修复账号连接或发布条件。'),
    ]),
    makeDimension('inquiries', '接询盘', '确保客户能找到入口、得到及时回复并保留来源。', [
      fromAccountDimension(accountHealth, 'handoff', '询盘承接渠道可用', '接通 WhatsApp；Facebook 账号同时完成 Messenger 订阅。'),
      fromHealthCriterion(healthCriterion('inquiries', /响应时效/u), '客户消息及时回复', '接入首次响应时长，并设置可核验的回复时限。'),
      fromHealthCriterion(healthCriterion('inquiries', /客户来源可追踪率/u), '询盘来源有留痕', '在会话或 CRM 中保留账号与渠道来源。'),
    ]),
  ];
  const evaluatedCriteria = dimensions.flatMap(item => item.criteria).filter(item => item.score !== null && Number.isFinite(item.score)).length;
  const normalizedDimensions = dimensions.map(item => item.score);
  return {
    totalScore: meanKnown(normalizedDimensions),
    evaluatedCriteria,
    totalCriteria: dimensions.reduce((sum, item) => sum + item.criteria.length, 0),
    dimensions,
  };
}
